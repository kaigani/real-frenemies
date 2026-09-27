/**
 * The battle is a pure function: simulate(input) → event log. No Math.random, no clocks, no DOM.
 * Same inputs always give the same log, so replays are shareable and an on-chain verifier is possible later.
 */
import type { Facing, Friend } from "./friends.ts";
import { findPath, type Neighbor } from "./path.ts";
import { createRng } from "./rng.ts";
import { CLASSES, GRID_W, LANE_ROWS, TICK_CAP, unitStats, type AttackKind, type UnitStats } from "./rules.ts";
import { DIRS, inBounds, index, isWallKind, type Board } from "./terrain.ts";

export type Side = "def" | "atk";
export type PieceInput = Readonly<{ key: string; friend: Friend; level: number; x: number; y: number }>;
/** `hpFraction` carries wounds between the regions of one raid (1 = fresh). */
export type AttackerInput = Readonly<{ key: string; friend: Friend; level: number; hpFraction?: number }>;
export type RaidInput = Readonly<{
  board: Board;
  /** The owner's Core on a home board; null on an expanded region, where the flag tile is the raiders' goal. */
  core: PieceInput | null;
  /** Placement order; this is also the defenders' action order. */
  defenders: readonly PieceInput[];
  attackers: readonly AttackerInput[];
  lane: number;
  seed: number;
  /** Territory bonuses: raiders' damage and defenders' HP. */
  atkMul?: number;
  defMul?: number;
}>;
export type EndReason = "cleared" | "wiped" | "time";

export type UnitInit = Readonly<{
  id: number; key: string; side: Side; friend: Friend; level: number; core: boolean; mini: number;
  x: number; y: number; hp: number; maxHp: number;
}>;

export type SimEvent =
  | { t: number; e: "move"; id: number; x: number; y: number; how?: "push" | "teleport" | "swap" }
  | { t: number; e: "hit"; id: number; target: number; dmg: number; hp: number; miss?: boolean; kind: AttackKind | "power"; power?: string }
  | { t: number; e: "wall"; id: number; x: number; y: number; dmg: number; hp: number }
  | { t: number; e: "power"; id: number; name: string; r?: number }
  | { t: number; e: "heal"; id: number; amount: number; hp: number }
  | { t: number; e: "shield"; id: number; amount: number }
  | { t: number; e: "ko"; id: number; by: number }
  | { t: number; e: "revive"; id: number; hp: number }
  | { t: number; e: "spore"; x: number; y: number; until: number }
  | { t: number; e: "end"; winner: Side; reason: EndReason };

export type SimResult = Readonly<{
  units: readonly UnitInit[];
  events: readonly SimEvent[];
  winner: Side;
  reason: EndReason;
  ticks: number;
  /** The raid wins by knocking out every defender; the Core going down is tracked separately for settlement. */
  cleared: boolean;
  coreDown: boolean;
  /** Each attacker's remaining HP share (0 = knocked out), for the next region of the same raid. */
  attackersLeft: readonly Readonly<{ key: string; hpFraction: number }>[];
  /** Defender piece keys (not the Core) whose every body was knocked out. */
  defeated: readonly string[];
  survivors: readonly string[];
}>;

type Unit = {
  id: number; key: string; side: Side; friend: Friend; level: number; core: boolean; mini: number;
  x: number; y: number; hp: number; maxHp: number; dmg: number; range: number; moveCd: number; atkCd: number;
  kind: AttackKind; stats: UnitStats; alive: boolean;
  nextMove: number; nextAtk: number; powerReady: number; tideReady: number; decoyReady: number; shakeReady: number;
  shield: number; stunnedUntil: number; blindUntil: number;
  revived: boolean; merged: boolean; disguised: boolean; phased: boolean; dived: boolean; ambushUsed: boolean;
  post: readonly [number, number]; engaged: Set<string>; rushed: Set<string>; straight: number; lastDir: number; facing: Facing; lastTarget: number; blockedFor: number;
};

