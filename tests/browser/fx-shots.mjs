/** Art review: screenshots of a raid mid-battle with motion effects on. Run: node tests/browser/fx-shots.mjs */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { control } from "./canvas-control.mjs";
await mkdir("./artifacts/fx", { recursive: true });
await testGame("./game", { timeout: 30_000, check: async ({ page, game }) => {
  const canvas = game.locator("canvas");
  await canvas.waitFor();
  let scale = 1;
  const tap = (x, y) => canvas.click({ position: { x: (x + 0.5) * scale, y: (y + 0.5) * scale } });
  const status = game.locator("[role=status]");
  await status.filter({ hasText: "The Lantern Road" }).waitFor();
  await game.getByRole("button", { name: "Territory mode (resets campaign)" }).focus();
  await page.keyboard.press("Enter");
  await status.filter({ hasText: "Base loaded" }).waitFor();
  scale = (await canvas.boundingBox()).width / 320;
  await canvas.focus();
  await control(canvas, "close");
  await control(canvas, "motion"); // FX ON
  for (const [i, x, y] of [[0, 6, 2], [5, 7, 4], [11, 8, 6], [3, 7, 1]]) { await tap(6 + i * 20 + 8, 185); await tap(4 + x * 20 + 10, 12 + y * 20 + 10); }
  await control(canvas, "raid"); await control(canvas, "rival-2"); await control(canvas, "launch");
  for (const ms of [900, 700, 700, 700]) { await page.waitForTimeout(ms); await page.locator(".rf-game-frame").screenshot({ path: `./artifacts/fx/raid-${Date.now() % 100000}.png` }); }
} });
console.log("done");
