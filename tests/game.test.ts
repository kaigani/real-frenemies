import assert from "node:assert/strict";
import { test } from "node:test";
import { runCampaign } from "../game/src/campaign.ts";
import { feeFor, formatRf, rf, settle, splitProRata } from "../game/src/economy.ts";
import { CHARACTERS, POOL, SCENERIES } from "../game/src/friends.ts";
import { buildRivals } from "../game/src/ghosts.ts";
import { traitsFromTokenUri } from "../game/src/onchain-parse.ts";
import { explain } from "../game/src/explain.ts";
import { createRng } from "../game/src/rng.ts";
import { BLOCKS_PER_DAY, CLAIM_COST, EXPAND_COST, GRID_H, GRID_W, RECLAIM_COST, ROUND_BLOCKS, territoryMultiplier, TICK_CAP, unitStats } from "../game/src/rules.ts";
import { Session } from "../game/src/session.ts";
import { simulate } from "../game/src/sim.ts";
import { buildable, generateBoard, tileAt } from "../game/src/terrain.ts";
import { createTerritory, expandTerritory, expansionOptions, YOU } from "../game/src/territory.ts";

const player = POOL.find(f => f.tokenId === 7730n)!;
const START = rf(500);

test("recruit pool covers every Character and Scenery with hardwired Friends", () => {
  assert.ok(POOL.length >= 60);
  for (const c of CHARACTERS) assert.ok(POOL.filter(f => f.character === c).length >= 6, c);
  for (const s of SCENERIES) assert.ok(POOL.some(f => f.scenery === s), s);
  assert.ok(POOL.every(f => f.generation >= 1 && f.frames.length === 64));
});

test("xorshift32 is deterministic and never zero", () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 1000; i++) { const x = a.next(); assert.equal(x, b.next()); assert.notEqual(x, 0); }
});

test("bases and regions are reproducible from the token and keep the entry columns and Core clear", () => {
  for (const f of POOL) {
    const one = generateBoard(f.tokenId, f.seed, f.scenery), two = generateBoard(f.tokenId, f.seed, f.scenery);
    assert.deepEqual(one, two);
    assert.equal(one.home, true);
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < 2; x++) assert.equal(tileAt(one, x, y).kind, "ground");
    assert.equal(tileAt(one, one.core.x, one.core.y).kind, "ground");
    assert.equal(buildable(one, one.core.x, one.core.y), false);
  }
  const t = createTerritory(YOU, player);
  assert.equal(expansionOptions(t).length, 4);
  const east = expandTerritory(t, 1, 0);
  assert.equal(east.home, false);
  assert.deepEqual(east.board, generateBoard(player.tokenId, player.seed, east.board.scenery, { dx: 1, dy: 0 }));
  assert.equal(expansionOptions(t).length, 5);
});

test("the sim is a pure function of its inputs and wins by clearing every defender", () => {
  const [, , hard] = buildRivals(POOL, new Set([player.tokenId]), 7);
  const home = hard.home();
  const attackers = POOL.filter(f => !hard.friendIds().has(f.tokenId)).slice(0, 4).map(f => ({ key: `#${f.tokenId}`, friend: f, level: 4 }));
  const input = { board: home.board, core: { key: "core", friend: hard.core, level: hard.coreLevel, x: home.board.core.x, y: home.board.core.y },
    defenders: home.garrison, attackers, lane: 1, seed: 99, atkMul: 1.3 };
  const a = simulate(input), b = simulate(input);
  assert.deepEqual(a.events, b.events);
  assert.ok(a.ticks <= TICK_CAP);
  assert.equal(a.events.at(-1)!.e, "end");
  assert.equal(a.cleared, a.winner === "atk");
  if (a.cleared) assert.equal(a.defeated.length, new Set(home.garrison.map(p => p.key)).size);
  assert.equal(a.attackersLeft.length, 4);
  for (const x of a.attackersLeft) assert.ok(x.hpFraction >= 0 && x.hpFraction <= 1);
});

