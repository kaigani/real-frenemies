/**
 * One player's session: territory, simulated RF ledger, three persistent rivals with their own wallets, the reward
 * pot and the block-count round, and the day loop (build → optional raid → night: tonight's raid on you, the ghosts'
 * own actions → morning). No rendering; no randomness outside seeded rolls.
 *
 * RF is conserved: every flow moves between a wallet, a stake, the pot, the treasury or the burn.
 */
import { routeOf, runCampaign, type Campaign } from "./campaign.ts";
import { canAfford, createLedger, feeFor, formatRf, percent, post, rf, stakeAt, topUpCost, type Ledger } from "./economy.ts";
import type { Friend } from "./friends.ts";
import { buildRivals, counterPicks, pieceKey, weakestLane, type Rival } from "./ghosts.ts";
import { createRng, mixSeed, type Rng } from "./rng.ts";
import {
  BLOCKS_PER_DAY, CAPTURE_BURN_PERCENT, CLAIM_COST, EXPAND_COST, FEE_BURN_PERCENT, MAX_GARRISON, MAX_LEVEL, MAX_RAIDERS, MAX_THREAT,
  POT_SPLIT, REBUILD_NIGHTS, RECLAIM_COST, ROUND_BLOCKS, SUPPLY_PER_REGION, unitStats,
} from "./rules.ts";
import type { AttackerInput } from "./sim.ts";
import { buildable, type Board } from "./terrain.ts";
import {
  bonusFor, cloneTerritory, createTerritory, expandTerritory, expansionOptions, garrisoned, region as findRegion, regionName, supplyUsed, YOU,
  type HolderId, type Piece, type Region, type Territory,
} from "./territory.ts";

export type LineTo = "you" | "rival" | "burn" | "treasury" | "pot";
export type SettlementSummary = Readonly<{
  lines: readonly Readonly<{ label: string; amount: bigint; to: LineTo }>[];
  toYou: bigint; fromYou: bigint; burned: bigint; treasury: bigint;
}>;
/** Everything needed to re-fight a raid for free: the target as it stood before the raid. */
export type Snapshot = Readonly<{ territory: Territory; core: { friend: Friend; level: number } | null; only: string | null; rivalIndex: number | null; label: string }>;
export type RaidRecord = Readonly<{
  /** raid: you attack a rival · reclaim: you fight a resident on your own region · defense: a rival hits your
   *  territory · outpost: an owner tries to evict you · practice: a free re-fight of a snapshot (no RF, no score). */
  kind: "raid" | "reclaim" | "defense" | "outpost" | "practice";
  day: number; title: string; attacker: HolderId; defender: HolderId; rivalIndex: number | null;
  campaign: Campaign; settlement: SettlementSummary; net: bigint; reset: boolean;
  /** Regions you may buy out for 500 RF right after this (a winning raid) or reclaim for 250 RF (a cleared reclaim). */
  claimable: readonly string[]; reclaimable: string | null;
  snapshot: Snapshot | null;
}>;
export type Standing = Readonly<{ id: HolderId; name: string; wins: number; captured: bigint; you: boolean }>;
export type Round = { index: number; startBlock: number; endBlock: number; pot: bigint; wins: Map<HolderId, number>; captured: Map<HolderId, bigint> };
export type Payout = Readonly<{ round: number; pot: bigint; standings: readonly Standing[]; paid: readonly Readonly<{ id: HolderId; amount: bigint }>[] }>;
export type NightReport = Readonly<{ records: readonly RaidRecord[]; news: readonly string[]; payout: Payout | null }>;
export type Held = Readonly<{ id: string; region: Region; territory: Territory; rival: Rival | null }>;
/** Tonight's raid on you, fixed at dawn. It doesn't react to how you arrange or send out your pieces during the day. */
export type Tonight = Readonly<{ rivalId: HolderId; keys: readonly string[]; threat: number }>;
export type Incoming = Readonly<{ rival: Rival; party: readonly AttackerInput[]; lane: number; regions: number; threat: number; thinned: number }>;

const EMPTY: SettlementSummary = Object.freeze({ lines: Object.freeze([]), toYou: 0n, fromYou: 0n, burned: 0n, treasury: 0n });
const GHOST_RESERVE = rf(30);

export class Session {
  readonly player: Friend;
  /** Friends you can recruit: the pool minus you and the ghosts' pieces. */
  readonly pool: readonly Friend[];
  readonly startBalance: bigint;
  readonly territory: Territory;
  readonly rivals: readonly Rival[];
  /** The live chain height when the session started; the session clock starts at the current round's first block. */
  readonly liveBlock: number;
  ledger: Ledger;
  day = 1;
  block: number;
  round: Round;
  coreLevel = 0;
  away = new Set<string>();
  raidedToday = false;
  reclaimedToday = false;
  /** The rival you beat today; you may buy one of its flags. Cleared once you do. */
  wonToday: number | null = null;
  threat = 1;
  tonight: Tonight | null = null;
  /** Rebuild cooldowns: nobody may raid this actor while `block < until`. */
  protectedUntil = new Map<HolderId, number>();
  history: RaidRecord[] = [];

