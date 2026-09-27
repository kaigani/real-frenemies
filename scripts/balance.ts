/** Duel matrix: each Character raids each Character one-on-one on flat ground. Run: node scripts/balance.ts [level] [gen] */
import { CHARACTERS, POOL, type Friend } from "../game/src/friends.ts";
import { simulate } from "../game/src/sim.ts";
import type { Board, Tile } from "../game/src/terrain.ts";

const level = Number(process.argv[2] ?? 1), gen = Number(process.argv[3] ?? 5);
const flat: Board = { scenery: "Garden", seed: 1, home: true, core: { x: 10, y: 0 },
  tiles: Array.from({ length: 96 }, (): Tile => ({ kind: "ground", hp: 0, dir: 0 })) };
const make = (c: string): Friend => ({ ...POOL.find(f => f.character === c)!, generation: gen, floor: "Plain", scenery: "Coastal", activationTier: 0, state: "Inactive" });
const coreFriend = { ...make("Cellular"), generation: 6 };
const tag: Record<string, string> = {};
let out = "ATK \ DEF  " + CHARACTERS.map(c => c.slice(0, 5).padEnd(6)).join("") + "\n";
for (const a of CHARACTERS) {
  out += a.padEnd(11);
  for (const d of CHARACTERS) {
    const r = simulate({ board: flat, core: { key: "core", friend: coreFriend, level: 1, x: 10, y: 0 },
      defenders: [{ key: "d", friend: make(d), level, x: 6, y: 4 }], attackers: [{ key: "a", friend: make(a), level }], lane: 1, seed: 7 });
    const downAt = (side: string) => { const ids = r.units.filter(u => u.side === side && !u.core).map(u => u.id);
      let last = -1; for (const id of ids) { const ko = r.events.find(e => e.e === 'ko' && e.id === id); if (!ko) return Infinity; last = Math.max(last, ko.t); } return last; };
    const ta = downAt('atk'), td = downAt('def');
    const cell = td < ta ? 'A' : ta < td ? 'D' : ta === Infinity ? '=' : 'x';
    out += `${cell}${String(r.ticks).padStart(3)}  `;
  }
  out += "\n";
}
console.log(`Level ${level}, Gen ${gen}. A = defender fell first, D = raider fell first, = neither fell, x = same tick. Number = ticks.\n` + out);