test("an expanded region without a Core is fought to the last defender; wounds carry between regions", () => {
  const [, medium] = buildRivals(POOL, new Set([player.tokenId]), 3);
  assert.equal(medium.territory.regions.length, 2);
  const attackers = POOL.filter(f => !medium.friendIds().has(f.tokenId)).slice(0, 4).map(f => ({ key: `#${f.tokenId}`, friend: f, level: 4 }));
  const c = runCampaign({ target: medium.territory, attacker: YOU, attackers, lane: 1, seed: 5, atkMul: 1.45, defMul: () => 1,
    core: { friend: medium.core, level: medium.coreLevel } });
  assert.equal(c.battles[0].core, null);
  assert.equal(c.battles[0].home, false);
  if (c.battles.length > 1) {
    const carried = c.battles[1].result.units.filter(u => u.side === "atk");
    for (const u of carried) {
      const left = c.battles[0].result.attackersLeft.find(x => x.key === u.key)!;
      assert.ok(left.hpFraction > 0);
      assert.ok(u.hp <= u.maxHp);
    }
  }
  assert.equal(c.won, c.cleared.length === 2);
});

test("every event references a unit that exists and positions stay on the grid", () => {
  const rivals = buildRivals(POOL, new Set(), 11);
  for (let day = 1; day <= 6; day++) {
    const rival = rivals[day % 3];
    const attackers = POOL.filter(f => !rival.friendIds().has(f.tokenId)).slice(day, day + 4).map(f => ({ key: `#${f.tokenId}`, friend: f, level: 1 + (day % 4) }));
    const c = runCampaign({ target: rival.territory, attacker: YOU, attackers, lane: day % 3, seed: day, atkMul: 1, defMul: () => 1, core: { friend: rival.core, level: rival.coreLevel } });
    for (const b of c.battles) for (const e of b.result.events) {
      if ("id" in e && e.id >= 0) assert.ok(e.id < b.result.units.length);
      if (e.e === "move") assert.ok(e.x >= 0 && e.y >= 0 && e.x < GRID_W && e.y < GRID_H);
    }
  }
});

test("stats follow the generation budget, the level table and the territory multipliers", () => {
  const skeleton = { ...POOL.find(f => f.character === "Skeleton")!, generation: 5, activationTier: 0, floor: "Cross Grid" as const };
  assert.deepEqual([unitStats(skeleton, 1, "Garden").maxHp, unitStats(skeleton, 1, "Garden").dmg], [7, 2]);
  assert.deepEqual([unitStats(skeleton, 4, "Garden").maxHp, unitStats(skeleton, 4, "Garden").dmg], [14, 5]);
  assert.equal(unitStats(skeleton, 4, "Garden").upgrade, true);
  assert.equal(unitStats({ ...skeleton, activationTier: 4 }, 3, "Garden").upgrade, true);
  assert.equal(unitStats(skeleton, 1, "Garden", { core: true }).maxHp, 11);
  assert.equal(territoryMultiplier(0), 1);
  assert.equal(territoryMultiplier(2), 1.3);
  assert.equal(territoryMultiplier(9), 1.6);
  assert.equal(unitStats(skeleton, 4, "Garden", { attacking: true, atkMul: 1.3 }).dmg, 7);
  assert.equal(unitStats(skeleton, 4, "Garden", { atkMul: 1.3 }).dmg, 5);
  assert.equal(unitStats(skeleton, 4, "Garden", { defMul: 1.3 }).maxHp, 18);
});

test("settlement: burns, captures, fee split and reset refunds are exact", () => {
  const failed = settle({ fee: feeFor(3), coreStake: rf(2), coreDown: false,
    defeated: [{ key: "a", stake: rf(4), haggle: false }, { key: "b", stake: rf(2), haggle: true }],
    survivors: [{ key: "c", stake: rf(1), haggle: false }] });
  assert.equal(failed.burned, rf(1) + rf(4) / 10n + rf(1) / 10n);
  assert.equal(failed.toAttacker, (rf(4) + rf(1)) * 9n / 10n);
  assert.equal(failed.toDefender, rf(4) + rf(1));
  const won = settle({ fee: feeFor(2), coreStake: rf(4), coreDown: true, defeated: [], survivors: [{ key: "c", stake: rf(8), haggle: false }] });
  assert.equal(won.toAttacker, rf(4) * 9n / 10n);
  assert.equal(won.toTreasury, rf(4) * 8n / 10n);
  assert.deepEqual(splitProRata(10n, [1n, 2n, 2n]), [2n, 4n, 4n]);
  assert.equal(formatRf(rf(3) / 2n, true), "+1.5");
});