  constructor(player: Friend, allFriends: readonly Friend[], startBalance: bigint, liveBlock: number) {
    this.player = player;
    this.startBalance = startBalance;
    this.ledger = createLedger(startBalance);
    this.liveBlock = Math.max(0, Math.floor(liveBlock));
    // Start at the first block of the live round so the first round is a full one.
    this.block = Math.floor(this.liveBlock / ROUND_BLOCKS) * ROUND_BLOCKS;
    this.territory = createTerritory(YOU, player);
    const usable = allFriends.filter(f => f.tokenId !== player.tokenId && f.generation >= 1);
    this.rivals = buildRivals(usable, new Set([player.tokenId]), Number(player.tokenId % 1_000_003n));
    const ghostIds = new Set(this.rivals.flatMap(r => [...r.friendIds()]));
    this.pool = usable.filter(f => !ghostIds.has(f.tokenId));
    this.round = this.newRound();
    if (canAfford(this.ledger, stakeAt(1))) this.activateCore();
    this.planTonight();
  }

  // ------------------------------------------------------------------ lookups

  territories(): Territory[] { return [this.territory, ...this.rivals.map(r => r.territory)]; }
  get coreKey() { return pieceKey(this.player); }
  home(): Region { return this.territory.regions.find(r => r.home)!; }
  rival(id: HolderId) { return this.rivals.find(r => r.id === id) ?? null; }
  rivalOf(t: Territory) { return this.rivals.find(r => r.territory === t) ?? null; }
  holderName(id: HolderId | null) { return id === YOU ? "YOU" : id === null ? "NOBODY" : this.rival(id)?.name ?? id; }

  /** Regions you hold anywhere: your own, plus outposts in rival territories. */
  held(): Held[] {
    return this.territories().flatMap(t => t.regions.filter(r => r.holder === YOU)
      .map(r => ({ id: `${t.owner}/${r.key}`, region: r, territory: t, rival: this.rivalOf(t) })));
  }
  heldById(id: string) { return this.held().find(h => h.id === id) ?? null; }
  pieces(): Piece[] { return this.held().flatMap(h => h.region.garrison); }
  piece(key: string) { return this.pieces().find(p => p.key === key); }
  regionOf(key: string) { return this.held().find(h => h.region.garrison.some(p => p.key === key)) ?? null; }
  isPlaced(friend: Friend) { return this.pieces().some(p => p.friend.tokenId === friend.tokenId); }
  /** Pieces able to defend a region right now: your away raiders and a ghost's knocked-out raiders are not there. */
  present(region: Region) {
    if (region.holder === YOU) return region.garrison.filter(p => !this.away.has(p.key));
    const ghost = region.holder ? this.rival(region.holder) : null;
    return ghost ? ghost.present(region) : region.garrison;
  }
  get stake() { return this.pieces().reduce((sum, p) => sum + stakeAt(p.level), 0n) + (this.coreLevel ? stakeAt(this.coreLevel) : 0n); }
  bonus(holder: HolderId) { return bonusFor(this.territories(), holder); }
  /** Extra regions held (owned expansions and outposts), and how many of them are garrisoned enough to count. */
  extraRegions(holder: HolderId) { return this.territories().flatMap(t => t.regions.filter(r => !r.home && r.holder === holder)).length; }
  bonusRegions(holder: HolderId) { return this.territories().flatMap(t => t.regions.filter(r => !r.home && r.holder === holder && garrisoned(r))).length; }
  expandOptions() { return expansionOptions(this.territory); }
  supply(region: Region) { return supplyUsed(region); }
  get broke() { return !this.coreLevel && !canAfford(this.ledger, stakeAt(1)); }

  isProtected(id: HolderId) { return this.block < (this.protectedUntil.get(id) ?? 0); }
  /** Nights of rebuild protection left, counting tonight. */
  protectedNights(id: HolderId) { const until = this.protectedUntil.get(id) ?? 0; return until <= this.block ? 0 : Math.ceil((until - this.block) / BLOCKS_PER_DAY); }
  private protect(id: HolderId) { this.protectedUntil.set(id, this.block + REBUILD_NIGHTS * BLOCKS_PER_DAY + 1); }

  /** Every simulated RF in the world. Constant across the session (tested). */
  totalRf() {
    const ts = this.territories();
    return this.ledger.balance + this.stake + this.rivals.reduce((n, r) => n + r.wallet + r.staked(ts), 0n)
      + this.round.pot + this.ledger.treasury + this.ledger.burned;
  }

  // ------------------------------------------------------------------ money

  private log(label: string, amount: bigint) { post(this.ledger, this.day, label, amount); }
  private walletOf(id: HolderId) { return id === YOU ? this.ledger.balance : this.rival(id)!.wallet; }
  private credit(id: HolderId, label: string, amount: bigint) {
    if (amount <= 0n) return;
    if (id === YOU) this.log(label, amount); else this.rival(id)!.wallet += amount;
  }
  private debit(id: HolderId, label: string, amount: bigint) {
    if (id === YOU) this.log(label, -amount);
    else { const r = this.rival(id)!; if (r.wallet < amount) throw new Error(`${r.name} can't afford that.`); r.wallet -= amount; }
  }
  private payPot(id: HolderId, label: string, amount: bigint) { this.debit(id, label, amount); this.round.pot += amount; }
  private addWin(id: HolderId) { this.round.wins.set(id, (this.round.wins.get(id) ?? 0) + 1); }
  private addCaptured(id: HolderId, amount: bigint) { this.round.captured.set(id, (this.round.captured.get(id) ?? 0n) + amount); }

