/**
 * Game-specific browser check on the SDK's mocked runtime: one full day loop (build → raid → night → day 2),
 * then territory expansion and the round screen, by pointer plus a keyboard pass. Screenshots go to artifacts/.
 * Run: node tests/browser/playthrough.mjs [width]
 */
import assert from "node:assert/strict";
import { control } from "./canvas-control.mjs";
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

const width = Number(process.argv[2] ?? 960);
const out = `./artifacts/${width}`;
await mkdir(out, { recursive: true });

await testGame("./game", {
  width,
  screenshot: `${out}/final.png`,
  timeout: 30_000,
  check: async ({ page, game }) => {
    const canvas = game.locator("canvas");
    await canvas.waitFor();
    let scale = 1;
    const click = id => control(canvas, id);
    const status = game.locator("[role=status]");
    const shot = async name => { await page.waitForTimeout(150); await page.locator(".rf-game-frame").screenshot({ path: `${out}/${name}.png` });
      const before = await canvas.evaluate(c => JSON.parse(c.dataset.controls).map(w => w.id));
      await control(canvas, "main-menu"); await control(canvas, "battle-mode"); await page.waitForTimeout(40);
      assert.deepEqual(await canvas.evaluate(c => JSON.parse(c.dataset.controls).map(w => w.id)), before, name + ": main menu preserves this battle screen"); };
    const tap = async (x, y) => canvas.click({ position: { x: (x + 0.5) * scale, y: (y + 0.5) * scale } });
    const until = async (text, ms = 20_000) => status.filter({ hasText: text }).waitFor({ timeout: ms });

    // The HD renderer keeps native pixels in the exact four-color palette at every responsive size.
    const pixelCheck = async label => {
      const colors = await canvas.evaluate(c => {
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, result = new Set();
        for (let i = 0; i < px.length; i += 4) result.add([px[i], px[i + 1], px[i + 2]].join(','));
        return [...result].sort();
      });
      assert.deepEqual(colors, ['24,44,36', '219,231,173', '166,186,118', '97,123,82'].sort(), label + ': exact four-color native rendering');
      assert.deepEqual(await canvas.evaluate(c => [c.width, c.height]), [640, 480]);
    };

    await until("Main menu:");
    await game.getByRole("toolbar", { name: "Game settings" }).getByRole("button", { name: "PvP Battle", exact: true }).focus();
    await page.keyboard.press("Enter");
    await until("Base loaded");
    scale = (await canvas.boundingBox()).width / 320;

    await canvas.focus();
    await shot("01-help");
    await pixelCheck("help");

    // Recruit three Friends from the pool strip and place them on the home board.
    const place = async (index, tx, ty) => { await tap(6 + index * 20 + 8, 185); await tap(4 + tx * 20 + 10, 12 + ty * 20 + 10); };
    await place(0, 6, 2); await until("Placed");
    await place(5, 7, 4);
    await place(11, 8, 6);
    await shot("02-build");
    await pixelCheck("build");
    await click("raid"); // RAID
    await shot("03-scout");
    await click("rival-0"); // SCOUT & PICK (Easy)
    await shot("04-setup");
    await click("launch"); // LAUNCH
    await until("RAID · EASY");
    await page.waitForTimeout(2500);
    await shot("05-raid");
    await pixelCheck("raid playback");
    // The result control moves as campaign routes gain additional regions.
    await click("results");
    await page.waitForTimeout(200);
    await until(/Raid (won|failed|partly)/);
    await shot("06-raid-result");
    // Practice rematch against the snapshot, fighting the second region first.
    await click("practice"); // PRACTICE
    await click("view-next"); // view the next region on the route
    await click("route-first"); // FIGHT FIRST
    await until("Route:");
    await shot("06b-practice-setup");
    await click("launch"); // PRACTICE ►
    await until("PRACTICE ·");
    await click("results");
    await page.waitForTimeout(200);
    await until(/Practice: (cleared|held)/);
    await shot("06c-practice-result");
    await click("continue"); // DONE ► back to build
    await shot("06d-build-after");
    await click("end-day"); // DEFEND ► (end the day)
    await shot("07-incoming");
    await click("defend"); // DEFEND
    await until("DEFENSE ·");
    await page.waitForTimeout(2500);
    await shot("08-defense");
    // The defense may span several regions; finish through its visible result control.
    await click("results");
    await page.waitForTimeout(200);
    await until(/(Territory held|Territory lost|Core lost)/);
    await shot("09-defense-result");
    // Continue through any outpost battles until the morning report.
    for (let i = 0; i < 4; i++) {
      await click("continue");
      await page.waitForTimeout(300);
      const text = await status.textContent();
      if (/^Day 2\./.test(text)) break;
      if (/OUTPOST/.test(text)) { await click("results"); await until(/Outpost (held|lost)/); }
    }
    await until(/^Day 2\./);
    await shot("10-morning");
    await click("start"); // START DAY 2
    await shot("11-day2");
    // Territory: expand east, then build there.
    await canvas.focus();
    await page.keyboard.press("t");
    await shot("12-territory");
    await click("cell-1,0"); // EAST cell (expand option)
    await click("expand"); // EXPAND · 250 RF
    await until("Expanded to EAST");
    await shot("13-expanded");
    await click("build-here"); // BUILD HERE
    await place(3, 6, 3);
    await until("Placed");
    await shot("14-build-east");
    await pixelCheck("east region");
    await page.keyboard.press("o");
    await shot("15-round");
    await page.keyboard.press("Escape");
    // Keyboard: help opens with H and closes with Escape; Tab reaches a control.
    await page.keyboard.press("h");
    await shot("16-help-keyboard");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await shot("17-keyboard-focus");
    // Settings mirrors are real buttons for assistive tech.
    await game.getByRole("button", { name: /^Sound (off|on)$/ }).focus();
    await page.keyboard.press("Enter");
    await game.getByRole("button", { name: "Sound on" }).waitFor();
    await game.getByRole("button", { name: "Reduce motion" }).focus();
    await page.keyboard.press("Enter");
  },
});
console.log(`PASS playthrough at ${width}px; screenshots in ${out}`);