/** Place `count` pieces in a held region at the given level, nearest the Core first (fixture helper). */
function fill(s: Session, heldId: string, count: number, level = 1) {
  const held = s.heldById(heldId)!;
  const spots: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID_H; y++) for (let x = 3; x < GRID_W; x++) if (buildable(held.region.board, x, y) && !held.region.garrison.some(p => p.x === x && p.y === y)) spots.push({ x, y });
  spots.sort((a, b) => Math.max(Math.abs(a.x - held.region.board.core.x), Math.abs(a.y - held.region.board.core.y)) - Math.max(Math.abs(b.x - held.region.board.core.x), Math.abs(b.y - held.region.board.core.y)) || a.y - b.y || a.x - b.x);
  const friends = s.pool.filter(f => !s.isPlaced(f));
  for (let i = 0; i < count; i++) {
    const p = s.place(held, friends[i], spots[i].x, spots[i].y);
    while (p.level < level) s.levelUp(p.key);
  }
}

test("a session day: stake, level, raid, night; the clock starts at the live round's first block", () => {
  const s = new Session(player, POOL, START, ROUND_BLOCKS + 256);
  assert.equal(s.coreLevel, 1);
  assert.equal(s.block, ROUND_BLOCKS, "the session starts at the first block of the live round");
  assert.equal(s.round.index, 1);
  assert.equal(s.round.pot, 0n, "no RF appears from nowhere in the pot");
  const home = s.held()[0];
  fill(s, home.id, 3);
  s.levelUp(s.pieces()[0].key);
  assert.equal(s.ledger.balance, START - rf(1 + 3 + 1));
  const before = s.ledger.balance;
  const raid = s.raid(0, [s.pieces()[0].key, s.pieces()[1].key], 1);
  assert.equal(s.ledger.balance, before - feeFor(2) + raid.settlement.toYou);
  assert.equal(s.present(s.home()).length, 1);
  assert.ok(raid.snapshot, "raids keep a snapshot for practice");
  s.endDay();
  assert.equal(s.day, 2);
  assert.equal(s.block, ROUND_BLOCKS + BLOCKS_PER_DAY);
  assert.equal(s.away.size, 0);
  assert.equal(s.standings().length, 4);
});

test("RF is conserved across every actor over a two-week session", () => {
  const s = new Session(player, POOL, START, 0);
  const total = s.totalRf();
  fill(s, s.held()[0].id, 4, 2);
  assert.equal(s.totalRf(), total);
  s.expand(1, 0);
  fill(s, `${YOU}/1,0`, 2);
  assert.equal(s.totalRf(), total);
  for (let day = 0; day < 14; day++) {
    if (!s.coreLevel && !s.isProtected(YOU)) s.activateCore();
    const party = s.pieces().filter(p => !s.away.has(p.key)).slice(0, 3).map(p => p.key);
    const target = s.rivals.findIndex(r => !s.isProtected(r.id));
    if (target >= 0 && party.length && !s.raidError(party, "raid", target)) {
      const r = s.raid(target, party, day % 3);
      if (r.claimable.length && s.ledger.balance > rf(CLAIM_COST)) s.claim(target, r.claimable[0]);
    }
    s.endDay();
    assert.equal(s.totalRf(), total, `day ${s.day}: RF created or destroyed`);
  }
});

test("defect: the rebuild cooldown lasts two nights after a Core loss or a beating", () => {
  for (const f of POOL) {
    const s = new Session(f, POOL, START, 0);
    const report = s.endDay();
    const d = report.records.find(r => r.kind === "defense");
    if (!d || !(d.reset || d.campaign.won)) continue;
    assert.equal(s.isProtected(YOU), true);
    assert.equal(s.incoming(), null, "no raid the night after");
    s.endDay();
    assert.equal(s.isProtected(YOU), true, "still protected on the second night");
    assert.equal(s.incoming(), null);
    s.endDay();
    assert.equal(s.isProtected(YOU), false, "protection ends after two nights");
    return;
  }
  assert.fail("no fixture produced a nightly loss");
});

test("rebuild cooldown: a beaten rival can't be raided; raiding ends your own protection", () => {
  const s = new Session(player, POOL, START, 0);
  fill(s, s.held()[0].id, 3);
  s.protectedUntil.set(s.rivals[1].id, s.block + 2 * BLOCKS_PER_DAY + 1);
  assert.match(s.raidError([s.pieces()[0].key], "raid", 1) ?? "", /rebuilding/i);
  s.protectedUntil.set(YOU, s.block + 2 * BLOCKS_PER_DAY + 1);
  assert.equal(s.isProtected(YOU), true);
  s.raid(0, [s.pieces()[0].key], 1);
  assert.equal(s.isProtected(YOU), false);
});

