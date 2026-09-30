/** Main-menu routes use real visible controls and retain each mode's session. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { control } from './canvas-control.mjs';
await mkdir('artifacts/navigation', { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [1280, 360]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.DEMO_URL ?? 'http://localhost:4174');
    const canvas = page.locator('.rf-game canvas');
    const status = page.getByRole('status');
    const wait = text => status.filter({ hasText: text }).waitFor();
    const click = id => control(canvas, id);
    const ids = () => canvas.evaluate(c => JSON.parse(c.dataset.controls).map(w => w.id));
    const shot = name => page.screenshot({ path: `artifacts/navigation/${width}-${name}.png`, fullPage: true });
    await wait('Main menu:');
    await page.waitForTimeout(50);
    assert.deepEqual(await ids(), ['battle-mode', 'campaign-mode', 'main-guide']);
    await shot('menu');
    if (width < 600) await page.getByLabel('Touch command deck').getByRole('button', { name: 'Guide', exact: true }).click();
    else await click('main-guide');
    await wait('Guide.'); await shot('guide');
    await click('guide'); await click('back'); await click('main-menu');
    await click('campaign-mode'); await click('begin');
    await canvas.focus(); await page.keyboard.press('g'); await wait('guard');
    await click('main-menu'); await click('main-guide'); await click('guide'); await click('main-menu');
    await click('campaign-mode');
    await page.waitForTimeout(30);
    assert((await ids()).includes('end'), 'Campaign resumes its battlefield after guide detour');
    await canvas.focus(); await page.keyboard.press('1'); await wait('Action spent.');
    await page.keyboard.press('e'); await page.keyboard.press('e'); await wait('Enemy turn.');
    await click('main-menu'); await page.waitForTimeout(900);
    assert.deepEqual(await ids(), ['battle-mode', 'campaign-mode', 'main-guide'], 'Enemy turn cannot navigate away from main menu');
    await click('battle-mode'); await wait('Base loaded'); await page.waitForTimeout(30);
    assert((await ids()).includes('raid'), 'PvP Battle opens the builder directly');
    assert(!(await ids()).includes('close'), 'No duplicate title or introduction');
    await shot('battle');
    const tap = async (x, y) => { const box = await canvas.boundingBox(); await canvas.click({ position: { x: x * box.width / 320, y: y * box.height / 240 } }); };
    await tap(14, 185); await tap(134, 62); await wait('Placed');
    const roundtrip = async (expected, label) => {
      await page.waitForTimeout(40); const before = await ids(); assert(before.includes(expected), label + ' is open');
      await click('main-menu'); await wait('Main menu:');
      await click('battle-mode'); await page.waitForTimeout(30);
      assert((await ids()).includes(expected), label + ' resumes');
    };
    await roundtrip('raid', 'Builder');
    await click('help'); await roundtrip('next', 'Battle guide'); await click('close');
    await canvas.focus(); await page.keyboard.press('t'); await roundtrip('help', 'Territory map');
    await canvas.focus(); await page.keyboard.press('Escape'); await page.keyboard.press('o');
    await roundtrip('main-menu', 'Standings'); await canvas.focus(); await page.keyboard.press('Escape');
    await click('raid'); await roundtrip('rival-0', 'Scout'); await click('rival-0'); await roundtrip('launch', 'Raid setup');
    await click('main-menu'); await click('campaign-mode'); await page.waitForTimeout(900);
    await canvas.focus(); await page.keyboard.press('1'); await wait('Ready.');
    await shot('campaign');
    await click('main-menu'); await click('battle-mode'); await page.waitForTimeout(30);
    assert((await ids()).includes('launch'), 'Switching modes preserves raid setup');
    await canvas.focus(); await page.keyboard.press('Home'); await wait('Main menu:');
    assert.deepEqual(errors, []);
    console.log(`Navigation ${width}px: three root routes, guide returns, mode persistence, pending turn and Home key passed.`);
    await page.close();
  }
} finally { await browser.close(); }