const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const ORTHO = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const LEASH = 2;
const ALL8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export function simulate(input: RaidInput): SimResult {
  const { board } = input;
  const rng = createRng(input.seed);
  const events: SimEvent[] = [];
  const kinds = board.tiles.map(t => t.kind);
  const wallHp = board.tiles.map(t => t.hp);
  const spores = new Map<number, number>();
  const units: Unit[] = [];
  let t = 0, ended: { winner: Side; reason: EndReason } | null = null;

  // ---------- setup ----------
  const make = (piece: AttackerInput, side: Side, x: number, y: number, core: boolean, mini = -1): Unit => {
    const stats = unitStats(piece.friend, piece.level, board.scenery, { core, attacking: side === "atk",
      atkMul: side === "atk" ? input.atkMul : undefined, defMul: side === "def" ? input.defMul : undefined });
    const def = CLASSES[piece.friend.character];
    let maxHp = stats.maxHp, dmg = stats.dmg;
    if (mini >= 0) { maxHp = Math.max(1, Math.round(maxHp / 3)); dmg = Math.max(1, Math.ceil(dmg / 2)); }
    const fraction = side === "atk" ? Math.max(0, Math.min(1, piece.hpFraction ?? 1)) : 1;
    const u: Unit = {
      id: units.length, key: piece.key, side, friend: piece.friend, level: piece.level, core, mini,
      x, y, hp: Math.max(1, Math.round(maxHp * fraction)), maxHp, dmg, range: stats.range, moveCd: stats.moveCd, atkCd: stats.atkCd, kind: def.kind, stats, alive: true,
      nextMove: 0, nextAtk: 0, powerReady: 0, tideReady: 0, decoyReady: 0, shakeReady: 0, shield: 0, stunnedUntil: -1, blindUntil: -1,
      revived: false, merged: false, disguised: side === "atk" && piece.friend.character === "Mask", phased: false, dived: false, ambushUsed: false,
      post: [x, y], engaged: new Set(), rushed: new Set(), straight: 0, lastDir: -1, facing: side === "atk" ? "right" : "left", lastTarget: -1, blockedFor: 0,
    };
    units.push(u);
    return u;
  };
  const occupant = (x: number, y: number) => units.find(u => u.alive && u.x === x && u.y === y);
  const walkable = (x: number, y: number) => inBounds(x, y) && !isWallKind(kinds[index(x, y)]);
  const nearestFree = (x: number, y: number, minX: number) => {
    const seen = new Set<number>(), queue: [number, number][] = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.shift()!;
      const k = index(cx, cy);
      if (seen.has(k)) continue;
      seen.add(k);
      if (cx >= minX && walkable(cx, cy) && !occupant(cx, cy)) return [cx, cy] as const;
      for (const [dx, dy] of ORTHO) if (inBounds(cx + dx, cy + dy)) queue.push([cx + dx, cy + dy]);
    }
    return null;
  };
  const place = (piece: AttackerInput, side: Side, x: number, y: number, core = false) => {
    if (piece.friend.character === "Family" && !core) {
      for (let m = 0; m < 3; m++) {
        const spot = m === 0 && !occupant(x, y) ? [x, y] as const : nearestFree(x, y, side === "def" ? 3 : 0);
        if (spot) make(piece, side, spot[0], spot[1], false, m);
      }
    } else {
      const spot = !occupant(x, y) ? [x, y] as const : nearestFree(x, y, side === "def" ? 3 : 0);
      if (spot) make(piece, side, spot[0], spot[1], core);
    }
  };
  if (input.core) place(input.core, "def", board.core.x, board.core.y, true);
  for (const d of input.defenders) place(d, "def", d.x, d.y);
  const laneY = LANE_ROWS[Math.max(0, Math.min(2, input.lane))];
  for (const a of input.attackers) if ((a.hpFraction ?? 1) > 0) place(a, "atk", 0, laneY);
  for (const u of units) { u.powerReady = cd(u, basePowerCd(u)); u.tideReady = cd(u, 4); }
  const init: UnitInit[] = units.map(u => Object.freeze({ id: u.id, key: u.key, side: u.side, friend: u.friend, level: u.level,
    core: u.core, mini: u.mini, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp }));
  const coreUnit = input.core ? units[0] : null;
  const coreAlive = () => Boolean(coreUnit?.alive);

  // ---------- helpers ----------
  function kindAt(x: number, y: number) { return kinds[index(x, y)]; }
  function flying(u: Unit) { return u.friend.character === "Hoverer" || kindAt(u.x, u.y) === "zerog"; }
  function suppressed(u: Unit) { return kindAt(u.x, u.y) === "library"; }
  function hasAffinity(u: Unit) { return u.stats.affinity && !suppressed(u); }
  /** A named power (D / R / 4) is usable: not suppressed by a Library tile. */
  function can(u: Unit) { return !suppressed(u); }
  /** Range after suppression: Overwatch (+1 on defending Hoverers) and range affinities switch off on Library. */
  function rangeOf(u: Unit) {
    if (!suppressed(u)) return u.range;
    let r = u.range;
    if (u.friend.character === "Hoverer" && u.side === "def") r -= 1;
    if (u.stats.affinity && (u.friend.scenery === "Orbital" || u.friend.scenery === "Rooftop")) r -= 1;
    return Math.max(1, r);
  }
  function enemies(u: Unit) { return units.filter(o => o.alive && o.side !== u.side); }
  function allies(u: Unit) { return units.filter(o => o.alive && o.side === u.side && o !== u); }
  function hidden(u: Unit) {
    return kindAt(u.x, u.y) === "overgrowth" && !enemies(u).some(e => cheb(e.x, e.y, u.x, u.y) <= 1);
  }
  function basePowerCd(u: Unit) {
    switch (u.friend.character) {
      case "Sparkling": return u.side === "def" ? 3 : 4;
      case "Cellular": case "Hollow": return 2;
      default: return 4;
    }
  }
  function cd(u: Unit, base: number) {
    const study = hasAffinity(u) && u.friend.scenery === "Reading" &&
      allies(u).some(a => a.friend.scenery === "Reading" && cheb(a.x, a.y, u.x, u.y) <= 1);
    return Math.max(1, base - u.stats.cdReduction - (study ? 1 : 0));
  }
  function lineClear(ax: number, ay: number, bx: number, by: number) {
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    while (!(x === bx && y === by)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === bx && y === by) break;
      const k = index(x, y);
      if (isWallKind(kinds[k]) || spores.has(k)) return false;
    }
    return true;
  }
  function canTarget(a: Unit, b: Unit) {
    if (!b.alive || b.side === a.side) return false;
    const d = cheb(a.x, a.y, b.x, b.y);
    if (d > rangeOf(a)) return false;
    if (a.kind === "melee" && flying(b)) return false;
    if (b.disguised && can(b) && a.side === "def") return false;
    const overwatch = a.friend.character === "Hoverer" && a.side === "def" && can(a);
    if (d > 1 && hidden(b) && !overwatch) return false;
    const pierce = (a.friend.character === "Asymmetry" && a.stats.upgrade && can(a)) || (hasAffinity(a) && a.friend.scenery === "Rooftop");
    if (a.kind === "ranged" && d > 1 && !pierce && !lineClear(a.x, a.y, b.x, b.y)) return false;
    return true;
  }
  function chooseTarget(u: Unit): Unit | null {
    const options = enemies(u).filter(e => canTarget(u, e));
    if (!options.length) return null;
    if (u.side === "atk") {
      const taunt = options.find(e => e.friend.character === "Colossus" && can(e) && cheb(e.x, e.y, u.x, u.y) <= 1);
      if (taunt) return taunt;
      const core = options.find(e => e.core);
      if (core) return core;
      if (u.friend.character === "Hoverer" && can(u) && coreAlive()) return null; // Skyline: only the Core matters while it stands.
      if (u.disguised && can(u) && coreAlive()) return null; // Disguise: keeps walking until it reaches the Core or is blocked.
      if (u.friend.character === "Family" && can(u)) {
        const mob = units.find(s => s.alive && s.key === u.key && s !== u && s.lastTarget >= 0 && options.some(o => o.id === s.lastTarget));
        if (mob) return units[mob.lastTarget];
      }
      return options.sort((a, b) => a.hp - b.hp || cheb(a.x, a.y, u.x, u.y) - cheb(b.x, b.y, u.x, u.y) || a.id - b.id)[0];
    }
    const toCore = (e: Unit) => cheb(e.x, e.y, board.core.x, board.core.y);
    return options.sort((a, b) => toCore(a) - toCore(b) || a.hp - b.hp || a.id - b.id)[0];
  }
  function face(u: Unit, dx: number, dy: number) {
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) u.facing = dx > 0 ? "right" : "left";
    else if (dy !== 0) u.facing = dy > 0 ? "down" : "up";
  }
  function end(winner: Side, reason: EndReason) {
    if (ended) return;
    ended = { winner, reason };
    events.push({ t, e: "end", winner, reason });
  }

  // ---------- damage ----------
  function knockOut(u: Unit, by: Unit | null) {
    if (u.friend.character === "Skeleton" && u.stats.upgrade && can(u) && !u.revived) {
      u.revived = true; u.hp = Math.min(3, u.maxHp);
      events.push({ t, e: "revive", id: u.id, hp: u.hp });
      return;
    }
    u.alive = false; u.hp = 0;
    events.push({ t, e: "ko", id: u.id, by: by ? by.id : -1 });
    if (u.mini >= 0 && u.stats.upgrade) {
      const left = units.filter(s => s.alive && s.key === u.key && s.side === u.side);
      if (left.length === 1 && !left[0].merged && can(left[0])) {
        const s = left[0];
        s.merged = true; s.maxHp = Math.max(s.maxHp, s.maxHp * 3); s.hp = s.maxHp; s.dmg = Math.max(s.dmg, s.dmg * 2);
        events.push({ t, e: "heal", id: s.id, amount: s.maxHp, hp: s.hp });
        events.push({ t, e: "power", id: s.id, name: "Reunion" });
      }
    }
    if (by && by.alive && by.friend.character === "Hollow" && by.stats.upgrade && can(by)) heal(by, 2);
    if (!units.some(o => o.alive && o.side === "def")) end("atk", "cleared");
    else if (!units.some(o => o.alive && o.side === "atk")) end("def", "wiped");
  }
  function heal(u: Unit, amount: number) {
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    if (u.hp > before) events.push({ t, e: "heal", id: u.id, amount: u.hp - before, hp: u.hp });
  }
  /** Apply damage after shields. Returns true if it landed. */
  function hurt(target: Unit, dmg: number, source: Unit | null, kind: AttackKind | "power", power?: string) {
    if (!target.alive) return false;
    let left = dmg;
    if (target.shield > 0) { const used = Math.min(target.shield, left); target.shield -= used; left -= used; }
    target.hp -= left;
    events.push({ t, e: "hit", id: source ? source.id : -1, target: target.id, dmg, hp: Math.max(0, target.hp), kind, ...(power ? { power } : {}) });
    if (target.hp <= 0) knockOut(target, source);
    return true;
  }
  function strike(a: Unit, b: Unit, bounce = false) {
    face(a, b.x - a.x, b.y - a.y);
    a.lastTarget = b.id;
    if (a.disguised) { a.disguised = false; events.push({ t, e: "power", id: a.id, name: "Disguise off" }); }
    // Decoy: a defending Mask swaps with an ally and the hit is wasted. Ricochet shots see through it.
    if (!bounce && b.friend.character === "Mask" && b.side === "def" && !b.core && !suppressed(b) && b.decoyReady <= t && a.friend.character !== "Asymmetry") {
      const swap = allies(b).filter(o => !o.core && o.key !== b.key);
      if (swap.length) {
        const o = swap[rng.int(swap.length)];
        const [bx, by] = [b.x, b.y];
        b.x = o.x; b.y = o.y; o.x = bx; o.y = by;
        b.decoyReady = t + cd(b, 4);
        events.push({ t, e: "power", id: b.id, name: "Decoy" });
        events.push({ t, e: "move", id: b.id, x: b.x, y: b.y, how: "swap" });
        events.push({ t, e: "move", id: o.id, x: o.x, y: o.y, how: "swap" });
        events.push({ t, e: "hit", id: a.id, target: b.id, dmg: 0, hp: b.hp, miss: true, kind: a.kind });
        return;
      }
    }
    const missChance = (a.blindUntil >= t ? 50 : 0) + (b.stats.floorQuirk && b.friend.floor === "Dither" ? 25 : 0);
    if (missChance && rng.chance(missChance)) {
      events.push({ t, e: "hit", id: a.id, target: b.id, dmg: 0, hp: b.hp, miss: true, kind: a.kind });
      return;
    }
    let dmg = bounce ? Math.max(1, Math.ceil(a.dmg / 2)) : a.dmg;
    if (!bounce && can(a)) {
      if (a.side === "atk" && !a.engaged.has(b.key)) {
        if (a.friend.character === "Skeleton") dmg += 2;
        if (a.friend.character === "Asymmetry") dmg += 1;
        a.engaged.add(b.key);
      }
      if (a.friend.character === "Colossus" && a.side === "atk" && b.core) dmg *= 2;
      if (a.friend.character === "Hoverer" && a.stats.upgrade && !a.dived && !flying(b)) { dmg *= 2; a.dived = true; }
      if (hasAffinity(a) && a.friend.scenery === "Garden" && !a.ambushUsed && hidden(a)) { dmg *= 2; a.ambushUsed = true; }
    }
    // Class trait (never suppressed): ranged attacks hit flyers for double.
    if (!bounce && a.kind === "ranged" && flying(b)) dmg *= 2;
    if (b.friend.character === "Hollow" && a.kind === "melee") dmg = Math.max(1, Math.ceil(dmg / 2));
    if (hasAffinity(b) && b.friend.scenery === "Industrial") dmg = Math.max(1, dmg - 1);
    // Brood (Family defense power): a mini next to a sibling mini takes 1 less damage.
    if (b.mini >= 0 && b.side === "def" && can(b) && units.some(o => o.alive && o !== b && o.key === b.key && cheb(o.x, o.y, b.x, b.y) <= 1)) dmg = Math.max(1, dmg - 1);
    hurt(b, dmg, a, a.kind);
    if (b.alive && b.friend.character === "Mask" && b.stats.upgrade && can(b) && a.alive) hurt(a, 1, b, "power", "Mirror");
    if (b.alive && b.friend.character === "Colossus" && b.stats.upgrade && b.shakeReady <= t && !suppressed(b)) {
      b.shakeReady = t + 3;
      events.push({ t, e: "power", id: b.id, name: "Earthshake", r: 1 });
      for (const e of enemies(b)) if (cheb(e.x, e.y, b.x, b.y) <= 1) e.stunnedUntil = t + 1;
    }
    if (!bounce && a.friend.character === "Asymmetry" && a.side === "def" && a.alive && can(a)) {
      const next = enemies(a).filter(e => e !== b && cheb(e.x, e.y, b.x, b.y) <= 2 && !(e.disguised))
        .sort((p, q) => cheb(p.x, p.y, b.x, b.y) - cheb(q.x, q.y, b.x, b.y) || p.id - q.id)[0];
      if (next) { events.push({ t, e: "power", id: a.id, name: "Ricochet" }); strike(a, next, true); }
    }
  }
  function hitWall(a: Unit, x: number, y: number) {
    const k = index(x, y);
    let dmg = a.dmg;
    if (a.friend.character === "Colossus" && a.side === "atk" && can(a)) dmg *= 2;
    wallHp[k] = Math.max(0, wallHp[k] - dmg);
    face(a, x - a.x, y - a.y);
    events.push({ t, e: "wall", id: a.id, x, y, dmg, hp: wallHp[k] });
    if (wallHp[k] === 0) {
      kinds[k] = "ground";
      for (const u of units) {
        if (u.alive && hasAffinity(u) && u.friend.scenery === "Mineral" && cheb(u.x, u.y, x, y) <= 2) {
          u.shield += 2;
          events.push({ t, e: "shield", id: u.id, amount: 2 });
        }
      }
    }
  }

  // ---------- movement ----------
  function neighborsFor(u: Unit) {
    const fly = u.friend.character === "Hoverer";
    const eight = u.friend.floor === "Hatch" || u.friend.floor === "Dither";
    const coastal = hasAffinity(u) && u.friend.scenery === "Coastal";
    return (x: number, y: number): Neighbor[] => {
      const out: Neighbor[] = [];
      for (const [dx, dy] of eight ? ALL8 : ORTHO) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const kind = kindAt(nx, ny);
        let cost = dx && dy ? 1.4 : 1;
        if (!fly) {
          if (dx && dy && u.friend.floor === "Dither" && (isWallKind(kindAt(x + dx, y)) || isWallKind(kindAt(x, y + dy)))) continue;
          if (kind === "ledge" && dx !== 1) continue;
          if (isWallKind(kind)) cost += 1 + wallHp[index(nx, ny)] * 1.5;
          if (kind === "water" && !coastal) cost += 1;
        }
        const o = occupant(nx, ny);
        if (o && !(nx === board.core.x && ny === board.core.y)) cost += o.side === u.side ? 2 : 6;
        out.push({ x: nx, y: ny, cost });
      }
      return out;
    };
  }
  function stepAttacker(u: Unit) {
    if (u.nextMove > t) return;
    const eight = u.friend.floor === "Hatch" || u.friend.floor === "Dither";
    // Head for the Core while it stands; afterwards hunt the nearest defender this unit can hit.
    let goal: (x: number, y: number) => boolean, h: (x: number, y: number) => number;
    if (coreAlive()) {
      goal = (x, y) => cheb(x, y, board.core.x, board.core.y) <= 1 && !(x === board.core.x && y === board.core.y);
      h = (x, y) => { const dx = Math.abs(x - board.core.x), dy = Math.abs(y - board.core.y); return Math.max(0, (eight ? Math.max(dx, dy) : dx + dy) - 1); };
    } else {
      const prey = enemies(u).filter(e => u.kind !== "melee" || !flying(e))
        .sort((a, b) => cheb(a.x, a.y, u.x, u.y) - cheb(b.x, b.y, u.x, u.y) || a.id - b.id)[0] ?? enemies(u)[0];
      if (!prey) { u.nextMove = t + 1; return; }
      goal = (x, y) => cheb(x, y, prey.x, prey.y) <= u.range && !(x === prey.x && y === prey.y);
      h = (x, y) => Math.max(0, cheb(x, y, prey.x, prey.y) - u.range);
    }
    const path = findPath({ x: u.x, y: u.y }, goal, neighborsFor(u), h);
    if (!path || !path.length) { u.nextMove = t + 1; return; }
    const next = path[0];
    const dx = next.x - u.x, dy = next.y - u.y;
    const fly = u.friend.character === "Hoverer";
    if (!fly && isWallKind(kindAt(next.x, next.y))) {
      if (u.nextAtk <= t) { hitWall(u, next.x, next.y); u.nextAtk = t + u.atkCd; }
      return;
    }
    const o = occupant(next.x, next.y);
    if (o) {
      if (o.side !== u.side && u.friend.character === "Hollow" && !u.phased && !suppressed(u)) {
        // Phase-step: appear on the far side of the first defender met.
        const far = [next.x + dx, next.y + dy] as const;
        const beyond = inBounds(far[0], far[1]) && walkable(far[0], far[1]) && !occupant(far[0], far[1]) ? far : path[1] && !occupant(path[1].x, path[1].y) ? [path[1].x, path[1].y] as const : null;
        if (beyond) {
          u.phased = true; u.x = beyond[0]; u.y = beyond[1]; face(u, dx, dy);
          events.push({ t, e: "power", id: u.id, name: "Phase-step" });
          events.push({ t, e: "move", id: u.id, x: u.x, y: u.y, how: "teleport" });
          u.nextMove = t + u.moveCd;
          return;
        }
      }
      if (o.side !== u.side && u.disguised && ++u.blockedFor >= 2 && canTargetIgnoringDisguise(u, o)) {
        if (u.nextAtk <= t) { strike(u, o); u.nextAtk = t + u.atkCd; }
        return;
      }
      u.nextMove = t + 1;
      return;
    }
    const from = index(u.x, u.y);
    u.x = next.x; u.y = next.y; face(u, dx, dy);
    events.push({ t, e: "move", id: u.id, x: u.x, y: u.y });
    const dirIndex = ALL8.findIndex(([ax, ay]) => ax === dx && ay === dy);
    u.straight = dirIndex === u.lastDir ? u.straight + 1 : 1;
    u.lastDir = dirIndex;
    let wait = u.moveCd;
    if (!fly && kindAt(u.x, u.y) === "water" && !(hasAffinity(u) && u.friend.scenery === "Coastal")) wait += u.moveCd;
    if (u.stats.floorQuirk && u.friend.floor === "Cross Grid" && u.straight >= 2) wait = Math.max(1, wait - 1);
    u.nextMove = t + wait;
    if (u.friend.character === "Cellular" && !suppressed(u) && !isWallKind(kinds[from])) {
      spores.set(from, t + 12);
      events.push({ t, e: "spore", x: from % GRID_W, y: Math.floor(from / GRID_W), until: t + 12 });
    }
    boneRush(u);
  }
  /** Melee and flying defenders leave their post by up to LEASH tiles to intercept, then walk back. */
  function stepDefender(u: Unit) {
    if (u.nextMove > t) return;
    const [px, py] = u.post;
    const reachable = (e: Unit) => (u.kind !== "melee" || !flying(e)) && !e.disguised && !(hidden(e) && cheb(e.x, e.y, u.x, u.y) > 1)
      && cheb(e.x, e.y, px, py) <= LEASH + rangeOf(u) + 1;
    const prey = enemies(u).filter(reachable)
      .sort((a, b) => cheb(a.x, a.y, u.x, u.y) - cheb(b.x, b.y, u.x, u.y) || a.id - b.id)[0];
    const base = neighborsFor(u);
    const leashed = (x: number, y: number) => base(x, y).filter(n => cheb(n.x, n.y, px, py) <= LEASH && !occupant(n.x, n.y) && !isWallKind(kindAt(n.x, n.y)));
    let path: { x: number; y: number }[] | null = null;
    if (prey) {
      const r = rangeOf(u);
      path = findPath({ x: u.x, y: u.y }, (x, y) => cheb(x, y, prey.x, prey.y) <= r, leashed, (x, y) => Math.max(0, cheb(x, y, prey.x, prey.y) - r));
    } else if (u.x !== px || u.y !== py) {
      path = findPath({ x: u.x, y: u.y }, (x, y) => x === px && y === py, leashed, (x, y) => cheb(x, y, px, py));
    }
    if (!path || !path.length) { u.nextMove = t + 1; return; }
    const next = path[0];
    face(u, next.x - u.x, next.y - u.y);
    u.x = next.x; u.y = next.y;
    events.push({ t, e: "move", id: u.id, x: u.x, y: u.y });
    let wait = u.moveCd;
    if (u.friend.character !== "Hoverer" && kindAt(u.x, u.y) === "water" && !(hasAffinity(u) && u.friend.scenery === "Coastal")) wait += u.moveCd;
    u.nextMove = t + wait;
  }
  function canTargetIgnoringDisguise(a: Unit, b: Unit) {
    const was = a.disguised; a.disguised = false;
    const ok = canTarget(a, b); a.disguised = was;
    return ok;
  }
  /** Bone Rush: defending Skeletons get a free strike on anything that steps adjacent. */
  function boneRush(mover: Unit) {
    for (const d of units) {
      if (!mover.alive || !d.alive || d.side === mover.side || d.side !== "def" || d.friend.character !== "Skeleton" || suppressed(d)) continue;
      if (cheb(d.x, d.y, mover.x, mover.y) <= 1 && !d.rushed.has(mover.key) && canTarget(d, mover)) {
        d.rushed.add(mover.key);
        events.push({ t, e: "power", id: d.id, name: "Bone Rush" });
        strike(d, mover);
      }
    }
  }
  function push(u: Unit, dx: number, dy: number, how: "push") {
    const nx = u.x + dx, ny = u.y + dy;
    if (!walkable(nx, ny) || occupant(nx, ny) || (u.core)) return false;
    if (kindAt(nx, ny) === "ledge" && dx !== 1 && u.friend.character !== "Hoverer") return false;
    u.x = nx; u.y = ny;
    events.push({ t, e: "move", id: u.id, x: nx, y: ny, how });
    return true;
  }

  // ---------- start-of-tick effects ----------
  function tickEffects() {
    for (const [k, until] of spores) if (until <= t) spores.delete(k);
    for (const u of units) {
      if (!u.alive || ended) continue;
      if (t > 0 && t % 10 === 0 && u.friend.state === "Active") heal(u, 1);
      if (suppressed(u)) continue;
      const c = u.friend.character;
      if (u.powerReady > t) { /* class power cooling down; Tide below has its own timer */ }
      else if (c === "Hollow" && u.side === "def") {
        const near = enemies(u).filter(e => cheb(e.x, e.y, u.x, u.y) <= 1);
        if (near.length) {
          events.push({ t, e: "power", id: u.id, name: "Void", r: 1 });
          for (const e of near) hurt(e, 1, u, "power", "Void");
          u.powerReady = t + cd(u, 2);
        }
      } else if (c === "Cellular" && u.side === "def") {
        const r = u.stats.upgrade ? 2 : 1;
        const hurtAllies = allies(u).filter(a => cheb(a.x, a.y, u.x, u.y) <= r && a.hp < a.maxHp);
        if (hurtAllies.length) {
          events.push({ t, e: "power", id: u.id, name: u.stats.upgrade ? "Culture" : "Mitosis", r });
          for (const a of hurtAllies) heal(a, 1);
          u.powerReady = t + cd(u, 2);
        }
      } else if (c === "Sparkling" && u.side === "def") {
        const r = u.stats.upgrade ? 3 : 2;
        const near = enemies(u).filter(e => cheb(e.x, e.y, u.x, u.y) <= r);
        if (near.length) {
          events.push({ t, e: "power", id: u.id, name: u.stats.upgrade ? "Supernova" : "Nova", r });
          for (const e of near) hurt(e, 2, u, "power", "Nova");
          if (u.stats.upgrade) hurt(u, 1, u, "power", "Supernova");
          u.powerReady = t + cd(u, 3);
        }
      } else if (c === "Sparkling" && u.side === "atk") {
        const near = enemies(u).filter(e => cheb(e.x, e.y, u.x, u.y) <= 2);
        if (near.length) {
          events.push({ t, e: "power", id: u.id, name: "Flare", r: 2 });
          for (const e of near) { e.blindUntil = t + 2; hurt(e, 1, u, "power", "Flare"); }
          u.powerReady = t + cd(u, 4);
        }
      }
      if (u.alive && hasAffinity(u) && u.friend.scenery === "Coastal" && u.tideReady <= t) {
        const target = enemies(u).find(e => cheb(e.x, e.y, u.x, u.y) === 1 && !e.core);
        if (target && push(target, Math.sign(target.x - u.x), Math.sign(target.y - u.y), "push")) {
          events.push({ t, e: "power", id: u.id, name: "Tide" });
          u.tideReady = t + cd(u, 4);
        }
      }
    }
    if (t % 2 === 0) {
      for (const u of units) {
        if (!u.alive || ended || flying(u) || u.core) continue;
        const k = index(u.x, u.y);
        if (kinds[k] === "conveyor") {
          const [dx, dy] = DIRS[board.tiles[k].dir];
          push(u, dx, dy, "push");
        }
      }
    }
  }

  // ---------- main loop ----------
  const defenders = units.filter(u => u.side === "def");
  const order = [...defenders.filter(u => !u.core), ...(coreUnit ? [coreUnit] : []), ...units.filter(u => u.side === "atk")];
  if (!defenders.length) end("atk", "cleared");
  else if (!units.some(u => u.side === "atk")) end("def", "wiped");
  while (!ended && t < TICK_CAP) {
    tickEffects();
    for (const u of order) {
      if (ended) break;
      if (!u.alive || u.stunnedUntil >= t) continue;
      const target = chooseTarget(u);
      if (target) {
        u.blockedFor = 0;
        if (u.nextAtk <= t) { strike(u, target); u.nextAtk = t + u.atkCd; }
      } else if (u.side === "atk") {
        stepAttacker(u);
      } else if (!u.core && u.kind !== "ranged") {
        stepDefender(u);
      }
    }
    if (!ended) t++;
  }
  if (!ended) end("def", "time");
  const result = ended as unknown as { winner: Side; reason: EndReason };
  const defenderKeys = [...new Set(defenders.filter(u => !u.core).map(u => u.key))];
  const defeated = defenderKeys.filter(k => !units.some(u => u.key === k && u.side === "def" && u.alive));
  const attackersLeft = input.attackers.map(a => {
    const bodies = units.filter(u => u.side === "atk" && u.key === a.key);
    const total = bodies.reduce((n, u) => n + u.maxHp, 0), left = bodies.reduce((n, u) => n + (u.alive ? u.hp : 0), 0);
    return Object.freeze({ key: a.key, hpFraction: total ? Math.max(0, Math.min(1, left / total)) : 0 });
  });
  return Object.freeze({
    units: Object.freeze(init), events: Object.freeze(events), winner: result.winner, reason: result.reason, ticks: t,
    cleared: result.reason === "cleared", coreDown: Boolean(coreUnit && !coreUnit.alive), attackersLeft: Object.freeze(attackersLeft),
    defeated: Object.freeze(defeated),
    survivors: Object.freeze(defenderKeys.filter(k => !defeated.includes(k))),
  });
}

