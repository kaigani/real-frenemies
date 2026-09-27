/**
 * Playback reads only the sim's event log; it never touches sim state. Any tick can be rebuilt from the log,
 * which is what gives free rewind, 2× and skip. Positions are tile coordinates; the renderer turns them into pixels.
 */
import type { Facing } from "./friends.ts";
import type { SimEvent, SimResult, UnitInit } from "./sim.ts";
import type { Board } from "./terrain.ts";

export type UnitView = {
  unit: UnitInit; x: number; y: number; hp: number; maxHp: number; alive: boolean; facing: Facing;
  walking: boolean; koAt: number; hitAt: number; shield: number;
};
export type ReplayState = Readonly<{
  tick: number; units: readonly UnitView[]; walls: ReadonlyMap<number, number>; spores: ReadonlySet<number>;
  recent: readonly SimEvent[]; ended: boolean;
}>;

const faceOf = (dx: number, dy: number, fallback: Facing): Facing =>
  Math.abs(dx) >= Math.abs(dy) && dx !== 0 ? (dx > 0 ? "right" : "left") : dy !== 0 ? (dy > 0 ? "down" : "up") : fallback;

export class Replay {
  readonly result: SimResult;
  readonly board: Board;
  readonly length: number;

  constructor(result: SimResult, board: Board) {
    this.result = result;
    this.board = board;
    this.length = Math.max(1, result.ticks + 1);
  }

  /** State at a fractional tick τ. Moves at tick t animate over [t, t + 1). */
  at(tau: number, smooth: boolean): ReplayState {
    const tick = Math.floor(tau), frac = smooth ? tau - tick : 0;
    const views: UnitView[] = this.result.units.map(unit => ({
      unit, x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp, alive: true,
      facing: unit.side === "atk" ? "right" : "left", walking: false, koAt: -1, hitAt: -99, shield: 0,
    }));
    const walls = new Map<number, number>();
    const spores = new Set<number>();
    const sporeUntil = new Map<number, number>();
    const recent: SimEvent[] = [];
    let ended = false;
    for (const e of this.result.events) {
      if (e.t > tick) break;
      if (e.t >= tick - 12) recent.push(e);
      switch (e.e) {
        case "move": {
          const v = views[e.id];
          const fromX = v.x, fromY = v.y;
          v.facing = faceOf(e.x - fromX, e.y - fromY, v.facing);
          if (e.t === tick && !e.how && frac > 0) {
            v.x = fromX + (e.x - fromX) * frac; v.y = fromY + (e.y - fromY) * frac; v.walking = true;
          } else {
            v.x = e.x; v.y = e.y; v.walking = e.t === tick && !e.how;
          }
          break;
        }
        case "hit": {
          const target = views[e.target];
          if (!e.miss) { target.hp = e.hp; target.hitAt = e.t; }
          if (e.id >= 0 && e.id !== e.target) {
            const src = views[e.id];
            src.facing = faceOf(target.x - src.x, target.y - src.y, src.facing);
          }
          target.shield = Math.max(0, target.shield - e.dmg);
          break;
        }
        case "heal": { const v = views[e.id]; v.hp = e.hp; if (e.hp > v.maxHp) v.maxHp = e.hp; break; }
        case "revive": { const v = views[e.id]; v.alive = true; v.hp = e.hp; v.koAt = -1; break; }
        case "ko": { const v = views[e.id]; v.alive = false; v.hp = 0; v.koAt = e.t; break; }
        case "shield": views[e.id].shield += e.amount; break;
        case "wall": walls.set(e.y * 12 + e.x, e.hp); break;
        case "spore": { const k = e.y * 12 + e.x; sporeUntil.set(k, e.until); break; }
        case "end": ended = true; break;
      }
    }
    for (const [k, until] of sporeUntil) if (until > tick) spores.add(k);
    return { tick, units: views, walls, spores, recent, ended };
  }
}

/** Plain-language line for the playback feed, or null for events not worth a line. */
export function describe(e: SimEvent, name: (id: number) => string): string | null {
  switch (e.e) {
    case "hit":
      if (e.miss) return `${name(e.id)} MISSED`;
      if (e.power) return `${e.power.toUpperCase()} HIT ${name(e.target)} -${e.dmg}`;
      return `${name(e.id)} HIT ${name(e.target)} -${e.dmg}`;
    case "power": return e.name === "Disguise off" ? `${name(e.id)} DROPS DISGUISE` : `${name(e.id)}: ${e.name.toUpperCase()}`;
    case "ko": return `${name(e.id)} KNOCKED OUT`;
    case "revive": return `${name(e.id)} REASSEMBLES`;
    case "wall": return e.hp === 0 ? `${name(e.id)} BROKE A WALL` : null;
    case "end": return e.winner === "atk" ? "REGION CLEARED - RAIDERS WIN" : e.reason === "wiped" ? "RAIDERS WIPED OUT" : "TIME - DEFENDERS HOLD";
    default: return null;
  }
}