  // ------------------------------------------------------------------ build

  activateCore() {
    if (this.coreLevel > 0) throw new Error("Your Core is already active.");
    this.log("Core activated (stake)", -stakeAt(1));
    this.coreLevel = 1;
  }

  levelCost(level: number) { return level >= MAX_LEVEL ? null : topUpCost(level + 1); }

  levelUpCore() {
    const cost = this.levelCost(this.coreLevel);
    if (!this.coreLevel || cost === null) throw new Error("The Core can't level up.");
    if (!canAfford(this.ledger, cost)) throw new Error("Not enough simulated RF.");
    this.log(`Core level ${this.coreLevel + 1} (top-up)`, -cost);
    this.coreLevel++;
  }

  placeError(held: Held, friend: Friend, x: number, y: number): string | null {
    if (this.isPlaced(friend)) return "Already on one of your boards.";
    if (friend.generation < 1) return "Temporary Friends can't be placed.";
    if (held.region.garrison.length >= MAX_GARRISON) return `This region is full (${MAX_GARRISON} pieces).`;
    if (supplyUsed(held.region) + 1 > SUPPLY_PER_REGION) return `No supply left here (${SUPPLY_PER_REGION}).`;
    if (!buildable(held.region.board, x, y)) return "Can't build there.";
    if (held.region.garrison.some(p => p.x === x && p.y === y)) return "That tile is taken.";
    if (!canAfford(this.ledger, stakeAt(1))) return "Not enough simulated RF.";
    return null;
  }

  place(held: Held, friend: Friend, x: number, y: number) {
    const error = this.placeError(held, friend, x, y);
    if (error) throw new Error(error);
    this.log(`Placed ${pieceKey(friend)} at ${regionName(held.region)} (stake)`, -stakeAt(1));
    const piece: Piece = { key: pieceKey(friend), friend, level: 1, x, y };
    held.region.garrison.push(piece);
    return piece;
  }

  move(key: string, x: number, y: number) {
    const held = this.regionOf(key), piece = this.piece(key);
    if (!held || !piece) throw new Error("No such piece.");
    if (!buildable(held.region.board, x, y) || held.region.garrison.some(p => p.x === x && p.y === y)) throw new Error("Can't move there.");
    piece.x = x; piece.y = y;
  }

  levelUpError(key: string): string | null {
    const piece = this.piece(key), held = this.regionOf(key);
    if (!piece || !held) return "No such piece.";
    const cost = this.levelCost(piece.level);
    if (cost === null) return "Already max level.";
    if (supplyUsed(held.region) + 1 > SUPPLY_PER_REGION) return `No supply left here (${SUPPLY_PER_REGION}).`;
    if (!canAfford(this.ledger, cost)) return "Not enough simulated RF.";
    return null;
  }

  levelUp(key: string) {
    const error = this.levelUpError(key);
    if (error) throw new Error(error);
    const piece = this.piece(key)!;
    this.log(`${key} level ${piece.level + 1} (top-up)`, -this.levelCost(piece.level)!);
    piece.level++;
  }

  /** Taking a piece off a board returns its stake. */
  remove(key: string) {
    const held = this.regionOf(key), piece = this.piece(key);
    if (!held || !piece) throw new Error("No such piece.");
    if (this.away.has(key)) throw new Error("That piece is out raiding.");
    held.region.garrison = held.region.garrison.filter(p => p !== piece);
    this.log(`Removed ${key} (stake returned)`, stakeAt(piece.level));
  }

  // ------------------------------------------------------------------ territory

  expand(dx: number, dy: number) {
    if (!this.coreLevel) throw new Error("Activate your Core first.");
    if (!canAfford(this.ledger, rf(EXPAND_COST))) throw new Error(`Expanding costs ${EXPAND_COST} RF.`);
    if (!this.expandOptions().some(o => o.dx === dx && o.dy === dy)) throw new Error("Expand into a region next to one you own.");
    const r = expandTerritory(this.territory, dx, dy);
    this.payPot(YOU, `Expanded to ${regionName(r)} (to pot)`, rf(EXPAND_COST));
    return r;
  }

  /** After beating a rival today: one of its expanded regions may be bought out. One flag per win. */
  claimable(rivalIndex: number): Region[] {
    if (this.wonToday !== rivalIndex) return [];
    return this.rivals[rivalIndex].territory.regions.filter(r => !r.home && r.holder !== YOU);
  }

  claim(rivalIndex: number, key: string) {
    const rival = this.rivals[rivalIndex];
    const r = findRegion(rival.territory, key);
    if (!r || !this.claimable(rivalIndex).includes(r)) throw new Error("You can buy one flag from a base you beat today.");
    if (!canAfford(this.ledger, rf(CLAIM_COST))) throw new Error(`A flag costs ${CLAIM_COST} RF.`);
    this.payPot(YOU, `Claimed ${rival.name}'s ${regionName(r)} (to pot)`, rf(CLAIM_COST));
    this.evict(r, "claimed");
    r.holder = YOU;
    this.wonToday = null;
    return r;
  }

