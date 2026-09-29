/** Art review: screenshots of a raid mid-battle with motion effects on. Run: node tests/browser/fx-shots.mjs */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
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
  await tap(299, 5); // FX ON
  await tap(132, 190);
  for (const [i, x, y] of [[0, 6, 2], [5, 7, 4], [12, 8, 6], [3, 7, 1]]) { await tap(5 + i * 17 + 8, 160); await tap(4 + x * 16 + 8, 14 + y * 16 + 8); }
  await tap(33, 190); await tap(260, 174); await tap(257, 135); // raid Hard
  for (const ms of [900, 700, 700, 700]) { await page.waitForTimeout(ms); await page.locator(".rf-game-frame").screenshot({ path: `./artifacts/fx/raid-${Date.now() % 100000}.png` }); }
} });
console.log("done");
