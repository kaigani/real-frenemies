import { SCENERIES, type Scenery } from "./friends.ts";
import { createRng, mixSeed, type Rng } from "./rng.ts";
import { BUILD_MIN_X, GRID_H, GRID_W } from "./rules.ts";

export type TileKind = "ground" | "water" | "overgrowth" | "conveyor" | "stall" | "crystal" | "zerog" | "library" | "ledge";
/** Direction index: 0 east, 1 south, 2 west, 3 north. */
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
export type Tile = { kind: TileKind; hp: number; dir: number };
/** `core` is the Core tile on a home board and the flag tile on an expanded region (`home: false`). */
export type Board = Readonly<{ scenery: Scenery; seed: number; home: boolean; tiles: readonly Readonly<Tile>[]; core: Readonly<{ x: number; y: number }> }>;

export const WALL_HP: Partial<Record<TileKind, number>> = { stall: 2, crystal: 4 };
export const isWallKind = (kind: TileKind) => kind === "stall" || kind === "crystal";
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
export const index = (x: number, y: number) => y * GRID_W + x;

/** An expanded region's Scenery is fixed by the anchor token and the region's offset, so it is public and reproducible. */
export function regionScenery(tokenId: bigint, seed: number, dx: number, dy: number): Scenery {
  return SCENERIES[createRng(mixSeed("frenemies-region", tokenId, seed, dx, dy)).int(SCENERIES.length)];
}

/** Same token → same base, forever. The Core's Scenery decides the home terrain; regions use their own. */
export function generateBoard(tokenId: bigint, seed: number, scenery: Scenery, region: { dx: number; dy: number } = { dx: 0, dy: 0 }): Board {
  const home = region.dx === 0 && region.dy === 0;
  const rng = createRng(home ? mixSeed("frenemies-base", tokenId, seed) : mixSeed("frenemies-base", tokenId, seed, region.dx, region.dy));
  const core = { x: GRID_W - 2, y: 3 + rng.int(2) };
  const tiles: Tile[] = Array.from({ length: GRID_W * GRID_H }, () => ({ kind: "ground", hp: 0, dir: 0 }));
  const reserved = (x: number, y: number) => x < 2 || (Math.abs(x - core.x) <= 1 && Math.abs(y - core.y) <= 1);
  const set = (x: number, y: number, kind: TileKind, dir = 0) => {
    if (!inBounds(x, y) || reserved(x, y)) return false;
    tiles[index(x, y)] = { kind, hp: WALL_HP[kind] ?? 0, dir };
    return true;
  };
  const blob = (kind: TileKind, size: number) => {
    let x = 2 + rng.int(GRID_W - 4), y = rng.int(GRID_H);
    for (let placed = 0, tries = 0; placed < size && tries < size * 6; tries++) {
      if (set(x, y, kind)) placed++;
      const [dx, dy] = DIRS[rng.int(4)];
      if (inBounds(x + dx, y + dy) && x + dx >= 2) { x += dx; y += dy; }
    }
  };
  switch (scenery) {
    case "Coastal": for (let i = 0, n = 2 + rng.int(2); i < n; i++) blob("water", 5 + rng.int(4)); break;
    case "Garden": for (let i = 0, n = 3; i < n; i++) blob("overgrowth", 4 + rng.int(3)); break;
    case "Orbital": for (let i = 0; i < 2; i++) blob("zerog", 4 + rng.int(3)); break;
    case "Reading": for (let i = 0; i < 2; i++) blob("library", 4 + rng.int(3)); break;
    case "Industrial":
      for (let i = 0, n = 2 + rng.int(2); i < n; i++) {
        const vertical = rng.chance(60), dir = vertical ? (rng.chance(50) ? 1 : 3) : 2;
        const length = 3 + rng.int(3);
        let x = 3 + rng.int(GRID_W - 6), y = rng.int(GRID_H - (vertical ? length : 0));
        for (let k = 0; k < length; k++) { set(x, y, "conveyor", dir); if (vertical) y++; else x++; }
      }
      break;
    case "Market": for (let i = 0, n = 5 + rng.int(3); i < n; i++) set(2 + rng.int(GRID_W - 4), rng.int(GRID_H), "stall"); break;
    case "Mineral":
      for (let i = 0, n = 2 + rng.int(2); i < n; i++) {
        const x = 3 + rng.int(GRID_W - 6), y = rng.int(GRID_H - 2), length = 2 + rng.int(2);
        for (let k = 0; k < length; k++) set(x, y + k, "crystal");
      }
      break;
    case "Rooftop":
      for (let i = 0, n = 1 + rng.int(2); i < n; i++) {
        const x = 4 + rng.int(GRID_W - 7), from = rng.int(3), to = GRID_H - rng.int(3);
        for (let y = from; y < to; y++) set(x, y, "ledge", 0);
      }
      break;
  }
  return Object.freeze({ scenery, seed, home, tiles: Object.freeze(tiles.map(t => Object.freeze(t))), core: Object.freeze(core) });
}

export function tileAt(board: Board, x: number, y: number) {
  return board.tiles[index(x, y)];
}

/** Defenders go on any non-wall tile east of the entry columns, except the Core. */
export function buildable(board: Board, x: number, y: number) {
  if (!inBounds(x, y) || x < BUILD_MIN_X) return false;
  if (x === board.core.x && y === board.core.y) return false;
  return !isWallKind(tileAt(board, x, y).kind);
}

export function describeBase(board: Board) {
  const counts = new Map<TileKind, number>();
  for (const t of board.tiles) if (t.kind !== "ground") counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
  return counts;
}

export type { Rng };