  /** Your own region with its flag down (no holder): pay to raise it again. */
  reclaim(key: string) {
    const r = findRegion(this.territory, key);
    if (!r || r.home) throw new Error("No such region.");
    if (r.holder !== null) throw new Error(r.holder === YOU ? "You already hold it." : "Evict the resident first (a reclaim raid).");
    if (!canAfford(this.ledger, rf(RECLAIM_COST))) throw new Error(`Reclaiming costs ${RECLAIM_COST} RF.`);
    this.payPot(YOU, `Reclaimed ${regionName(r)} (to pot)`, rf(RECLAIM_COST));
    r.holder = YOU;
    r.garrison = [];
    return r;
  }

  /** Clear a region's garrison, returning each piece's stake to whoever held it. */
  private evict(r: Region, why: string) {
    if (r.holder) for (const p of r.garrison) this.credit(r.holder, `${why}: ${p.key} stake returned`, stakeAt(p.level));
    r.garrison = [];
  }

  // ------------------------------------------------------------------ raids

  /** Validation shared by raids and reclaim raids; `kind` picks which daily allowance applies. */
  raidError(attackerKeys: readonly string[], kind: "raid" | "reclaim" = "raid", rivalIndex?: number): string | null {
    if (kind === "raid" && this.raidedToday) return "You already raided today.";
    if (kind === "reclaim" && this.reclaimedToday) return "You already made a reclaim raid today.";
    if (!this.coreLevel) return "Activate your Core first.";
    if (!attackerKeys.length) return "Pick at least one attacker.";
    if (attackerKeys.length > MAX_RAIDERS) return `Up to ${MAX_RAIDERS} attackers.`;
    if (new Set(attackerKeys).size !== attackerKeys.length) return "Each piece can only go once.";
    if (attackerKeys.some(k => !this.piece(k))) return "Attackers come from your garrisons.";
    if (attackerKeys.some(k => this.away.has(k))) return "Some of those pieces are already out raiding.";
    if (rivalIndex !== undefined && this.isProtected(this.rivals[rivalIndex].id)) return "They're rebuilding: protected from raids.";
    if (!canAfford(this.ledger, feeFor(attackerKeys.length))) return `The raid fee is ${formatRf(feeFor(attackerKeys.length))} RF.`;
    return null;
  }

  private partyFrom(keys: readonly string[]): AttackerInput[] {
    return keys.map(k => { const p = this.piece(k)!; return { key: p.key, friend: p.friend, level: p.level }; });
  }

  /**
   * Settle a campaign region by region, paying whoever actually held each region (owner or resident):
   * captured stakes go to the attacker (10% burned), Haggle halves return to the holder, a fallen Core resets that
   * home (survivors refunded) and starts a rebuild cooldown. The fee's 80% goes to the treasury on a full clear,
   * otherwise to the holder of the region where the raid was stopped.
   */
  private settleCampaign(campaign: Campaign, target: Territory, attacker: HolderId, fee: bigint, only: boolean): { summary: SettlementSummary; net: bigint; reset: boolean } {
    const lines: { label: string; amount: bigint; to: LineTo }[] = [];
    let toYou = 0n, fromYou = attacker === YOU ? fee : 0n, burned = 0n, treasury = 0n, captured = 0n, reset = false;
    const toLine = (id: HolderId): LineTo => id === YOU ? "you" : "rival";
    const give = (id: HolderId, label: string, amount: bigint) => { if (amount <= 0n) return; this.credit(id, label, amount); if (id === YOU) toYou += amount; lines.push({ label, amount, to: toLine(id) }); };
    const capture = (label: string, gross: bigint, from: HolderId) => {
      const burn = percent(gross, CAPTURE_BURN_PERCENT);
      burned += burn; captured += gross - burn;
      if (from === YOU) fromYou += gross;
      give(attacker, label, gross - burn);
      lines.push({ label: `${label.replace("Took ", "")} 10%`, amount: burn, to: "burn" });
    };
    for (const b of campaign.battles) {
      const r = findRegion(target, b.regionKey)!;
      const holder = b.holder ?? target.owner;
      for (const key of b.result.defeated) {
        const piece = r.garrison.find(p => p.key === key);
        if (!piece) continue;
        const haggle = piece.friend.scenery === "Market" && unitStats(piece.friend, piece.level, r.board.scenery).affinity;
        const gross = haggle ? stakeAt(piece.level) / 2n : stakeAt(piece.level);
        r.garrison = r.garrison.filter(p => p !== piece);
        capture(`Took ${key}`, gross, holder);
        if (haggle) give(holder, `Haggle ${key}`, stakeAt(piece.level) - gross);
      }
      if (b.home && b.result.coreDown) {
        const owner = target.owner;
        const level = owner === YOU ? this.coreLevel : this.rivalOf(target)!.coreLevel;
        capture("Took Core", stakeAt(level), owner);
        for (const p of r.garrison) give(owner, `Reset ${p.key}`, stakeAt(p.level));
        r.garrison = [];
        if (owner === YOU) this.coreLevel = 0; else this.rivalOf(target)!.coreLevel = 0;
        this.protect(owner);
        reset = true;
      }
    }
    const feeBurn = percent(fee, FEE_BURN_PERCENT), feeRest = fee - feeBurn;
    burned += feeBurn;
    lines.push({ label: "Fee 20%", amount: feeBurn, to: "burn" });
    if (campaign.won) { treasury = feeRest; lines.push({ label: "Fee 80%", amount: feeRest, to: "treasury" }); }
    else {
      const stop = campaign.battles.find(b => !b.result.cleared);
      const stopper = stop ? stop.holder ?? target.owner : target.owner;
      give(stopper, "Fee 80% to defender", feeRest);
    }
    this.ledger.burned += burned;
    this.ledger.treasury += treasury;
    this.addCaptured(attacker, captured);
    if (campaign.won && !only) { this.addWin(attacker); this.protect(target.owner); }
    return { summary: Object.freeze({ lines: Object.freeze(lines), toYou, fromYou, burned, treasury }), net: toYou - fromYou, reset };
  }

