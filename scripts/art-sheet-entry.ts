/** Browser entry for the terrain art sheet: one generated board per Scenery at native resolution. */
import { POOL, SCENERIES } from "../game/src/friends.ts";
import { generateBoard, tileAt } from "../game/src/terrain.ts";
import { Painter } from "../game/src/render/draw.ts";
import { drawTile, TILE } from "../game/src/render/tiles.ts";
import { GRID_H, GRID_W } from "../game/src/rules.ts";
const canvas = document.createElement("canvas");
canvas.width = 4 * (GRID_W * TILE + 8); canvas.height = 2 * (GRID_H * TILE + 16);
const scale = 2;
canvas.style.width = `${canvas.width * scale}px`; canvas.style.imageRendering = "pixelated";
document.body.style.margin = "0"; document.body.appendChild(canvas);
const p = new Painter(canvas.getContext("2d")!);
p.rect(0, 0, canvas.width, canvas.height, "white");
SCENERIES.forEach((scenery, i) => {
  const f = POOL.find(x => x.scenery === scenery)!;
  const board = generateBoard(f.tokenId, f.seed, scenery);
  const ox = (i % 4) * (GRID_W * TILE + 8) + 4, oy = Math.floor(i / 4) * (GRID_H * TILE + 16) + 12;
  p.text(scenery.toUpperCase(), ox, oy - 8, "black");
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const t = tileAt(board, x, y);
    const kindAt = (a: number, b: number) => a < 0 || b < 0 || a >= GRID_W || b >= GRID_H ? null : tileAt(board, a, b).kind;
    drawTile(p, t.kind, ox + x * TILE, oy + y * TILE, x, y, { dir: t.dir, hp: t.hp, scenery, same: (dx, dy) => kindAt(x + dx, y + dy) === t.kind });
  }
  p.frame(ox - 1, oy - 1, GRID_W * TILE + 2, GRID_H * TILE + 2, "black");
});
(window as unknown as { done: boolean }).done = true;
