import { characterUrl, terrainUrl } from "../../assets/lantern/packed.ts";
import { PALETTE } from "./draw.ts";
import type { Role } from "../tactics.ts";

const RGB = Object.values(PALETTE).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
const LIGHT = 1;
export const CHARACTER_CELL: Record<Role, number> = { warden: 0, ranger: 1, mender: 2, raider: 3, archer: 3, sapper: 4, chief: 5 };
export const SCENERY = { pines: 0, oak: 1, mountain: 2, cottage: 3, tower: 4, shrine: 5, bramble: 6, flag: 7, flowers: 8, bridge: 9, rocks: 10, arch: 11, meadow: 12, water: 13, road: 14, planks: 15 } as const;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not load the sprite atlas.")); img.src = url; });
}

/** Decode once, palette-lock and slice. Source artwork remains intact in assets/lantern. */
export class Atlas {
  private characters: HTMLImageElement | null = null;
  private terrain: HTMLImageElement | null = null;
  private cache = new Map<string, HTMLCanvasElement>();
  async load() { [this.characters, this.terrain] = await Promise.all([load(characterUrl), load(terrainUrl)]); }
  get(kind: "character" | "terrain", index: number, size: number, cutout = true): HTMLCanvasElement | null {
    const key = `${kind}:${index}:${size}:${cutout}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const img = kind === "character" ? this.characters : this.terrain;
    if (!img) return null;
    const columns = kind === "character" ? 3 : 4, rows = kind === "character" ? 2 : 4;
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    // Area filtering here preserves silhouettes when converting large source art into small native sprites.
    // Quantization below removes all blended colors; the game always draws the final cached pixels unsmoothed.
    const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const cw = img.width / columns, ch = img.height / rows;
    const inset = kind === "terrain" && index >= 12 ? Math.round(Math.min(cw, ch) * .035) : 0;
    ctx.drawImage(img, Math.round(index % columns * cw) + inset, Math.round(Math.floor(index / columns) * ch) + inset, Math.floor(cw) - inset * 2, Math.floor(ch) - inset * 2, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size), px = data.data, colors = new Uint8Array(size * size);
    for (let i = 0; i < colors.length; i++) {
      const off = i * 4; let nearest = 0, best = Infinity;
      for (let n = 0; n < RGB.length; n++) { const distance = RGB[n].reduce((sum, v, channel) => sum + (px[off + channel] - v) ** 2, 0); if (distance < best) { best = distance; nearest = n; } }
      colors[i] = nearest; [px[off], px[off + 1], px[off + 2]] = RGB[nearest]; px[off + 3] = px[off + 3] < 128 ? 0 : 255;
    }
    if (cutout) {
      // Remove only pale pixels connected to the cell edge, preserving light faces, eyes and armor enclosed by outlines.
      const visited = new Uint8Array(size * size), queue: number[] = [];
      const push = (i: number) => { if (i >= 0 && i < colors.length && !visited[i] && colors[i] === LIGHT) { visited[i] = 1; queue.push(i); } };
      for (let i = 0; i < size; i++) { push(i); push((size - 1) * size + i); push(i * size); push(i * size + size - 1); }
      for (let n = 0; n < queue.length; n++) { const i = queue[n]; px[i * 4 + 3] = 0; if (i % size) push(i - 1); if (i % size < size - 1) push(i + 1); push(i - size); push(i + size); }
    }
    ctx.putImageData(data, 0, 0); this.cache.set(key, c); return c;
  }
  draw(ctx: CanvasRenderingContext2D, kind: "character" | "terrain", index: number, x: number, y: number, size: number, cutout = true) {
    const sprite = this.get(kind, index, size, cutout); if (sprite) ctx.drawImage(sprite, Math.round(x), Math.round(y));
  }
}