  raid(rivalIndex: number, attackerKeys: readonly string[], lane: number, order?: readonly string[]): RaidRecord {
    const error = this.raidError(attackerKeys, "raid", rivalIndex);
    if (error) throw new Error(error);
    const rival = this.rivals[rivalIndex];
    if (!rival) throw new Error("Pick a rival base.");
    const snapshot: Snapshot = { territory: cloneTerritory(rival.territory), core: { friend: rival.core, level: rival.coreLevel }, only: null, rivalIndex, label: rival.name };
    const fee = feeFor(attackerKeys.length);
    this.log(`Raid fee: ${rival.name} (${attackerKeys.length} attackers)`, -fee);
    this.protectedUntil.delete(YOU); // Raiding someone ends your own rebuild cooldown.
    const campaign = runCampaign({
      target: rival.territory, attacker: YOU, attackers: this.partyFrom(attackerKeys), lane, order,
      defendersOf: r => this.present(r),
      seed: mixSeed("raid", this.player.tokenId, this.day, rival.id, lane, ...attackerKeys),
      atkMul: this.bonus(YOU), defMul: h => this.bonus(h), core: { friend: rival.core, level: rival.coreLevel },
    });
    const { summary, net, reset } = this.settleCampaign(campaign, rival.territory, YOU, fee, false);
    for (const k of attackerKeys) this.away.add(k);
    this.raidedToday = true;
    if (campaign.won) this.wonToday = rivalIndex;
    const record: RaidRecord = { kind: "raid", day: this.day, title: `RAID · ${rival.difficulty.toUpperCase()}`, attacker: YOU, defender: rival.id, rivalIndex,
      campaign, settlement: summary, net, reset, claimable: this.claimable(rivalIndex).map(r => r.key), reclaimable: null, snapshot };
    this.history.push(record);
    return record;
  }

  /** Fight the resident on one of your own regions (its own daily allowance). Clearing drops their flag; no win is scored. */
  reclaimRaid(key: string, attackerKeys: readonly string[], lane: number): RaidRecord {
    const error = this.raidError(attackerKeys, "reclaim");
    if (error) throw new Error(error);
    const r = findRegion(this.territory, key);
    if (!r || r.home || r.holder === YOU || r.holder === null) throw new Error("That region has no resident to evict.");
    const resident = this.rival(r.holder)!;
    const snapshot: Snapshot = { territory: cloneTerritory(this.territory), core: null, only: key, rivalIndex: resident.index, label: `${regionName(r)} (RESIDENT ${resident.name})` };
    const fee = feeFor(attackerKeys.length);
    this.log(`Reclaim raid fee: ${regionName(r)} (${attackerKeys.length} attackers)`, -fee);
    const campaign = runCampaign({
      target: this.territory, attacker: YOU, attackers: this.partyFrom(attackerKeys), lane, only: key, defendersOf: x => this.present(x),
      seed: mixSeed("reclaim", this.player.tokenId, this.day, key, lane, ...attackerKeys),
      atkMul: this.bonus(YOU), defMul: h => this.bonus(h), core: null,
    });
    const { summary, net } = this.settleCampaign(campaign, this.territory, YOU, fee, true);
    for (const k of attackerKeys) this.away.add(k);
    this.reclaimedToday = true;
    if (campaign.won) { this.evict(r, "Evicted"); r.holder = null; }
    const record: RaidRecord = { kind: "reclaim", day: this.day, title: `RECLAIM · ${regionName(r)}`, attacker: YOU, defender: resident.id, rivalIndex: resident.index,
      campaign, settlement: summary, net, reset: false, claimable: [], reclaimable: campaign.won ? key : null, snapshot };
    this.history.push(record);
    return record;
  }

