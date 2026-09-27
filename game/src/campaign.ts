/**
 * A raid on a territory is a campaign: one battle per region, expansions first and the home region last, with the
 * same party carrying its wounds from one region to the next. Clearing every defender on every region is the win.
 */
import type { Friend } from "./friends.ts";
import { mixSeed } from "./rng.ts";
import { simulate, type AttackerInput, type PieceInput, type SimResult } from "./sim.ts";
import type { Board } from "./terrain.ts";
import { battleOrder, region, regionName, type HolderId, type Piece, type Region, type Territory } from "./territory.ts";

export type Battle = Readonly<{
  regionKey: string; name: string; home: boolean; board: Board;
  /** Who garrisoned the region when it was fought. */
  holder: HolderId | null;
  defenders: readonly Piece[];
  core: PieceInput | null;
  result: SimResult;
}>;

export type Campaign = Readonly<{
  battles: readonly Battle[];
  /** Every region cleared, including ones that needed no battle. */
  won: boolean;
  cleared: readonly string[];
  /** Regions never reached because the party fell first. */
  unfought: readonly string[];
  attackersLeft: readonly Readonly<{ key: string; hpFraction: number }>[];
}>;

/** A route through a territory: the given keys first (in order), then any others in map order. */
export function routeOf(t: Territory, order?: readonly string[]): Region[] {
  const base = battleOrder(t);
  if (!order?.length) return base;
  const first = order.map(k => base.find(r => r.key === k)).filter((r): r is Region => Boolean(r));
  return [...first, ...base.filter(r => !first.includes(r))];
}

export function runCampaign(opts: {
  target: Territory;
  attacker: HolderId;
  attackers: readonly AttackerInput[];
  lane: number;
  seed: number;
  atkMul: number;
  defMul: (holder: HolderId) => number;
  /** The owner's Core for the home board; null once it has fallen and not been re-activated. */
  core: { friend: Friend; level: number } | null;
  /** Fight a single region (a reclaim raid on your own territory). */
  only?: string;
  /** Which of a region's garrison is actually on the board (the player's away raiders are not). */
  defendersOf?: (r: Region) => readonly Piece[];
  /** The attacker's route: region keys in fighting order. Missing regions follow in map order. */
  order?: readonly string[];
}): Campaign {
  const regions = opts.only ? [region(opts.target, opts.only)!] : routeOf(opts.target, opts.order);
  let party = opts.attackers.map(a => ({ ...a, hpFraction: a.hpFraction ?? 1 }));
  const battles: Battle[] = [], cleared: string[] = [], unfought: string[] = [];
  let stopped = false;
  for (const r of regions) {
    if (stopped) { unfought.push(r.key); continue; }
    // A region the raider already holds is theirs: nothing to fight.
    if (r.holder === opts.attacker) { cleared.push(r.key); continue; }
    const core: PieceInput | null = r.home && opts.core && opts.core.level > 0
      ? { key: `#${opts.core.friend.tokenId}`, friend: opts.core.friend, level: opts.core.level, x: r.board.core.x, y: r.board.core.y } : null;
    const present = opts.defendersOf ? opts.defendersOf(r) : r.garrison;
    if (!present.length && !core) { cleared.push(r.key); continue; }
    if (!party.some(a => a.hpFraction > 0)) { stopped = true; unfought.push(r.key); continue; }
    const defenders = present.map(p => ({ ...p }));
    const result = simulate({
      board: r.board, core, defenders, attackers: party, lane: opts.lane,
      seed: mixSeed(opts.seed, r.key), atkMul: opts.atkMul, defMul: opts.defMul(r.holder ?? opts.target.owner),
    });
    battles.push(Object.freeze({ regionKey: r.key, name: regionName(r), home: r.home, board: r.board, holder: r.holder, defenders: Object.freeze(defenders), core, result }));
    party = party.map(a => ({ ...a, hpFraction: result.attackersLeft.find(x => x.key === a.key)?.hpFraction ?? 0 }));
    if (result.cleared) cleared.push(r.key); else stopped = true;
  }
  return Object.freeze({
    battles: Object.freeze(battles), won: cleared.length === regions.length, cleared: Object.freeze(cleared), unfought: Object.freeze(unfought),
    attackersLeft: Object.freeze(party.map(a => Object.freeze({ key: a.key, hpFraction: a.hpFraction }))),
  });
}
