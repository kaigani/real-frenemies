/** Pixel painter: integer rects, bitmap text, cached 1-bit sprites and ordered dither. Never antialiases. */
import { BIG_H, BIG_W, bigGlyph, bigWidth } from "./bigfont.ts";
import { CHAR_W, glyph, LINE_H, textWidth } from "./font.ts";

export const PALETTE = { black: "#000000", white: "#ffffff", lime: "#ccff00", pink: "#ff3b6b" } as const;
export type Color = keyof typeof PALETTE;
/** Dither density: 1 = 25%, 2 = 50%, 3 = 75% of pixels in the colour. */
export type Density = 1 | 2 | 3;

const DITHER: Record<Density, readonly (readonly number[])[]> = {
  1: [[1, 0], [0, 0]],
  2: [[1, 0], [0, 1]],
  3: [[1, 1], [1, 0]],
};

export class Painter {
  readonly ctx: CanvasRenderingContext2D;
  private patterns = new Map<string, CanvasPattern>();
  private sprites = new Map<string, HTMLCanvasElement>();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  rect(x: number, y: number, w: number, h: number, color: Color) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = PALETTE[color];
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  px(x: number, y: number, color: Color) { this.rect(x, y, 1, 1, color); }

  frame(x: number, y: number, w: number, h: number, color: Color) {
    this.rect(x, y, w, 1, color); this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y, 1, h, color); this.rect(x + w - 1, y, 1, h, color);
  }

  private pattern(color: Color, density: Density) {
    const key = `${color}${density}`;
    let p = this.patterns.get(key);
    if (!p) {
      const c = document.createElement("canvas");
      c.width = 2; c.height = 2;
      const g = c.getContext("2d")!;
      g.fillStyle = PALETTE[color];
      DITHER[density].forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect(x, y, 1, 1); }));
      p = this.ctx.createPattern(c, "repeat")!;
      this.patterns.set(key, p);
    }
    return p;
  }

  /** Ordered dither anchored to the canvas origin, so neighbouring fills line up. */
  dither(x: number, y: number, w: number, h: number, color: Color, density: Density) {
    this.ctx.fillStyle = this.pattern(color, density);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  text(text: string, x: number, y: number, color: Color, _options: { dim?: boolean } = {}) {
    this.ctx.fillStyle = PALETTE[color];
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch of text) {
      const rows = glyph(ch);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (rows[r] & (1 << c)) this.ctx.fillRect(cx + c, cy + r, 1, 1);
      cx += CHAR_W;
    }
    return cx - 1;
  }

  textRight(text: string, right: number, y: number, color: Color) { this.text(text, right - textWidth(text), y, color); }
  textCenter(text: string, cx: number, y: number, color: Color, options: { dim?: boolean } = {}) {
    this.text(text, cx - Math.floor(textWidth(text) / 2), y, color, options);
  }
  lines(lines: readonly string[], x: number, y: number, color: Color) {
    lines.forEach((line, i) => this.text(line, x, y + i * LINE_H, color));
  }

  /** 5 × 7 display text. `shadow` adds a 1 px drop shadow down-right in that colour. */
  big(text: string, x: number, y: number, color: Color, options: { shadow?: Color } = {}) {
    const draw = (ox: number, oy: number, c: Color) => {
      this.ctx.fillStyle = PALETTE[c];
      let cx = Math.round(x) + ox;
      for (const ch of text) {
        const rows = bigGlyph(ch);
        for (let r = 0; r < BIG_H; r++) for (let k = 0; k < 5; k++) if (rows[r] & (1 << k)) this.ctx.fillRect(cx + k, Math.round(y) + oy + r, 1, 1);
        cx += BIG_W;
      }
    };
    if (options.shadow) draw(1, 1, options.shadow);
    draw(0, 0, color);
  }
  bigCenter(text: string, cx: number, y: number, color: Color, options: { shadow?: Color } = {}) {
    this.big(text, cx - Math.floor(bigWidth(text) / 2), y, color, options);
  }

  /** Small text with a 1 px outline all round: readable over any tile without a box. */
  textOutlined(text: string, x: number, y: number, color: Color, outline: Color = "black") {
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) this.text(text, x + ox, y + oy, outline);
    this.text(text, x, y, color);
  }

  /** A frame with its four corner pixels cut, the classic pixel-UI rounded box. */
  notch(x: number, y: number, w: number, h: number, color: Color) {
    this.rect(x + 1, y, w - 2, 1, color); this.rect(x + 1, y + h - 1, w - 2, 1, color);
    this.rect(x, y + 1, 1, h - 2, color); this.rect(x + w - 1, y + 1, 1, h - 2, color);
  }

  /** Panel: fill, notched outline and a 1 px drop shadow along the right and bottom. */
  panel(x: number, y: number, w: number, h: number, fill: Color = "white") {
    this.rect(x + 2, y + h, w - 2, 1, "black");
    this.rect(x + w, y + 2, 1, h - 2, "black");
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
    this.notch(x, y, w, h, "black");
  }

  /**
   * A 16 × 16 one-bit sprite (bit 0 = top-left). `color` paints set bits; `back` optionally paints the rest.
   * `density` < 4 dissolves it through the dither pattern (used for knock-outs).
   */
  sprite(bits: bigint, x: number, y: number, color: Color, options: { back?: Color; flip?: boolean; scale?: number } = {}) {
    const scale = options.scale ?? 1;
    const key = `${bits.toString(36)}:${color}:${options.back ?? ""}:${options.flip ? 1 : 0}:${scale}`;
    let c = this.sprites.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = 16 * scale; c.height = 16 * scale;
      const g = c.getContext("2d")!;
      for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
        const on = (bits >> BigInt(py * 16 + px)) & 1n;
        const fill = on ? color : options.back;
        if (!fill) continue;
        g.fillStyle = PALETTE[fill];
        g.fillRect((options.flip ? 15 - px : px) * scale, py * scale, scale, scale);
      }
      if (this.sprites.size > 4000) this.sprites.clear();
      this.sprites.set(key, c);
    }
    this.ctx.drawImage(c, Math.round(x), Math.round(y));
  }

  /**
   * An 8 × 8 thumbnail of a 16 × 16 sprite for maps: each 2 × 2 block is set when at least two of its pixels are.
   * Built on the native pixel grid (no scaling), so it stays crisp; cached per sprite.
   */
  mini(bits: bigint, x: number, y: number, color: Color) {
    const key = `m:${bits.toString(36)}:${color}`;
    let c = this.sprites.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = 8; c.height = 8;
      const g = c.getContext("2d")!;
      g.fillStyle = PALETTE[color];
      const on = (px: number, py: number) => ((bits >> BigInt(py * 16 + px)) & 1n) === 1n ? 1 : 0;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        if (on(px * 2, py * 2) + on(px * 2 + 1, py * 2) + on(px * 2, py * 2 + 1) + on(px * 2 + 1, py * 2 + 1) >= 2) g.fillRect(px, py, 1, 1);
      }
      this.sprites.set(key, c);
    }
    this.ctx.drawImage(c, Math.round(x), Math.round(y));
  }

  /** Outline a 16 × 16 sprite silhouette in a colour (1 px, 4-connected), for team marking. */
  outline(bits: bigint, x: number, y: number, color: Color) {
    const on = (px: number, py: number) => px >= 0 && py >= 0 && px < 16 && py < 16 && ((bits >> BigInt(py * 16 + px)) & 1n) === 1n;
    const key = `o:${bits.toString(36)}:${color}`;
    let c = this.sprites.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = 18; c.height = 18;
      const g = c.getContext("2d")!;
      g.fillStyle = PALETTE[color];
      for (let py = -1; py <= 16; py++) for (let px = -1; px <= 16; px++) {
        if (on(px, py)) continue;
        if (on(px + 1, py) || on(px - 1, py) || on(px, py + 1) || on(px, py - 1)) g.fillRect(px + 1, py + 1, 1, 1);
      }
      this.sprites.set(key, c);
    }
    this.ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1);
  }

  /** Stepped alpha only: the dissolve uses dither density rather than a fade. */
  withClip(x: number, y: number, w: number, h: number, draw: () => void) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
    draw();
    this.ctx.restore();
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Color, every = 1) {
    let x = Math.round(x0), y = Math.round(y0);
    const tx = Math.round(x1), ty = Math.round(y1);
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      if (n++ % every === 0) this.px(x, y, color);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
}