  /** Free re-fight of a raid against its snapshot, with any of your pieces: no fee, no stakes, no score, no away. */
  practice(snapshot: Snapshot, attackerKeys: readonly string[], lane: number, order?: readonly string[]): RaidRecord {
    if (!attackerKeys.length || attackerKeys.length > MAX_RAIDERS || new Set(attackerKeys).size !== attackerKeys.length || attackerKeys.some(k => !this.piece(k))) {
      throw new Error(`Pick 1 to ${MAX_RAIDERS} different pieces.`);
    }
    const target = cloneTerritory(snapshot.territory);
    const campaign = runCampaign({
      target, attacker: YOU, attackers: this.partyFrom(attackerKeys), lane, order, only: snapshot.only ?? undefined,
      seed: mixSeed("practice", this.player.tokenId, this.day, lane, ...attackerKeys),
      atkMul: this.bonus(YOU), defMul: h => this.bonus(h), core: snapshot.core,
    });
    return { kind: "practice", day: this.day, title: `PRACTICE · ${snapshot.label}`, attacker: YOU, defender: target.owner, rivalIndex: snapshot.rivalIndex,
      campaign, settlement: EMPTY, net: 0n, reset: false, claimable: [], reclaimable: null, snapshot };
  }

  // ------------------------------------------------------------------ night

  private rngFor(tag: string) { return createRng(mixSeed(tag, this.player.tokenId, this.day, this.block)); }

  /** Rival and size for a threat level: Easy at 1-2, Medium at 3-5, Hard at 6+; 2 to 4 raiders. */
  static threatShape(threat: number) {
    return { difficulty: threat <= 2 ? 0 : threat <= 5 ? 1 : 2, size: Math.min(MAX_RAIDERS, 1 + Math.ceil(threat / 2)) };
  }

  /** Dawn: fix tonight's raid from the threat level and your whole territory's garrison. */
  private planTonight() {
    if (this.isProtected(YOU)) { this.tonight = null; return; }
    const { difficulty, size } = Session.threatShape(this.threat);
    const order = [difficulty, ...[0, 1, 2].filter(i => i !== difficulty).sort((a, b) => Math.abs(a - difficulty) - Math.abs(b - difficulty))];
    const rival = order.map(i => this.rivals[i]).find(r => r.present(r.home()).length > 0);
    if (!rival) { this.tonight = null; return; }
    const mine = this.territory.regions.flatMap(r => r.holder === YOU ? r.garrison : []);
    const pool = [...rival.present(rival.home())].sort((a, b) => b.level - a.level || a.key.localeCompare(b.key));
    const picked: Piece[] = [];
    for (const c of counterPicks(mine)) { const f = pool.find(p => p.friend.character === c && !picked.includes(p)); if (f && picked.length < size) picked.push(f); }
    for (const p of pool) if (picked.length < size && !picked.includes(p)) picked.push(p);
    this.tonight = Object.freeze({ rivalId: rival.id, keys: Object.freeze(picked.map(p => p.key)), threat: this.threat });
  }

  /** Tonight's raid as it stands: the planned raiders your raid today knocked out stay home. */
  incoming(): Incoming | null {
    if (!this.tonight || this.isProtected(YOU)) return null;
    const rival = this.rival(this.tonight.rivalId)!;
    const home = rival.present(rival.home());
    const party = this.tonight.keys.map(k => home.find(p => p.key === k)).filter((p): p is Piece => Boolean(p))
      .map(p => ({ key: p.key, friend: p.friend, level: p.level }));
    const lane = weakestLane(this.home().board, this.present(this.home()));
    return { rival, party, lane, regions: this.territory.regions.length, threat: this.tonight.threat, thinned: this.tonight.keys.length - party.length };
  }

