/** Render the terrain art sheet to artifacts/art-sheet.png. Run: node scripts/art-sheet.mjs */
import { build } from "esbuild";
import { chromium } from "playwright";
const out = await build({ entryPoints: ["scripts/art-sheet-entry.ts"], bundle: true, write: false, format: "iife", platform: "browser" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1640, height: 600 } });
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ content: out.outputFiles[0].text });
await page.waitForFunction(() => window.done);
await page.locator("canvas").screenshot({ path: "artifacts/art-sheet.png" });
await browser.close();
console.log("artifacts/art-sheet.png");
