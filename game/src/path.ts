import { GRID_H, GRID_W } from "./rules.ts";

export type Step = Readonly<{ x: number; y: number }>;
export type Neighbor = Readonly<{ x: number; y: number; cost: number }>;

/** A* over the 12 × 8 grid. Ties break on insertion order, so results are deterministic. Excludes the start tile. */
export function findPath(
  start: Step,
  isGoal: (x: number, y: number) => boolean,
  neighbors: (x: number, y: number) => readonly Neighbor[],
  heuristic: (x: number, y: number) => number,
): Step[] | null {
  const size = GRID_W * GRID_H, key = (x: number, y: number) => y * GRID_W + x;
  const g = new Float64Array(size).fill(Infinity), from = new Int32Array(size).fill(-1), closed = new Uint8Array(size);
  const open: { k: number; f: number; order: number }[] = [];
  let order = 0;
  const s = key(start.x, start.y);
  g[s] = 0;
  open.push({ k: s, f: heuristic(start.x, start.y), order: order++ });
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f || (open[i].f === open[best].f && open[i].order < open[best].order)) best = i;
    }
    const { k } = open.splice(best, 1)[0];
    if (closed[k]) continue;
    closed[k] = 1;
    const x = k % GRID_W, y = (k - x) / GRID_W;
    if (k !== s && isGoal(x, y)) {
      const path: Step[] = [];
      for (let c = k; c !== s; c = from[c]) path.push({ x: c % GRID_W, y: Math.floor(c / GRID_W) });
      return path.reverse();
    }
    if (k === s && isGoal(x, y)) return [];
    for (const n of neighbors(x, y)) {
      const nk = key(n.x, n.y);
      if (closed[nk]) continue;
      const cost = g[k] + n.cost;
      if (cost < g[nk]) {
        g[nk] = cost; from[nk] = k;
        open.push({ k: nk, f: cost + heuristic(n.x, n.y), order: order++ });
      }
    }
  }
  return null;
}