  /** Run the night: tonight's raid on you, each ghost's single action, the clock, a round payout, the morning. */
  endDay(): NightReport {
    if (!this.coreLevel && !this.isProtected(YOU)) throw new Error("Activate your Core first.");
    const records: RaidRecord[] = [], news: string[] = [];
    const rng = this.rngFor("night");
    const acted = new Set<HolderId>();
    // 1. Tonight's raid on your territory.
    const incoming = this.incoming();
    if (incoming && incoming.party.length) {
      const { rival, party, lane } = incoming;
      acted.add(rival.id);
      const fee = feeFor(party.length);
      if (rival.wallet >= fee) {
        this.debit(rival.id, "fee", fee);
        const campaign = runCampaign({
          target: this.territory, attacker: rival.id, attackers: party, lane, defendersOf: r => this.present(r),
          order: this.ghostRoute(this.territory),
          seed: mixSeed("defense", this.player.tokenId, this.day, rival.id), atkMul: this.bonus(rival.id), defMul: h => this.bonus(h),
          core: { friend: this.player, level: this.coreLevel },
        });
        this.ghostLosses(rival, campaign);
        const { summary, net, reset } = this.settleCampaign(campaign, this.territory, rival.id, fee, false);
        if (campaign.won) {
          this.threat = Math.max(1, this.threat - 1);
          const claimed = this.ghostClaim(rival, this.territory, party, campaign, rng);
          news.push(claimed ? `${rival.name} BEAT YOU AND CLAIMED YOUR ${claimed} FLAG FOR ${CLAIM_COST} RF (TO THE POT).` : `${rival.name} CLEARED YOUR TERRITORY: A WIN FOR THEM.`);
          news.push(`YOU ARE PROTECTED FOR ${REBUILD_NIGHTS} NIGHTS WHILE YOU REBUILD.`);
        } else {
          if (reset) { this.threat = Math.max(1, this.threat - 1); news.push(`${rival.name} TOOK YOUR CORE. YOU ARE PROTECTED FOR ${REBUILD_NIGHTS} NIGHTS.`); }
          else { this.threat = Math.min(MAX_THREAT, this.threat + 1); news.push(`${rival.name} RAIDED YOU AND FAILED. THREAT RISES TO ${this.threat}.`); }
        }
        records.push({ kind: "defense", day: this.day, title: `DEFENSE · ${rival.name}`, attacker: rival.id, defender: YOU, rivalIndex: rival.index,
          campaign, settlement: summary, net, reset, claimable: [], reclaimable: null, snapshot: null });
      } else news.push(`${rival.name} COULDN'T AFFORD TONIGHT'S RAID.`);
    } else if (incoming) news.push(`YOUR RAID TODAY KNOCKED OUT ALL OF ${incoming.rival.name}'S PLANNED RAIDERS.`);
    else news.push(this.isProtected(YOU) ? "YOU'RE PROTECTED WHILE YOU REBUILD: NO RAID TONIGHT." : "NO RIVAL COULD RAID YOU TONIGHT.");
    // 2. Each ghost gets one action.
    for (const rival of this.rivals) this.ghostTurn(rival, rng, records, news, acted.has(rival.id));
    // 3. The clock, the round and the morning.
    this.block += BLOCKS_PER_DAY;
    this.day++;
    let payout: Payout | null = null;
    if (this.block >= this.round.endBlock) {
      payout = this.payOut();
      news.push(...payout.paid.map(p => `ROUND ${payout!.round} POT: ${formatRf(p.amount)} RF TO ${this.holderName(p.id)}.`));
      if (this.round.pot) news.push(`THE TREASURY SEEDS ROUND ${this.round.index} WITH ${formatRf(this.round.pot)} RF.`);
    }
    for (const r of this.rivals) r.restore(this.territories());
    this.away.clear();
    this.raidedToday = false;
    this.reclaimedToday = false;
    this.wonToday = null;
    this.planTonight();
    return Object.freeze({ records: Object.freeze(records), news: Object.freeze(news), payout });
  }

  /** Ghost raiders knocked out tonight sit out until morning (still staked). */
  private ghostLosses(rival: Rival, campaign: Campaign) {
    for (const a of campaign.attackersLeft) if (a.hpFraction <= 0) rival.down.add(a.key);
  }

  /** Ghosts pick the region with the fewest defenders first; home last only if it's no weaker. */
  private ghostRoute(t: Territory) {
    return [...t.regions].sort((a, b) => this.present(a).length - this.present(b).length || (a.home ? 1 : 0) - (b.home ? 1 : 0)).map(r => r.key);
  }

  /** After a win, a ghost may buy one flag (50%) if it can afford it; its surviving raiders move in. */
  private ghostClaim(rival: Rival, target: Territory, party: readonly AttackerInput[], campaign: Campaign, rng: Rng) {
    const options = target.regions.filter(r => !r.home && r.holder !== rival.id);
    const survivors = party.filter(a => (campaign.attackersLeft.find(x => x.key === a.key)?.hpFraction ?? 0) > 0);
    if (!options.length || !survivors.length || !rng.chance(50) || rival.wallet < rf(CLAIM_COST) + GHOST_RESERVE) return null;
    const r = options[rng.int(options.length)];
    this.payPot(rival.id, "claim", rf(CLAIM_COST));
    this.evict(r, "Evicted");
    rival.moveIn(r, survivors, rng);
    return regionName(r);
  }

