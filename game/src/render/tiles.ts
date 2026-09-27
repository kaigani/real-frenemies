/**
 * Procedural 16 × 16 one-bit terrain tiles in the Generations art style: white ground, black ink, ordered dither.
 * Ground carries a light texture that tells each Scenery apart; features join up with their neighbours
 * (shorelines, runs of bookshelves, conveyor rails, starfield edges) instead of repeating as squares.
 */
import type { Scenery } from "../friends.ts";
import type { TileKind } from "../terrain.ts";
import type { Painter } from "./draw.ts";

export const TILE = 16;

export type TileOptions = {
  dir?: number; hp?: number; maxHp?: number; frame?: number;
  /** The region's Scenery, which picks the ground texture. */
  scenery?: Scenery;
  /** Whether the neighbour at (dx, dy) is the same feature, for joining edges. Off-board counts as different. */
  same?: (dx: number, dy: number) => boolean;
};

/** Deterministic per-tile hash so textures never flicker and never repeat in a visible grid. */
function hash(tx: number, ty: number, k = 0) {
  let h = (tx * 374761393 + ty * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Light ground marks per Scenery: roughly 6-10 ink pixels a tile so units stay readable on top. */
function ground(p: Painter, scenery: Scenery | undefined, x: number, y: number, tx: number, ty: number) {
  const h = hash(tx, ty), a = 2 + (h % 9), b = 2 + ((h >>> 4) % 9), c = 2 + ((h >>> 8) % 11), d = 2 + ((h >>> 12) % 11);
  const ink = (px: number, py: number) => p.px(x + px, y + py, "black");
  switch (scenery) {
    case "Coastal": // sand grains and the odd ripple
      ink(a, b); ink(c, d);
      if (h % 3 === 0) { ink(c, b + 3); ink(c + 1, b + 2); ink(c + 2, b + 3); ink(c + 3, b + 2); }
      break;
    case "Garden": // grass tufts
      for (const [gx, gy] of [[a, b], [c, d]]) { ink(gx, gy); ink(gx + 1, gy + 1); ink(gx + 2, gy); }
      if (h % 4 === 0) { ink(8, 3); ink(8, 4); }
      break;
    case "Industrial": // riveted floor plates: dotted seams along the top and left edges join into a plate grid
      for (let i = 0; i < TILE; i += 2) { ink(i, 0); ink(0, i); }
      ink(3, 3); ink(12, 12);
      break;
    case "Market": { // cobbles: rounded stones sketched by their corners, rows offset like brickwork
      const off = ty % 2 ? 0 : 4;
      for (const [k, [sx, sy]] of [[off + 1, 1], [off + 9, 1], [(off + 5) % 16, 9], [(off + 13) % 16, 9]].entries()) {
        if ((h >>> (k * 3)) % 3 === 0) continue;
        ink(sx, sy + 5); ink(sx + 1, sy + 6); ink(sx + 5, sy + 6); ink(sx + 6, sy + 5);
      }
      break;
    }
    case "Mineral": // gravel
      ink(a, b); ink(a + 1, b); ink(a, b + 1); ink(c, d); ink(c + 1, d + 1); ink((a + 6) % 13 + 1, (b + 7) % 13 + 1);
      break;
    case "Orbital": // tech deck: corner rivets and short panel ticks, a light node now and then
      ink(0, 0); ink(8, 0); ink(0, 8);
      if (h % 3 === 0) { ink(8, 7); ink(7, 8); ink(9, 8); ink(8, 9); }
      else if (h % 3 === 1) { ink(a, 4); ink(a + 1, 4); }
      break;
    case "Reading": { // floorboards: a plank seam with staggered joints and the odd knot
      const joint = (tx * 5 + ty * 3) % 16;
      for (let i = 0; i < TILE; i += 2) if (i !== joint && i !== (joint + 1) % 16) ink(i, 15);
      ink(joint, 12); ink(joint, 13); ink(joint, 14);
      if (h % 4 === 0) { ink(c, 6); ink(c + 1, 6); }
      break;
    }
    case "Rooftop": // shingle scallops, one row a tile, offset on alternate rows
      for (let i = ty % 2 ? 0 : 4; i < TILE; i += 8) { ink(i, 12); ink(i + 1, 13); ink(i + 2, 13); ink(i + 3, 13); ink(i + 4, 12); }
      if (h % 5 === 0) ink(a, 4);
      break;
    default:
      ink(a, b); ink(c, d);
  }
}

/** Draw one tile. `frame` advances slow ambient animation; pass 0 for reduced motion. */
export function drawTile(p: Painter, kind: TileKind, x: number, y: number, tx: number, ty: number, opts: TileOptions = {}) {
  const f = opts.frame ?? 0;
  const same = opts.same ?? (() => false);
  const h = hash(tx, ty, 7);
  const open = { n: !same(0, -1), s: !same(0, 1), w: !same(-1, 0), e: !same(1, 0) };
  /** Clear the outer corner pixel where two open edges meet, so blobs read as rounded shapes. */
  const roundCorners = () => {
    if (open.n && open.w) p.px(x, y, "white");
    if (open.n && open.e) p.px(x + 15, y, "white");
    if (open.s && open.w) p.px(x, y + 15, "white");
    if (open.s && open.e) p.px(x + 15, y + 15, "white");
  };
  p.rect(x, y, TILE, TILE, "white");
  switch (kind) {
    case "ground":
      ground(p, opts.scenery, x, y, tx, ty);
      break;
    case "water": {
      p.dither(x, y, TILE, TILE, "black", 1);
      for (const row of [4, 11]) {
        for (let i = 0; i < TILE; i++) if (((i + f + row + tx * 3) >> 1) % 4 === 0) p.px(x + i, y + row, "black");
      }
      // Shoreline: a white foam line inside a black edge wherever the water meets land.
      if (open.n) { p.rect(x, y + 1, TILE, 1, "white"); p.rect(x, y, TILE, 1, "black"); }
      if (open.s) { p.rect(x, y + 14, TILE, 1, "white"); p.rect(x, y + 15, TILE, 1, "black"); }
      if (open.w) { p.rect(x + 1, y, 1, TILE, "white"); p.rect(x, y, 1, TILE, "black"); }
      if (open.e) { p.rect(x + 14, y, 1, TILE, "white"); p.rect(x + 15, y, 1, TILE, "black"); }
      roundCorners();
      break;
    }
    case "overgrowth": {
      p.dither(x + 1, y + 1, 14, 14, "black", 1);
      const tufts = [[2, 3], [9, 2], [5, 8], [12, 9], [2, 12], [9, 13], [13, 4]];
      for (const [ox, oy] of tufts) {
        p.rect(x + ox - 1, y + oy - 2, 5, 4, "white");
        p.px(x + ox, y + oy, "black"); p.px(x + ox + 1, y + oy + 1, "black"); p.px(x + ox + 2, y + oy, "black"); p.px(x + ox + 1, y + oy - 1, "black");
      }
      // Soft fringe on open sides instead of a hard border.
      for (let i = 1; i < TILE; i += 3) {
        if (open.n) p.px(x + i, y, "black");
        if (open.s) p.px(x + i, y + 15, "black");
        if (open.w) p.px(x, y + i, "black");
        if (open.e) p.px(x + 15, y + i, "black");
      }
      break;
    }
    case "conveyor": {
      p.rect(x, y, TILE, TILE, "black");
      const dir = opts.dir ?? 0, shift = f % 4, horizontal = dir === 0 || dir === 2;
      // Rails along the belt's open sides.
      if (horizontal) {
        if (open.n) for (let i = 0; i < TILE; i++) p.px(x + i, y + 1, i % 4 === 1 ? "black" : "white");
        if (open.s) for (let i = 0; i < TILE; i++) p.px(x + i, y + 14, i % 4 === 1 ? "black" : "white");
      } else {
        if (open.w) for (let j = 0; j < TILE; j++) p.px(x + 1, y + j, j % 4 === 1 ? "black" : "white");
        if (open.e) for (let j = 0; j < TILE; j++) p.px(x + 14, y + j, j % 4 === 1 ? "black" : "white");
      }
      for (let k = 0; k < 2; k++) {
        const d = (k * 8 + shift * 2) % 16;
        for (let s = -3; s <= 3; s++) {
          const a = d + (3 - Math.abs(s)) - 3, b = 8 + s;
          const [cx, cy] = dir === 0 ? [a, b] : dir === 2 ? [15 - a, b] : dir === 1 ? [b, a] : [b, 15 - a];
          if (cx >= 3 && cx < 13 && cy >= 3 && cy < 13) p.px(x + cx, y + cy, "white");
        }
      }
      break;
    }
    case "stall": {
      const striped = h % 2 === 0;
      // Awning.
      p.rect(x + 1, y + 1, 14, 5, "black");
      for (let i = 0; i < 14; i++) for (let j = 0; j < 4; j++) {
        const white = striped ? i % 4 < 2 : (i + j) % 2 === 0;
        if (white) p.px(x + 1 + i, y + 1 + j, "white");
      }
      for (let i = 1; i < 15; i += 2) p.px(x + i, y + 6, "black"); // scalloped hem
      // Counter with goods.
      p.frame(x + 2, y + 7, 12, 8, "black");
      p.rect(x + 2, y + 10, 12, 1, "black");
      p.rect(x + 4, y + 8, 2, 2, "black"); p.rect(x + 8 + (h % 3), y + 8, 2, 2, "black");
      p.dither(x + 3, y + 11, 10, 3, "black", 1);
      crack(p, x, y, opts.hp ?? 2, opts.maxHp ?? 2);
      break;
    }
    case "crystal": {
      const cluster = h % 3 === 0;
      const gem = (cx: number, top: number, half: number, tall: number) => {
        for (let r = 0; r <= half; r++) {
          p.rect(x + cx - r, y + top + r, r * 2 + 1, 1, "black");
          p.rect(x + cx - r, y + top + tall - r, r * 2 + 1, 1, "black");
        }
        p.rect(x + cx - half, y + top + half, half * 2 + 1, tall - half * 2 + 1, "black");
        // Facet highlight and a dithered face.
        p.dither(x + cx + 1, y + top + half, Math.max(1, half - 1), tall - half * 2, "white", 2);
        for (let r = 1; r < half; r++) p.px(x + cx - r + 1, y + top + r + 1, "white");
      };
      if (cluster) { gem(5, 3, 3, 11); gem(11, 1, 3, 13); }
      else gem(8, 1, 6, 14);
      crack(p, x, y, opts.hp ?? 4, opts.maxHp ?? 4);
      break;
    }
    case "zerog": {
      p.rect(x, y, TILE, TILE, "black");
      for (const [sx, sy, phase] of [[3, 3, 0], [11, 5, 1], [6, 11, 2], [13, 13, 3], [2 + (h % 10), 8, 2]]) {
        p.px(x + sx, y + sy, "white");
        if ((f + phase) % 4 === 0) { p.px(x + sx - 1, y + sy, "white"); p.px(x + sx + 1, y + sy, "white"); p.px(x + sx, y + sy - 1, "white"); p.px(x + sx, y + sy + 1, "white"); }
      }
      // Dithered rim where the void meets ground, rounded at outer corners.
      if (open.n) p.dither(x, y, TILE, 1, "white", 2);
      if (open.s) p.dither(x, y + 15, TILE, 1, "white", 2);
      if (open.w) p.dither(x, y, 1, TILE, "white", 2);
      if (open.e) p.dither(x + 15, y, 1, TILE, "white", 2);
      roundCorners();
      break;
    }
    case "library": {
      // Bookcases join side by side; posts and a cap only on open sides.
      if (open.n) { p.rect(x, y, TILE, 2, "black"); p.rect(x, y + 1, TILE, 1, "white"); p.rect(x, y + 1, TILE, 1, "black"); }
      for (const shelf of [5, 10, 15]) {
        p.rect(x, y + shelf, TILE, 1, "black");
        // Books of hashed heights, with the odd gap.
        for (let bx = 2; bx < 14; bx += 2) {
          const bh = hash(tx * 16 + bx, ty * 3 + shelf, 3);
          if (bh % 7 === 0) continue;
          const tall = 2 + (bh % 3);
          p.rect(x + bx, y + shelf - tall, 1, tall, "black");
          if (bh % 5 === 0) p.px(x + bx + 1, y + shelf - 1, "black");
        }
      }
      if (open.w) p.rect(x, y, 2, TILE, "black");
      if (open.e) p.rect(x + 14, y, 2, TILE, "black");
      break;
    }
    case "ledge": {
      ground(p, opts.scenery, x, y, tx, ty);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 16; j++) if ((i + j) % 4 === 0) p.px(x + i, y + j, "black");
      p.rect(x + 12, y, 1, TILE, "white");
      p.rect(x + 13, y, 3, TILE, "black");
      for (let j = 1; j < TILE; j += 3) p.px(x + 14, y + j, "white");
      p.px(x + 8, y + 6, "black"); p.px(x + 9, y + 7, "black"); p.px(x + 10, y + 8, "black"); p.px(x + 9, y + 9, "black"); p.px(x + 8, y + 10, "black");
      break;
    }
  }
}

function crack(p: Painter, x: number, y: number, hp: number, maxHp: number) {
  const lost = maxHp - hp;
  if (lost >= 1) { p.px(x + 6, y + 8, "white"); p.px(x + 7, y + 9, "white"); p.px(x + 8, y + 9, "white"); }
  if (lost >= 2) { p.px(x + 9, y + 10, "white"); p.px(x + 10, y + 11, "white"); p.px(x + 5, y + 7, "white"); }
  if (lost >= 3) { p.px(x + 4, y + 11, "white"); p.px(x + 11, y + 6, "white"); }
}

export const TILE_NAMES: Record<TileKind, string> = {
  ground: "Ground", water: "Water", overgrowth: "Overgrowth", conveyor: "Conveyor", stall: "Stall",
  crystal: "Crystal wall", zerog: "Zero-g", library: "Library", ledge: "Ledge",
};