test("defect: duplicate raiders, away raiders and a second raid are rejected", () => {
  const s = new Session(player, POOL, START, 0);
  fill(s, s.held()[0].id, 3);
  const [a, b] = s.pieces().map(p => p.key);
  assert.match(s.raidError([a, a, a, a]) ?? "", /once/);
  s.raid(0, [a], 1);
  assert.match(s.raidError([b]) ?? "", /already raided/);
  assert.match(s.raidError([a], "reclaim") ?? "", /out raiding/);
  assert.equal(s.raidError([b], "reclaim"), null, "reclaim raids have their own allowance");
});

test("defect: one flag per win", () => {
  const s = new Session(player, POOL, rf(3000), 0);
  s.wonToday = 2;
  const keys = s.claimable(2).map(r => r.key);
  assert.ok(keys.length >= 2, "Hard has two expansions");
  s.claim(2, keys[0]);
  assert.throws(() => s.claim(2, keys[1]), /one flag/i);
  assert.equal(s.held().filter(h => h.rival).length, 1);
});

test("defect: a reclaim raid's fee share goes to the resident, not to you", () => {
  const s = new Session(player, POOL, START, 0);
  const r = s.expand(1, 0);
  const resident = s.rivals[0];
  r.holder = resident.id;
  r.garrison = [{ ...resident.home().garrison[0] }];
  resident.home().garrison = resident.home().garrison.slice(1);
  fill(s, s.held()[0].id, 1);
  const walletBefore = resident.wallet;
  const rec = s.reclaimRaid(r.key, [s.pieces()[0].key], 1);
  const share = rec.settlement.lines.find(l => l.label.includes("80%"))!;
  if (rec.campaign.won) assert.equal(share.to, "treasury");
  else { assert.equal(share.to, "rival"); assert.ok(resident.wallet > walletBefore); }
  assert.ok(!rec.settlement.lines.some(l => l.to === "you" && l.label.includes("Fee")), "you never receive your own fee");
});

test("defect: losses on an outpost inside a rival territory are charged to you", () => {
  const s = new Session(player, POOL, rf(2000), 0);
  s.wonToday = 2;
  const hard = s.rivals[2];
  const outpost = s.claim(2, s.claimable(2)[0].key);
  fill(s, `${hard.id}/${outpost.key}`, 2);
  const stakeBefore = s.stake;
  // The owner evicts: build the eviction campaign directly through a night with the outpost occupied.
  for (let i = 0; i < 6 && outpost.holder === YOU; i++) {
    const report = s.endDay();
    const hit = report.records.find(r => r.kind === "outpost");
    if (hit) {
      assert.equal(hit.defender, YOU);
      const lost = hit.campaign.battles.flatMap(b => b.result.defeated).length;
      if (lost) assert.ok(hit.settlement.fromYou > 0n && s.stake < stakeBefore, "your defeated outpost pieces cost your stake");
      return;
    }
  }
});

test("territory: supply cap, garrison-gated bonus, and every purchase lands in the pot", () => {
  const s = new Session(player, POOL, rf(1500), 0);
  fill(s, s.held()[0].id, 3, 4);
  assert.equal(s.supply(s.home()), 12);
  assert.throws(() => fill(s, s.held()[0].id, 1), /supply/i);
  const pot0 = s.round.pot, bal0 = s.ledger.balance;
  const east = s.expand(1, 0);
  assert.equal(s.round.pot, pot0 + rf(EXPAND_COST));
  assert.equal(s.ledger.balance, bal0 - rf(EXPAND_COST));
  assert.equal(s.bonus(YOU), 1, "an empty region gives no bonus");
  fill(s, `${YOU}/1,0`, 2);
  assert.equal(s.bonus(YOU), 1.15, "garrisoned with 2 pieces, it counts");
  s.wonToday = 2;
  const pot1 = s.round.pot;
  s.claim(2, s.claimable(2)[0].key);
  assert.equal(s.round.pot, pot1 + rf(CLAIM_COST));
  east.holder = null;
  const pot2 = s.round.pot;
  s.reclaim(east.key);
  assert.equal(s.round.pot, pot2 + rf(RECLAIM_COST));
});

test("tonight's raid is fixed at dawn: relocating or sending out identical strength can't downgrade it", () => {
  const plans = (["home", "expansion"] as const).map(where => {
    const s = new Session(player, POOL, START, 0);
    s.expand(1, 0);
    fill(s, where === "home" ? `${YOU}/0,0` : `${YOU}/1,0`, 3, 4);
    const before = s.incoming()!;
    s.raid(0, s.pieces().slice(0, 3).map(p => p.key), 1);
    const after = s.incoming()!;
    return { before: [before.rival.id, before.party.length], after: [after.rival.id, after.threat] };
  });
  assert.deepEqual(plans[0].before, plans[1].before, "placement doesn't change tonight's raid");
  for (const p of plans) assert.equal(p.after[0], p.before[0], "sending raiders out doesn't change who comes");
});

