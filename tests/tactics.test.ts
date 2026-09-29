import assert from "node:assert/strict";
import { test } from "node:test";
import { act, canAct, copyBattle, createBattle, endTurn, forecast, living, MISSIONS, move, reachable, SIGNAL, turnsUsed } from "../game/src/tactics.ts";
import { solveMission } from "../scripts/tactics-solver.ts";

test("movement respects water, occupancy, forests and one move per turn", () => {
  const s = createBattle(), pip = s.units[0];
  assert.equal(reachable(s, pip).has("6,3"), false);
  assert.equal(move(s, pip.id, { x: 2, y: 4 }), false);
  assert.equal(move(s, pip.id, { x: 4, y: 3 }), true);
  assert.equal(move(s, pip.id, { x: 4, y: 4 }), false);
  assert.equal(act(s, pip.id, "guard"), true);
  assert.equal(act(s, pip.id, "guard"), false);
});
test("shove into water removes the enemy and cancels its telegraphed strike", () => {
  const s = createBattle(), e = s.units[3];
  s.intents = [{ id: e.id, target: { x: 3, y: 3 }, damage: 3 }];
  assert.equal(move(s, "pip", { x: 4, y: 3 }), true);
  assert.equal(forecast(s, s.units[0], "skill", e), "SHOVE > WATER: KO");
  assert.equal(act(s, "pip", "skill", e.id), true);
  assert.equal(e.hp, 0); endTurn(s); assert.equal(s.units[0].hp, 9);
});
test("locked attacks miss after movement and hit an enemy shoved into their square", () => {
  const s = createBattle(), e = s.units[3], other = s.units[4];
  s.intents = [{ id: e.id, target: { x: 3, y: 3 }, damage: 3 }];
  move(s, "pip", { x: 4, y: 3 }); endTurn(s); assert.equal(s.units[0].hp, 9);
  const b = createBattle(); b.units[3].x = 4; b.units[3].y = 3;
  b.intents = [{ id: other.id, target: { x: 5, y: 3 }, damage: 3 }];
  act(b, "pip", "skill", e.id); assert.equal(b.units[3].x, 5);
  endTurn(b); assert.equal(b.units[3].hp, 0);
});
test("pierce trades movement for damage; heal and guard consume an action", () => {
  const s = createBattle(), ranger = s.units[1], enemy = s.units[3];
  enemy.x = 4; enemy.y = 4;
  assert.equal(canAct(s, ranger, "skill", enemy), true);
  move(s, ranger.id, { x: 3, y: 4 }); assert.equal(canAct(s, ranger, "skill", enemy), false);
  s.units[0].hp = 5; assert.equal(act(s, "moss", "skill", "pip"), true); assert.equal(s.units[0].hp, 8);
  assert.equal(act(s, "moss", "guard"), false);
});
test("turn checkpoints are independent and restore all resources without rolling randomness", () => {
  const s = createBattle(), checkpoint = copyBattle(s); act(s, "pip", "guard"); endTurn(s);
  assert.equal(checkpoint.turn, 1); assert.equal(checkpoint.units[0].guard, false);
  const a = copyBattle(checkpoint), b = copyBattle(checkpoint); endTurn(a); endTurn(b); assert.deepEqual(a, b);
});
test("signal capture requires consecutive nights and loss takes priority", () => {
  const s = createBattle(1); s.units[0].x = SIGNAL.x; s.units[0].y = SIGNAL.y; s.units = s.units.filter(u => u.team === "ally"); s.intents = [];
  endTurn(s); assert.equal(s.signal, 1); assert.equal(s.result, "playing");
  s.units[0].x--; endTurn(s); assert.equal(s.signal, 0);
  s.units[0].x++; s.signal = 1; s.lantern = 0; endTurn(s); assert.equal(s.result, "lost");
});
test("all four authored missions have complete legal winning playthroughs", () => {
  for (let i = 0; i < MISSIONS.length; i++) { const result = solveMission(i); assert.equal(result.result, "won", `mission ${i + 1}: ${JSON.stringify(result)}`); assert.equal(result.lost, 0); assert.deepEqual(result.medals, [true, true, true], `all medals attainable for mission ${i + 1}`); }
});

test("lantern watch cannot be won by passing or guarding every turn", () => {
  for (const guard of [false, true]) {
    const s = createBattle(2);
    for (let i = 0; i < 6 && s.result === "playing"; i++) {
      if (guard) for (const u of living(s, "ally")) act(s, u.id, "guard");
      endTurn(s);
    }
    assert.equal(s.result, "lost", `passive guard=${guard} must fail`);
    assert.equal(s.lantern, 0);
  }
});

test("a final blow after a previous signal capture counts the current player turn", () => {
  const s = createBattle(3), chief = s.units.find(u => u.role === "chief")!;
  s.signal = 1; s.turn = 4; chief.x = 4; chief.y = 3; chief.hp = 1;
  assert.equal(act(s, "pip", "attack", chief.id), true); assert.equal(s.result, "won"); assert.equal(turnsUsed(s), 4);
});
