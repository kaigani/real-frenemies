/** Play every campaign mission using only public canvas input. Requires npm run demo. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { solveMission } from "../../scripts/tactics-solver.ts";
import { act, createBattle, endTurn, move, same } from "../../game/src/tactics.ts";

const width = Number(process.argv[2] ?? 1280), out = `artifacts/tactics-${width}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1100 }, reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:4174");
  const status = page.getByRole("status"), canvas = page.locator(".rf-game canvas");
  const touch = page.getByLabel("Touch command deck"), mobile = width < 600;
  const input = async (key, label) => mobile ? touch.getByRole("button", { name: label, exact: true }).click() : page.keyboard.press(key);
  await status.filter({ hasText: "The Lantern Road" }).waitFor();
  const shot = async name => { await page.waitForTimeout(40); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
  const tap = async (x, y) => { const box = await canvas.boundingBox(); await canvas.click({ position: { x: x * box.width / 319, y: y * box.height / 212 } }); await page.waitForTimeout(20); };
  const tile = async p => tap(8 + p.x * 16 + 8, 33 + p.y * 16 + 8);
  await shot("01-title");
  const palette = await canvas.evaluate(c => { const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const colors = new Set(); for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i+1]},${data[i+2]}`); return [...colors]; });
  assert.equal(palette.length, 4, "exactly four native LCD colors");
  await canvas.focus(); await input("Enter", "Start adventure"); await page.waitForTimeout(30);
  for (let mission = 0; mission < 4; mission++) {
    await shot(`chapter-${mission + 1}-brief`); if (mobile) await input("Enter", "Continue"); else await tap(100, 187);
    let model = createBattle(mission);
    if (mission === 0) {
      if (mobile) {
        await input("1", "Pip"); await input("ArrowRight", "Cursor right"); await input("Enter", "Select or confirm target");
        const bounds = await touch.boundingBox(), gameBounds = await page.locator(".rf-game").boundingBox();
        assert.ok(bounds.y + bounds.height <= gameBounds.y + gameBounds.height, "touch controls fit inside game");
        assert.ok((await touch.getByRole("button", { name: "Attack", exact: true }).boundingBox()).height >= 44);
      } else await tile({ x: 4, y: 3 });
      await input("u", "Undo"); await status.filter({ hasText: "Turn reset" }).waitFor();
      await input("h", "Help"); await shot("02-guide"); await input("Escape", "Back to the road");
      await input("e", "End turn"); await status.filter({ hasText: "still have actions" }).waitFor(); await input("Escape", "Cancel");
    }
    const solution = solveMission(mission);
    for (let turn = 0; turn < solution.turns.length; turn++) {
      for (const cmd of solution.turns[turn]) {
        const u = model.units.find(u => u.id === cmd.id);
        // Pointer selection and movement; keyboard actions. Every attack requires an explicit second confirmation.
        await tile(u);
        if (!same(u, cmd.dest)) { await tile(cmd.dest); assert.ok(move(model, u.id, cmd.dest)); }
        await input(cmd.action === "attack" ? "a" : cmd.action === "skill" ? "s" : "g", cmd.action === "attack" ? "Attack" : cmd.action === "skill" ? "Skill" : "Guard");
        if (cmd.target) {
          const target = model.units.find(u => u.id === cmd.target); await tile(target);
          await status.filter({ hasText: "again to confirm" }).waitFor(); await tile(target);
        }
        assert.ok(act(model, u.id, cmd.action, cmd.target));
        if (model.result === "won") break;
      }
      if (model.result !== "won") {
        if (mobile) await input("e", "End turn"); else await tap(260, 156); endTurn(model);
        await page.waitForTimeout(330);
      }
      if (turn === 0) await shot(`chapter-${mission + 1}-battle`);
      if (turn === 0 && mission === 2) { await input("l", "Log"); await status.filter({ hasText: "Last enemy turn" }).waitFor(); await shot("turn-report"); await input("Escape", "Back to the road"); }
    }
    await status.filter({ hasText: "Mission complete" }).waitFor();
    await shot(`chapter-${mission + 1}-victory`);
    if (mobile) await input("Enter", "Continue"); else await tap(90, 187);
  }
  await shot("ending");
  if (mobile) await input("Enter", "Continue"); else await tap(159, 186);
  await shot("chapters");
  await status.filter({ hasText: "4 chapters unlocked" }).waitFor();
  assert.equal(await page.locator("body").evaluate(el => el.scrollWidth > innerWidth), false, "no horizontal page overflow");
  assert.deepEqual(errors, []);
  console.log(`PASS: all 4 campaign chapters, forecasts, undo, help, end-turn confirmation, 4-color palette; ${width}px. Screenshots: ${out}`);
} finally { await browser.close(); }
