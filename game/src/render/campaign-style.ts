import { Painter, type Color } from "./draw.ts";

/** Shared campaign frame, used by both game modes at native pixel coordinates. */
export function campaignBox(p: Painter, x: number, y: number, w: number, h: number, fill: Color = "white") {
  p.rect(x + 2, y + 3, w, h, "black"); p.rect(x, y, w, h, fill);
  p.notch(x, y, w, h, "black"); p.notch(x + 3, y + 3, w - 6, h - 6, "black");
  for (const [dx, dy] of [[0, 0], [w - 5, 0], [0, h - 5], [w - 5, h - 5]]) {
    p.rect(x + dx, y + dy, 5, 5, "black"); p.px(x + dx + 2, y + dy + 2, "white");
  }
}

/** Versus keeps logical input coordinates; letters use the campaign's untouched 5x7 bitmap. */
export class CampaignPainter extends Painter {
  override text(text: string, x: number, y: number, color: Color) {
    this.ctx.save(); this.ctx.scale(.5, .5);
    super.big(text, Math.round(x * 2), Math.round(y * 2), color);
    this.ctx.restore(); return x + textWidth(text);
  }
  override textRight(text: string, right: number, y: number, color: Color) { this.text(text, right - textWidth(text), y, color); }
  override textCenter(text: string, cx: number, y: number, color: Color) { this.text(text, cx - textWidth(text) / 2, y, color); }
  override lines(lines: readonly string[], x: number, y: number, color: Color) { lines.forEach((line, i) => this.text(line, x, y + i * LINE_H, color)); }
  override panel(x: number, y: number, w: number, h: number, fill: Color = "white") {
    this.ctx.save(); this.ctx.scale(.5, .5); campaignBox(this, x * 2, y * 2, w * 2, h * 2, fill); this.ctx.restore();
  }
}
export const LINE_H = 5;
export const textWidth = (text: string) => text.length ? text.length * 3 - .5 : 0;
export function wrap(text: string, width: number) {
  const max = Math.max(1, Math.floor(width / 3)), lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && line.length + word.length + 1 > max) { lines.push(line); line = ""; }
      line += (line ? " " : "") + word;
      while (line.length > max) { lines.push(line.slice(0, max)); line = line.slice(max); }
    }
    lines.push(line);
  }
  return lines;
}
