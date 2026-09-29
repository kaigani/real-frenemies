/** Native-density artwork for the versus renderer's 2x logical-coordinate interface. */
import { Atlas, SCENERY } from "./atlas.ts";
import { Painter } from "./draw.ts";
import type { Scenery } from "../friends.ts";
import type { TileKind } from "../terrain.ts";
import type { TileOptions } from "./tiles.ts";

export class VersusArt {
  readonly atlas = new Atlas();
  private p: Painter;
  constructor(ctx: CanvasRenderingContext2D) { this.p = new Painter(ctx); }
  load() { return this.atlas.load(); }
  portrait(index: number, x: number, y: number, size: number) {
    const ctx = this.p.ctx; ctx.save(); ctx.scale(.5, .5);
    this.atlas.draw(ctx, "character", index, x * 2, y * 2, size * 2); ctx.restore();
  }
  scenery(index: number, x: number, y: number, size: number) {
    const ctx = this.p.ctx; ctx.save(); ctx.scale(.5, .5);
    this.atlas.draw(ctx, "terrain", index, x * 2, y * 2, size * 2); ctx.restore();
  }
  tile(kind: TileKind, x: number, y: number, tx: number, ty: number, opts: TileOptions, size = 16) {
    const ctx = this.p.ctx; ctx.save(); ctx.scale(.5, .5); ctx.translate(x * 2, y * 2);
    ctx.scale(size / 16, size / 16); ctx.beginPath(); ctx.rect(0, 0, 32, 32); ctx.clip();
    this.nativeTile(kind, tx, ty, opts); ctx.restore();
  }
  private ground(scenery: Scenery | undefined, hash: number) {
    const p = this.p;
    p.rect(0, 0, 32, 32, "white");
    if (scenery === "Industrial" || scenery === "Orbital") {
      p.rect(0, 0, 32, 1, "lime"); p.rect(0, 0, 1, 32, "lime");
      for (const [x, y] of [[3, 3], [28, 3], [3, 28], [28, 28]]) p.px(x, y, "pink");
      if (scenery === "Orbital") { p.rect(10, 14, 12, 1, "lime"); p.rect(16, 10, 1, 9, "lime"); }
    } else if (scenery === "Reading" || scenery === "Rooftop") {
      for (let y = 7; y < 32; y += 8) { p.rect(0, y, 32, 1, "lime"); p.rect((y * 3 + hash) % 25, y - 6, 1, 6, "lime"); }
    } else if (scenery === "Market") {
      for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
        const x = (col * 12 + row % 2 * 6) % 30, y = row * 8;
        p.rect(x, y + 6, Math.min(9, 32 - x), 1, "lime"); p.rect(x, y + 1, 1, 5, "lime");
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const x = 3 + (hash + i * 13) % 25, y = 3 + (hash * 3 + i * 7) % 25;
        p.px(x, y, "lime"); p.px(x + 1, y - 1, "lime");
        if (scenery === "Garden") p.px(x + 2, y, "pink");
        if (scenery === "Mineral") p.rect(x, y + 1, 2, 1, "pink");
      }
    }
  }
  private nativeTile(kind: TileKind, tx: number, ty: number, opts: TileOptions) {
    const p = this.p, ctx = p.ctx, hash = (tx * 71 + ty * 137) % 29, f = opts.frame ?? 0;
    const sprite = (index: number, cutout = true) => this.atlas.draw(ctx, "terrain", index, 0, 0, 32, cutout);
    this.ground(opts.scenery, hash);
    switch (kind) {
      case "ground": break;
      case "water":
        sprite(SCENERY.water, false);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (!opts.same?.(dx, dy)) {
          const x = dx === 1 ? 30 : 0, y = dy === 1 ? 30 : 0;
          p.rect(x, y, dx ? 2 : 32, dy ? 2 : 32, "black");
          p.rect(x + (dx === -1 ? 2 : dx === 1 ? -1 : 0), y + (dy === -1 ? 2 : dy === 1 ? -1 : 0), dx ? 1 : 32, dy ? 1 : 32, "white");
        }
        p.rect(6 + f % 3, 12, 5, 1, "white"); break;
      case "overgrowth": sprite((tx + ty) % 3 ? SCENERY.pines : SCENERY.oak); break;
      case "conveyor": {
        // Direction arrows, rails and animated treads remain mechanically legible.
        ctx.save(); ctx.translate(16, 16); ctx.rotate((opts.dir ?? 0) * Math.PI / 2); ctx.translate(-16, -16);
        p.rect(0, 3, 32, 26, "black"); p.rect(0, 6, 32, 20, "pink");
        for (let x = -8 + f % 4 * 2; x < 32; x += 8) p.rect(x, 7, 2, 18, "black");
        p.rect(0, 3, 32, 2, "white"); p.rect(0, 27, 32, 2, "lime");
        for (let x = 1; x < 32; x += 6) { p.px(x, 4, "black"); p.px(x, 28, "black"); }
        for (let d = 0; d < 6; d++) { p.rect(12 + d, 10 + d, 3, 2, "white"); p.rect(12 + d, 20 - d, 3, 2, "white"); }
        ctx.restore(); break;
      }
      case "stall":
        p.rect(5, 5, 23, 25, "black"); p.rect(6, 6, 21, 22, "pink");
        p.rect(2, 3, 28, 9, "black");
        for (let x = 3; x < 29; x += 6) { p.rect(x, 4, 3, 8, "white"); p.rect(x + 3, 4, 3, 8, "lime"); }
        p.rect(4, 13, 2, 14, "black"); p.rect(26, 13, 2, 14, "black"); p.rect(7, 14, 18, 7, "white");
        for (const [x, y] of [[9, 17], [14, 16], [20, 17]]) { p.rect(x, y, 3, 3, "black"); p.px(x, y, "lime"); }
        p.rect(4, 22, 24, 3, "black"); p.rect(6, 23, 20, 1, "lime"); p.dither(8, 26, 16, 3, "black", 1); break;
      case "crystal":
        for (const [cx, top, h, w] of [[9, 7, 22, 5], [21, 1, 28, 6]]) {
          for (let row = 0; row < h; row++) {
            const half = Math.min(w, row + 1, h - row);
            p.rect(cx - half, top + row, half * 2 + 1, 1, "black");
            if (half > 1) { p.rect(cx - half + 1, top + row, half - 1, 1, "white"); p.rect(cx, top + row, half, 1, "pink"); }
          }
          p.rect(cx - 1, top + 3, 1, h - 7, "lime");
        }
        break;
      case "zerog":
        p.rect(0, 0, 32, 32, "black"); p.dither(0, 0, 32, 32, "pink", 1);
        for (let i = 0; i < 6; i++) {
          const x = 3 + (hash + i * 11) % 26, y = 3 + (hash * 3 + i * 7) % 26;
          p.px(x, y, "white"); if ((i + f) % 3 === 0) { p.rect(x - 1, y, 3, 1, "white"); p.rect(x, y - 1, 1, 3, "white"); }
        }
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (!opts.same?.(dx, dy)) p.rect(dx === 1 ? 31 : 0, dy === 1 ? 31 : 0, dx ? 1 : 32, dy ? 1 : 32, "lime");
        break;
      case "library":
        p.rect(0, 1, 32, 30, "black"); p.rect(2, 3, 28, 26, "pink");
        for (const shelf of [12, 23]) {
          for (let x = 3; x < 29; x += 4) {
            const h = 5 + (x + hash) % 4; p.rect(x, shelf - h, 3, h, (x + hash) % 3 ? "white" : "lime"); p.px(x + 1, shelf - 2, "pink");
          }
          p.rect(1, shelf, 30, 2, "black"); p.rect(2, shelf + 2, 28, 1, "lime");
        }
        p.rect(3, 1, 26, 1, "lime"); p.dither(3, 27, 26, 3, "black", 1); break;
      case "ledge":
        p.rect(0, 0, 26, 32, "lime"); p.rect(26, 0, 6, 32, "black"); p.rect(27, 1, 3, 30, "pink");
        for (let y = 3; y < 32; y += 6) { p.rect(2, y, 22, 1, "white"); p.rect(29, y, 3, 2, "white"); }
        p.rect(24, 0, 2, 32, "white"); break;
    }
    if (opts.hp !== undefined && opts.maxHp && opts.hp < opts.maxHp && opts.hp > 0) {
      p.line(13, 4, 17, 10, "black"); p.line(17, 10, 12, 18, "black"); p.line(12, 18, 19, 27, "black");
      p.rect(6, 29, 20, 2, "black"); p.rect(7, 29, Math.round(opts.hp / opts.maxHp * 18), 1, "white");
    }
  }
}