  private ghostTurn(rival: Rival, rng: Rng, records: RaidRecord[], news: string[], alreadyRaided: boolean) {
    // Purchases don't use the night's action: raise dropped flags it can afford.
    for (const r of rival.territory.regions) {
      if (r.home || r.holder !== null || rival.wallet < rf(RECLAIM_COST) + GHOST_RESERVE) continue;
      this.payPot(rival.id, "reclaim", rf(RECLAIM_COST));
      r.holder = rival.id;
      news.push(`${rival.name} RECLAIMED ITS ${regionName(r)} FLAG FOR ${RECLAIM_COST} RF (TO THE POT).`);
    }
    if (alreadyRaided) return;
    // One raid: evict a resident from its own land (60%), else raid another ghost that isn't rebuilding.
    const occupied = rival.territory.regions.filter(r => !r.home && r.holder !== null && r.holder !== rival.id);
    if (occupied.length && rng.chance(60)) {
      const r = occupied[rng.int(occupied.length)];
      const party = rival.party(3, rng);
      const fee = feeFor(party.length);
      if (!party.length || rival.wallet < fee) return;
      const resident = r.holder!;
      this.debit(rival.id, "fee", fee);
      const campaign = runCampaign({ target: rival.territory, attacker: rival.id, attackers: party, lane: rng.int(3), only: r.key,
        defendersOf: x => this.present(x), seed: mixSeed("evict", rival.id, this.day, r.key), atkMul: this.bonus(rival.id), defMul: h => this.bonus(h), core: null });
      this.ghostLosses(rival, campaign);
      const { summary, net } = this.settleCampaign(campaign, rival.territory, rival.id, fee, true);
      if (resident === YOU) {
        records.push({ kind: "outpost", day: this.day, title: `OUTPOST · ${regionName(r)} AT ${rival.name}`, attacker: rival.id, defender: YOU, rivalIndex: rival.index,
          campaign, settlement: summary, net, reset: false, claimable: [], reclaimable: null, snapshot: null });
        news.push(campaign.won ? `${rival.name} EVICTED YOU FROM ITS ${regionName(r)}.` : `YOUR OUTPOST AT ${rival.name}'S ${regionName(r)} HELD.`);
      } else if (campaign.won) news.push(`${rival.name} EVICTED ${this.holderName(resident)} FROM ITS ${regionName(r)}.`);
      if (campaign.won) { this.evict(r, "Evicted"); r.holder = null; }
      return;
    }
    const targets = this.rivals.filter(x => x !== rival && !this.isProtected(x.id) && x.present(x.home()).length);
    if (!targets.length) return;
    const target = targets[rng.int(targets.length)];
    const party = rival.party(2 + rng.int(3), rng);
    const fee = feeFor(party.length);
    if (!party.length || rival.wallet < fee + GHOST_RESERVE) return;
    this.debit(rival.id, "fee", fee);
    const campaign = runCampaign({ target: target.territory, attacker: rival.id, attackers: party, lane: rng.int(3), order: this.ghostRoute(target.territory),
      defendersOf: x => this.present(x), seed: mixSeed("war", rival.id, target.id, this.day), atkMul: this.bonus(rival.id), defMul: h => this.bonus(h),
      core: { friend: target.core, level: target.coreLevel } });
    this.ghostLosses(rival, campaign);
    this.settleCampaign(campaign, target.territory, rival.id, fee, false);
    const mine = campaign.battles.filter(b => b.holder === YOU);
    if (mine.length) news.push(`${rival.name} RAIDED ${target.name}: YOUR OUTPOST${mine.length > 1 ? "S" : ""} ${mine.map(b => b.name).join(", ")} ${mine.every(b => b.result.cleared) ? "FELL" : "HELD"}.`);
    if (!campaign.won) { news.push(`${rival.name} RAIDED ${target.name} AND FAILED.`); return; }
    const claimed = this.ghostClaim(rival, target.territory, party, campaign, rng);
    news.push(claimed ? `${rival.name} BEAT ${target.name} AND CLAIMED ITS ${claimed} FLAG FOR ${CLAIM_COST} RF.` : `${rival.name} CLEARED ${target.name}'S TERRITORY.`);
  }

  // ------------------------------------------------------------------ round

  private newRound(): Round {
    const index = Math.floor(this.block / ROUND_BLOCKS);
    return { index, startBlock: index * ROUND_BLOCKS, endBlock: (index + 1) * ROUND_BLOCKS, pot: 0n, wins: new Map(), captured: new Map() };
  }

  get blocksLeft() { return Math.max(0, this.round.endBlock - this.block); }
  get daysLeft() { return Math.max(1, Math.ceil(this.blocksLeft / BLOCKS_PER_DAY)); }

  standings(): Standing[] {
    const all: Standing[] = [{ id: YOU, name: `YOU #${this.player.tokenId}`, wins: this.round.wins.get(YOU) ?? 0, captured: this.round.captured.get(YOU) ?? 0n, you: true },
      ...this.rivals.map(r => ({ id: r.id, name: r.name, wins: this.round.wins.get(r.id) ?? 0, captured: this.round.captured.get(r.id) ?? 0n, you: false }))];
    return all.sort((a, b) => b.wins - a.wins || (b.captured > a.captured ? 1 : b.captured < a.captured ? -1 : 0) || a.id.localeCompare(b.id));
  }

  /** Pay the pot 50/25/25 (any rounding dust stays for the next round), then open the next round seeded by the treasury. */
  private payOut(): Payout {
    const standings = this.standings();
    const pot = this.round.pot;
    const paid = POT_SPLIT.map((pct, i) => standings[i] ? { id: standings[i].id, amount: percent(pot, pct) } : null)
      .filter((p): p is { id: HolderId; amount: bigint } => p !== null && p.amount > 0n);
    let left = pot;
    for (const p of paid) { this.credit(p.id, `Round ${this.round.index} pot payout`, p.amount); left -= p.amount; }
    const payout: Payout = Object.freeze({ round: this.round.index, pot, standings: Object.freeze(standings), paid: Object.freeze(paid) });
    this.round = this.newRound();
    this.round.pot = left + this.ledger.treasury;
    this.ledger.treasury = 0n;
    return payout;
  }

  /** Out of RF with no Core: restart your simulated ledger rather than leave you stuck. The ghosts keep their state. */
  restart() {
    for (const h of this.held()) { h.region.garrison = []; if (!h.region.home && h.territory.owner !== YOU) h.region.holder = null; }
    this.territory.regions = this.territory.regions.filter(r => r.home);
    this.ledger = { ...createLedger(this.startBalance), burned: this.ledger.burned, treasury: this.ledger.treasury };
    this.away.clear(); this.coreLevel = 0; this.raidedToday = false; this.reclaimedToday = false; this.wonToday = null; this.threat = 1;
    this.activateCore();
    this.planTonight();
  }
}

export { routeOf };
export type { Board, Piece, Region, Territory };
