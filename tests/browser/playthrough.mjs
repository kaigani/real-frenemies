/**
 * Game-specific browser check on the SDK's mocked runtime: one full day loop (build → raid → night → day 2),
 * then territory expansion and the round screen, by pointer plus a keyboard pass. Screenshots go to artifacts/.
 * Run: node tests/browser/playthrough.mjs [width]
 */
import assert from "node:assert/strict";
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
    const status = game.locator("[role=status]");
    const shot = async name => { await page.waitForTimeout(150); await page.locator(".rf-game-frame").screenshot({ path: `${out}/${name}.png` }); };
    const tap = async (x, y) => canvas.click({ position: { x: (x + 0.5) * scale, y: (y + 0.5) * scale } });
    const until = async (text, ms = 20_000) => status.filter({ hasText: text }).waitFor({ timeout: ms });

    // Pixel acceptance test from the brief: every native pixel renders as one solid scale × scale block.
    const pixelCheck = async label => {
      // The runtime's own toolbar overlays the frame's bottom edge; hide it so only game pixels are measured.
      const hide = await page.addStyleTag({ content: ".rf-frame-toolbar{visibility:hidden!important}" });
      const png = (await canvas.screenshot()).toString("base64");
      await hide.evaluate(node => node.remove());
      const bad = await page.evaluate(async ([data, s]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const { data: px, width, height } = g.getImageData(0, 0, img.width, img.height);
        let mismatches = 0;
        for (let by = 0; by + s <= height; by += s) for (let bx = 0; bx + s <= width; bx += s) {
          const o = (by * width + bx) * 4;
          for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            const p = ((by + y) * width + bx + x) * 4;
            if (px[p] !== px[o] || px[p + 1] !== px[o + 1] || px[p + 2] !== px[o + 2]) { mismatches++; y = s; break; }
          }
        }
        return mismatches;
      }, [png, scale]);
      assert.equal(bad, 0, `${label}: ${bad} blocks are not solid ${scale}×${scale}`);
    };

    await until("The Lantern Road");
    await game.getByRole("button", { name: "Territory mode (resets campaign)" }).focus();
    await page.keyboard.press("Enter");
    await until("Base loaded");
    scale = (await canvas.boundingBox()).width / 319;
    assert.equal(scale, Math.floor(scale), `territory canvas scale ${scale} must be a whole number`);
    await canvas.focus();
    await shot("01-help");
    await pixelCheck("help");
    await tap(132, 190); // START BUILDING
    // Recruit three Friends from the pool strip and place them on the home board.
    const place = async (index, tx, ty) => { await tap(5 + (index % 18) * 17 + 8, 152 + Math.floor(index / 18) * 17 + 8); await tap(4 + tx * 16 + 8, 14 + ty * 16 + 8); };
    await place(0, 6, 2); await until("Placed");
    await place(5, 7, 4);
    await place(12, 8, 6);
    await shot("02-build");
    await pixelCheck("build");
    await tap(33, 190); // RAID
    await shot("03-scout");
    await tap(55, 174); // SCOUT & PICK (Easy)
    await shot("04-setup");
    await tap(257, 135); // LAUNCH
    await until("RAID · EASY");
    await page.waitForTimeout(2500);
    await shot("05-raid");
    await pixelCheck("raid playback");
    // SKIP sits at 184 while a NEXT button exists (more regions to fight), else at 136. Press both spots.
    await tap(213, 190);
    await page.waitForTimeout(200);
    if (!(await status.textContent()).match(/Raid (won|failed|partly)/)) await tap(165, 190);
    await until(/Raid (won|failed|partly)/);
    await shot("06-raid-result");
    // Practice rematch against the snapshot, fighting the second region first.
    await tap(165, 190); // PRACTICE
    await tap(208, 190); // view the next region on the route
    await tap(245, 190); // FIGHT FIRST
    await until("Route:");
    await shot("06b-practice-setup");
    await tap(257, 135); // PRACTICE ►
    await until("PRACTICE ·");
    await tap(213, 190);
    await page.waitForTimeout(200);
    if (!(await status.textContent()).match(/Practice: (cleared|held)/)) await tap(165, 190);
    await until(/Practice: (cleared|held)/);
    await shot("06c-practice-result");
    await tap(91, 190); // DONE ► back to build
    await shot("06d-build-after");
    await tap(95, 190); // DEFEND ► (end the day)
    await shot("07-incoming");
    await tap(257, 135); // DEFEND
    await until("DEFENSE ·");
    await page.waitForTimeout(2500);
    await shot("08-defense");
    // The defense may span several regions: SKIP sits at 184 when a NEXT button exists, else 136. Press both spots.
    await tap(213, 190);
    await page.waitForTimeout(200);
    if (!(await status.textContent()).match(/Territory (held|lost)|Core lost/)) await tap(165, 190);
    await until(/(Territory held|Territory lost|Core lost)/);
    await shot("09-defense-result");
    // Continue through any outpost battles until the morning report.
    for (let i = 0; i < 4; i++) {
      await tap(91, 190);
      await page.waitForTimeout(300);
      const text = await status.textContent();
      if (/^Day 2\./.test(text)) break;
      if (/OUTPOST/.test(text)) { await tap(213, 190); await tap(165, 190); await until(/Outpost (held|lost)/); }
    }
    await until(/^Day 2\./);
    await shot("10-morning");
    await tap(43, 190); // START DAY 2
    await shot("11-day2");
    // Territory: expand east, then build there.
    await canvas.focus();
    await page.keyboard.press("t");
    await shot("12-territory");
    await tap(162, 78); // EAST cell (expand option)
    await tap(257, 135); // EXPAND · 250 RF
    await until("Expanded to EAST");
    await shot("13-expanded");
    await tap(257, 135); // BUILD HERE
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
