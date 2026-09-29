import { Painter, PALETTE, type Color } from "./draw.ts";
import { bigGlyph } from "./bigfont.ts";
import { glyph } from "./font.ts";

/** Story-mode letterforms at native density, preserving versus UI text metrics and hit targets. */
export class VersusPainter extends Painter {
  override text(text: string, x: number, y: number, color: Color, _options: { dim?: boolean } = {}) {
    const ctx = this.ctx; ctx.save(); ctx.scale(.5, .5); ctx.fillStyle = PALETTE[color];
    const left = Math.round(x) * 2, top = Math.round(y) * 2;
    [...text].forEach((ch, i) => {
      const rows = bigGlyph(ch);
      if (ch !== " " && !rows.some(Boolean)) {
        const fallback = glyph(ch);
        for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
          if (fallback[row] & (1 << col)) ctx.fillRect(left + i * 8 + col * 2, top + row * 2, 2, 2);
        }
        return;
      }
      for (let row = 0; row < 10; row++) for (let col = 0; col < 6; col++) {
        if (rows[Math.floor(row * 7 / 10)] & (1 << Math.floor(col * 5 / 6))) ctx.fillRect(left + i * 8 + col, top + row, 1, 1);
      }
    });
    ctx.restore(); return Math.round(x) + text.length * 4 - 1;
  }
}
