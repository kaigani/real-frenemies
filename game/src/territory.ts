/**
 * Territory: a home region plus up to four expansions on a 3 × 3 map. Each region is a full board with its own
 * garrison and a holder: the territory's owner, a resident who claimed its flag, or nobody (contested).
 */
import type { Friend } from "./friends.ts";
import { GARRISON_FOR_BONUS, MAX_REGIONS, territoryMultiplier } from "./rules.ts";
import { generateBoard, regionScenery, type Board } from "./terrain.ts";

export type HolderId = string;
export const YOU: HolderId = "you";

export type Piece = { key: string; friend: Friend; level: number; x: number; y: number };
export type Region = {
  key: string; dx: number; dy: number; board: Board; home: boolean;
  /** Who garrisons the region and gets its bonus. `null` = flag down: the owner may reclaim it. */
  holder: HolderId | null;
  garrison: Piece[];
};
export type Territory = { owner: HolderId; anchor: Friend; regions: Region[] };

export const regionKey = (dx: number, dy: number) => `${dx},${dy}`;
const NAMES: Record<string, string> = {
  "0,0": "HOME", "1,0": "EAST", "-1,0": "WEST", "0,-1": "NORTH", "0,1": "SOUTH",
  "1,-1": "NORTHEAST", "-1,-1": "NORTHWEST", "1,1": "SOUTHEAST", "-1,1": "SOUTHWEST",
};
export const regionName = (r: { dx: number; dy: number }) => NAMES[regionKey(r.dx, r.dy)] ?? regionKey(r.dx, r.dy);

export function createTerritory(owner: HolderId, anchor: Friend): Territory {
  return { owner, anchor, regions: [makeRegion(owner, anchor, 0, 0)] };
}

function makeRegion(holder: HolderId, anchor: Friend, dx: number, dy: number): Region {
  const home = dx === 0 && dy === 0;
  const scenery = home ? anchor.scenery : regionScenery(anchor.tokenId, anchor.seed, dx, dy);
  return { key: regionKey(dx, dy), dx, dy, board: generateBoard(anchor.tokenId, anchor.seed, scenery, { dx, dy }), home, holder, garrison: [] };
}

export function region(t: Territory, key: string) {
  return t.regions.find(r => r.key === key);
}

/** Cells the territory can expand into: orthogonal neighbours of any region, inside the 3 × 3 map. */
export function expansionOptions(t: Territory): { dx: number; dy: number }[] {
  if (t.regions.length >= MAX_REGIONS) return [];
  const out: { dx: number; dy: number }[] = [];
  for (const r of t.regions) {
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const dx = r.dx + ox, dy = r.dy + oy;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || region(t, regionKey(dx, dy)) || out.some(o => o.dx === dx && o.dy === dy)) continue;
      out.push({ dx, dy });
    }
  }
  return out.sort((a, b) => a.dy - b.dy || a.dx - b.dx);
}

export function expandTerritory(t: Territory, dx: number, dy: number): Region {
  if (!expansionOptions(t).some(o => o.dx === dx && o.dy === dy)) throw new Error("That region isn't adjacent to your territory.");
  const r = makeRegion(t.owner, t.anchor, dx, dy);
  t.regions.push(r);
  t.regions.sort((a, b) => (a.home ? 1 : 0) - (b.home ? 1 : 0) || a.dy - b.dy || a.dx - b.dx);
  return r;
}

/** Regions a holder controls across every territory, excluding home regions (they carry no bonus). */
export function extraRegionsHeld(territories: readonly Territory[], holder: HolderId): Region[] {
  return territories.flatMap(t => t.regions.filter(r => !r.home && r.holder === holder));
}

/** Only garrisoned regions (at least GARRISON_FOR_BONUS pieces) supply the territory bonus. */
export function garrisoned(r: Region) { return r.garrison.length >= GARRISON_FOR_BONUS; }

export function bonusFor(territories: readonly Territory[], holder: HolderId) {
  return territoryMultiplier(extraRegionsHeld(territories, holder).filter(garrisoned).length);
}

export function supplyUsed(r: Region) { return r.garrison.reduce((n, p) => n + p.level, 0); }

export function cloneTerritory(t: Territory): Territory {
  return { owner: t.owner, anchor: t.anchor, regions: t.regions.map(r => ({ ...r, garrison: r.garrison.map(p => ({ ...p })) })) };
}

/** Battle order for a raid on a territory: expansions first (map order), the home region last. */
export function battleOrder(t: Territory): Region[] {
  return [...t.regions].sort((a, b) => (a.home ? 1 : 0) - (b.home ? 1 : 0) || a.dy - b.dy || a.dx - b.dx);
}