test("route choice sets the fighting order; practice changes nothing", () => {
  const s = new Session(player, POOL, START, 0);
  fill(s, s.held()[0].id, 4, 2);
  const hard = s.rivals[2];
  const keys = hard.territory.regions.map(r => r.key);
  const route = [hard.home().key, ...keys.filter(k => k !== hard.home().key)];
  const total = s.totalRf(), wins = s.standings().map(x => x.wins);
  const snap = { territory: hard.territory, core: { friend: hard.core, level: hard.coreLevel }, only: null, rivalIndex: 2, label: "TEST" };
  const rec = s.practice(snap, s.pieces().map(p => p.key).slice(0, 4), 1, route);
  assert.equal(rec.campaign.battles[0].regionKey, hard.home().key, "home fought first as routed");
  assert.equal(s.totalRf(), total);
  assert.deepEqual(s.standings().map(x => x.wins), wins);
  assert.equal(s.away.size, 0);
});

test("the round ends on the block count, pays 50/25/25, and the treasury seeds the next pot", () => {
  const s = new Session(player, POOL, START, ROUND_BLOCKS - 1);
  assert.equal(s.daysLeft, 7);
  s.round.pot = rf(1000);
  s.ledger.treasury = rf(40);
  s.round.wins.set(YOU, 5);
  const bal = s.ledger.balance;
  let payout = null;
  for (let i = 0; i < 7 && !payout; i++) { if (!s.coreLevel && !s.isProtected(YOU)) s.activateCore(); payout = s.endDay().payout; }
  assert.ok(payout);
  assert.equal(payout!.standings[0].id, YOU);
  assert.equal(payout!.paid[0].amount, payout!.pot / 2n);
  assert.ok(s.ledger.balance >= bal - rf(10) + payout!.pot / 2n);
  assert.equal(s.round.index, 1);
  assert.ok(s.round.pot >= rf(40), "treasury seeded the next pot");
});

test("explain: progress and highlights come from the logs", () => {
  const s = new Session(player, POOL, START, 0);
  fill(s, s.held()[0].id, 3);
  const rec = s.raid(1, s.pieces().map(p => p.key), 1);
  const why = explain(rec.campaign, "atk");
  assert.match(why.progress, /REGIONS CLEARED · \d+\/\d+ DEFENDERS KO'D/);
  assert.ok(why.highlights.length <= 3);
});

test("Library suppression: a unit on a library tile loses its powers but keeps its traits", () => {
  const lib = { scenery: "Reading" as const, seed: 1, home: true, core: { x: 10, y: 0 },
    tiles: Array.from({ length: 96 }, (_, i) => ({ kind: (i === 4 * 12 + 6 ? "library" : "ground") as "library" | "ground", hp: 0, dir: 0 })) };
  const spark = POOL.find(f => f.character === "Sparkling")!;
  const skel = POOL.find(f => f.character === "Skeleton")!;
  const core = POOL.find(f => f.character === "Cellular")!;
  const run = (x: number) => simulate({ board: lib, core: { key: "core", friend: core, level: 1, x: 10, y: 0 },
    defenders: [{ key: "s", friend: spark, level: 2, x, y: 4 }], attackers: [{ key: "a", friend: skel, level: 1 }], lane: 1, seed: 3 });
  assert.ok(!run(6).events.some(e => e.e === "power" && e.name === "Nova" && e.id === 1), "no Nova from the library tile");
  assert.ok(run(7).events.some(e => e.e === "power" && e.name === "Nova"), "Nova fires off the library");
});

test("token metadata parsing reads the six traits and ignores the image", () => {
  const json = { name: "Friend #7730", image: "data:image/svg+xml;base64,AAAA", attributes: [
    { trait_type: "Generation", value: 3 }, { trait_type: "State", value: "Active" }, { trait_type: "Character", value: "Hoverer" },
    { trait_type: "Seed", value: 7730 }, { trait_type: "Activation tier", value: 0 }, { trait_type: "Scenery", value: "Reading" },
    { trait_type: "Floor", value: "Plain" }] };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`;
  assert.deepEqual(traitsFromTokenUri(uri), { generation: 3, state: "Active", character: "Hoverer", seed: 7730,
    activationTier: 0, scenery: "Reading", floor: "Plain" });
});
