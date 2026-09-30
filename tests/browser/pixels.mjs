/** Verify actual displayed font pixels, including fractional DPI. Requires npm run demo. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { bigGlyph } from "../../game/src/render/bigfont.ts";

await mkdir("artifacts/pixels", { recursive: true });
const browser = await chromium.launch();
try {
  for (const [width, dpr] of [[1280, 1], [1280, 1.25], [1280, 1.5], [1280, 2], [960, 1], [360, 1], [360, 2], [360, 3]]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    await page.goto(process.env.DEMO_URL ?? "http://localhost:4174");
    await page.getByRole("status").filter({ hasText: "Main menu:" }).waitFor();
    await page.getByRole("toolbar", { name: "Game settings" }).getByRole("button", { name: "PvP Battle", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("status").filter({ hasText: "Base loaded" }).waitFor();
    const canvas = page.locator(".rf-game canvas");
    await canvas.focus();
    await page.waitForTimeout(100);
    // The inspector must use the actual campaign glyphs, with no resampling or substitute font.
    const expected = [..."READING / PLAIN"].map(bigGlyph);
    const matches = await canvas.evaluate((c, expected) => {
      const data = c.getContext("2d").getImageData(506, 152, 90, 7).data;
      return expected.every((rows, i) => rows.every((row, y) => Array.from({ length: 5 }, (_, x) => {
        const off = (y * 90 + i * 6 + x) * 4;
        return Boolean(row & 1 << x) === (data[off] === 97 && data[off + 1] === 123 && data[off + 2] === 82);
      }).every(Boolean)));
    }, expected);
    assert(matches, "Versus body text must match the campaign 5x7 font exactly");
    const bounds = await canvas.boundingBox(), pixelSize = bounds.width * dpr / 640;
    if (pixelSize < .999) {
      await page.getByLabel("Battle command deck").getByRole("button", { name: "Raid", exact: true }).waitFor();
      await page.screenshot({ path: `artifacts/pixels/${width}-${dpr}.png`, scale: "device" });
      await page.close(); console.log(`PASS campaign font / compact overview and touch controls: ${width}px / DPR ${dpr}`); continue;
    }
    assert(Math.abs(pixelSize - Math.round(pixelSize)) < .001, "Font pixels must occupy whole device pixels");
    assert(Math.abs(bounds.height * dpr / 480 - pixelSize) < .001, "Font pixels must be square");
    const screenshot = await page.screenshot({ path: `artifacts/pixels/${width}-${dpr}.png`, scale: "device" });
    const result = await page.evaluate(async ({ png, bounds, dpr, pixelSize }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
      const ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      const color = (x, y) => pixels.subarray((y * c.width + x) * 4, (y * c.width + x) * 4 + 3).join(",");
      let uneven = 0, ink = 0;
      // The same six-line Friend statistics panel shown in the reported font defect.
      for (let y = 120; y < 270; y++) for (let x = 502; x < 624; x++) {
        const left = Math.round(bounds.x * dpr + x * pixelSize), top = Math.round(bounds.y * dpr + y * pixelSize);
        const expected = color(left, top);
        if (expected === "24,44,36") ink++;
        for (let dy = 0; dy < pixelSize; dy++) for (let dx = 0; dx < pixelSize; dx++) {
          if (color(left + dx, top + dy) !== expected) uneven++;
        }
      }
      return { uneven, ink };
    }, { png: screenshot.toString("base64"), bounds, dpr, pixelSize: Math.round(pixelSize) });
    assert(result.ink > 100, "The measured panel must contain rendered text");
    assert.equal(result.uneven, 0, `${width}px / DPR ${dpr}: every font pixel must be a solid, equally sized square`);
    await page.close();
    console.log(`PASS font pixel grid: ${width}px / DPR ${dpr} / ${Math.round(pixelSize)}px strokes`);
  }
} finally { await browser.close(); }
