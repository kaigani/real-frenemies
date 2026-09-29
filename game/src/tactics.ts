/** Small, deterministic tactics engine. No timers, wallet calls or rendering state. */
export type Point = { x: number; y: number };
export type Role = "warden" | "ranger" | "mender" | "raider" | "archer" | "sapper" | "chief";
export type Unit = Point & { id: string; role: Role; team: "ally" | "enemy"; hp: number; maxHp: number; moved: boolean; acted: boolean; guard: boolean };
export type Intent = { id: string; target: Point | null; damage: number };
export type Mission = { name: string; subtitle: string; brief: string[]; goal: "clear" | "signal" | "survive" | "chief"; par: number; map: string[]; enemies: [Role, number, number][]; waves: { turn: number; role: Role; x: number; y: number }[] };
export const ROLES: Record<Role, { name: string; move: number; range: number; damage: number; hp: number; skill: string }> = {
  warden: { name: "PIP / WARDEN", move: 3, range: 1, damage: 3, hp: 9, skill: "SHOVE" },
  ranger: { name: "ROOK / RANGER", move: 3, range: 3, damage: 2, hp: 6, skill: "PIERCE" },
  mender: { name: "MOSS / MENDER", move: 3, range: 1, damage: 2, hp: 7, skill: "MEND" },
  raider: { name: "BRAMBLE RAIDER", move: 2, range: 1, damage: 3, hp: 4, skill: "" },
  archer: { name: "THORN ARCHER", move: 1, range: 3, damage: 2, hp: 3, skill: "" },
  sapper: { name: "LANTERN SAPPER", move: 3, range: 2, damage: 4, hp: 5, skill: "" },
  chief: { name: "THE HOLLOW KING", move: 1, range: 2, damage: 4, hp: 12, skill: "" },
};
// . meadow, f forest (1 armor, costs 2 movement), ~ water, # cliff, = bridge, + healing shrine.
export const MISSIONS: readonly Mission[] = [
  { name: "THE FIRST SPARK", subtitle: "01 / MOSSBANK CROSSING", goal: "clear", par: 5,
    brief: ["The lantern road has gone dark.", "Three friends. One last light.", "Defeat the three bramble scouts.", "Keep your lantern standing."],
    map: ["ff....~...ff", "f.....~....f", "......=.....", "...f..~.f...", "......=.....", "...f..~.....", "......=..f..", "f.....~....f", "ff....~...ff"],
    enemies: [["raider", 5, 3], ["raider", 8, 5], ["archer", 9, 2]], waves: [] },
  { name: "A LIGHT BETWEEN", subtitle: "02 / THE SUNKEN GARDEN", goal: "signal", par: 8,
    brief: ["A signal sleeps across the water.", "Stand on its flag for two nights.", "Water stops feet, not a shove.", "Reinforcements arrive on turn 3."],
    map: ["fff..~~...ff", "f....~~.....", ".....==.....", "...f.~~.f...", ".....==.....", "..f..~~.....", ".....==..+..", "f....~~.....", "ff...~~...ff"],
    enemies: [["raider", 7, 4], ["archer", 9, 3], ["raider", 8, 6]], waves: [{ turn: 3, role: "raider", x: 10, y: 1 }] },
  { name: "KEEP THE FIRE", subtitle: "03 / LANTERN WATCH", goal: "survive", par: 6,
    brief: ["Sappers are coming for our light.", "Protect the lantern for 6 nights.", "Sappers ignore us. Stop them!", "The shrine heals 1 HP each night."],
    map: ["ff..#....#ff", "f...#.......", "....#..f....", "..f.........", "...+....f...", "..f.........", "....#..f....", "f...#.......", "ff..#....#ff"],
    enemies: [["sapper", 6, 4], ["archer", 7, 2]], waves: [{ turn: 2, role: "sapper", x: 9, y: 6 }, { turn: 3, role: "raider", x: 8, y: 1 }, { turn: 4, role: "sapper", x: 8, y: 4 }, { turn: 5, role: "archer", x: 8, y: 7 }] },
  { name: "FRIENDS AT DAWN", subtitle: "04 / THE HOLLOW CROWN", goal: "chief", par: 10,
    brief: ["Beyond the gate waits the king.", "Defeat him. Hold the signal once.", "His blows strike marked squares.", "Make his own army stand in them."],
    map: ["ff...~....ff", "f....~......", "..#..=..#...", ".....~......", "..+..=......", ".....~......", "..#..=..#...", "f....~......", "ff...~....ff"],
    enemies: [["chief", 9, 4], ["raider", 7, 2], ["archer", 8, 6]], waves: [{ turn: 3, role: "raider", x: 10, y: 1 }, { turn: 5, role: "archer", x: 10, y: 7 }] },
];
export type Battle = { mission: number; turn: number; finishedTurn: number | null; units: Unit[]; intents: Intent[]; lantern: number; signal: number; lost: number; result: "playing" | "won" | "lost"; log: string[] };
export const LANTERN = { x: 1, y: 4 }, SIGNAL = { x: 10, y: 4 };
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const terrain = (s: Battle, p: Point) => MISSIONS[s.mission].map[p.y]?.[p.x] ?? "#";
export const at = (s: Battle, p: Point) => s.units.find(u => u.hp > 0 && same(u, p));
export const living = (s: Battle, team?: Unit["team"]) => s.units.filter(u => u.hp > 0 && (!team || u.team === team));
export const copyBattle = (s: Battle): Battle => structuredClone(s);
function unit(id: string, role: Role, team: Unit["team"], x: number, y: number): Unit {
  return { id, role, team, x, y, hp: ROLES[role].hp, maxHp: ROLES[role].hp, moved: false, acted: false, guard: false };
}
export function createBattle(mission = 0): Battle {
  const s: Battle = { mission, turn: 1, finishedTurn: null, units: [unit("pip", "warden", "ally", 3, 3), unit("rook", "ranger", "ally", 2, 4), unit("moss", "mender", "ally", 3, 5), ...MISSIONS[mission].enemies.map(([r, x, y], i) => unit(`e${i}`, r, "enemy", x, y))], intents: [], lantern: 8, signal: 0, lost: 0, result: "playing", log: ["Your turn. Move, then act with each friend."] };
  plan(s); return s;
}
const neighbours = (p: Point): Point[] => [{ x: p.x - 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }, { x: p.x + 1, y: p.y }];
export function reachable(s: Battle, u: Unit, budget = ROLES[u.role].move): Map<string, number> {
  const costs = new Map<string, number>([[`${u.x},${u.y}`, 0]]), queue: Point[] = [{ x: u.x, y: u.y }];
  while (queue.length) {
    const p = queue.shift()!, cost = costs.get(`${p.x},${p.y}`)!;
    for (const n of neighbours(p)) {
      const t = terrain(s, n), occupied = at(s, n);
      if (t === "#" || t === "~" || same(n, LANTERN) || occupied && occupied.id !== u.id) continue;
      const next = cost + (t === "f" ? 2 : 1), key = `${n.x},${n.y}`;
      if (next <= budget && next < (costs.get(key) ?? Infinity)) { costs.set(key, next); queue.push(n); }
    }
  }
  return costs;
}
export function move(s: Battle, id: string, dest: Point): boolean {
  const u = atId(s, id);
  if (!u || u.team !== "ally" || u.moved || u.acted || s.result !== "playing" || same(u, dest) || !reachable(s, u).has(`${dest.x},${dest.y}`)) return false;
  u.x = dest.x; u.y = dest.y; u.moved = true; s.log = [`${ROLES[u.role].name.split(" / ")[0]} moved. Choose an action.`]; return true;
}
const atId = (s: Battle, id: string) => s.units.find(u => u.id === id && u.hp > 0);
export function clearShot(s: Battle, a: Point, b: Point): boolean {
  // Supercover line: cliffs block shots; water, trees and units do not.
  let x = a.x, y = a.y;
  const dx = b.x - a.x, dy = b.y - a.y, nx = Math.abs(dx), ny = Math.abs(dy);
  let ix = 0, iy = 0;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (terrain(s, { x: x + Math.sign(dx), y }) === "#" || terrain(s, { x, y: y + Math.sign(dy) }) === "#") return false;
      x += Math.sign(dx); y += Math.sign(dy); ix++; iy++;
    } else if (decision < 0) { x += Math.sign(dx); ix++; } else { y += Math.sign(dy); iy++; }
    if (terrain(s, { x, y }) === "#") return false;
  }
  return true;
}
export type Action = "attack" | "skill" | "guard";
export function damage(s: Battle, target: Unit, amount: number, piercing = false) {
  return Math.max(1, amount - (target.guard ? 2 : 0) - (!piercing && terrain(s, target) === "f" ? 1 : 0));
}
function hurt(s: Battle, target: Unit, amount: number) {
  const wasAlive = target.hp > 0; target.hp = Math.max(0, target.hp - amount);
  if (wasAlive && target.hp === 0 && target.team === "ally") s.lost++;
}
export function canAct(s: Battle, u: Unit, action: Action, target?: Unit): boolean {
  if (s.result !== "playing" || u.team !== "ally" || u.hp <= 0 || u.acted) return false;
  if (action === "guard") return true;
  if (!target || target.hp <= 0) return false;
  if (action === "skill" && u.role === "ranger" && u.moved) return false;
  if (action === "skill" && u.role === "mender") return target.team === "ally" && target.hp < target.maxHp && distance(u, target) <= 2 && clearShot(s, u, target);
  return target.team === "enemy" && distance(u, target) <= (action === "skill" && u.role === "warden" ? 1 : ROLES[u.role].range) && clearShot(s, u, target);
}
export function forecast(s: Battle, u: Unit, action: Action, target: Unit): string {
  if (action === "skill" && u.role === "ranger" && u.moved) return "PIERCE NEEDS NO MOVE";
  if (!canAct(s, u, action, target)) return "OUT OF RANGE";
  if (action === "skill" && u.role === "mender") return `HEAL +${Math.min(3, target.maxHp - target.hp)} HP`;
  if (action === "skill" && u.role === "warden") {
    const dest = { x: target.x + target.x - u.x, y: target.y + target.y - u.y };
    const collision = terrain(s, dest) === "#" || same(dest, LANTERN) || !!at(s, dest);
    return terrain(s, dest) === "~" ? "SHOVE > WATER: KO" : collision ? `COLLISION: ${damage(s, target, 1) + 2} DMG` : `SHOVE: ${damage(s, target, 1)} DMG + PUSH`;
  }
  const amount = damage(s, target, ROLES[u.role].damage + (action === "skill" ? 1 : 0), action === "skill");
  return `${amount} DMG${amount >= target.hp ? " / KO" : ` / ${target.hp - amount} HP LEFT`}`;
}
export function act(s: Battle, id: string, action: Action, targetId?: string): boolean {
  const u = atId(s, id), target = targetId ? atId(s, targetId) : undefined;
  if (!u || !canAct(s, u, action, target)) return false;
  if (action === "guard") { u.guard = true; s.log = ["Guard set. Incoming damage reduced by 2."]; }
  else if (target) {
    const info = forecast(s, u, action, target);
    if (action === "skill" && u.role === "mender") target.hp = Math.min(target.maxHp, target.hp + 3);
    else if (action === "skill" && u.role === "warden") {
      const dest = { x: target.x + target.x - u.x, y: target.y + target.y - u.y };
      hurt(s, target, damage(s, target, 1));
      if (terrain(s, dest) === "~") hurt(s, target, target.hp);
      else if (terrain(s, dest) === "#" || same(dest, LANTERN) || at(s, dest)) hurt(s, target, 2);
      else { target.x = dest.x; target.y = dest.y; }
    } else hurt(s, target, damage(s, target, ROLES[u.role].damage + (action === "skill" ? 1 : 0), action === "skill"));
    s.log = [info + ". No counterattack."];
  }
  u.acted = true; u.moved = true; checkResult(s); return true;
}
function plan(s: Battle) {
  s.intents = living(s, "enemy").map(e => {
    const targets: Point[] = e.role === "sapper" ? [LANTERN] : [...living(s, "ally").toSorted((a, b) => distance(e, a) - distance(e, b) || a.hp - b.hp), LANTERN];
    const target = targets.find(t => distance(e, t) <= ROLES[e.role].range && clearShot(s, e, t));
    return { id: e.id, target: target ? { x: target.x, y: target.y } : null, damage: ROLES[e.role].damage };
  });
}
export function objective(s: Battle): string {
  switch (MISSIONS[s.mission].goal) {
    case "clear": return `DEFEAT SCOUTS ${3 - living(s, "enemy").length}/3`;
    case "signal": return `HOLD SIGNAL ${s.signal}/2 NIGHTS`;
    case "survive": return `HOLD OUT ${Math.min(s.turn - 1, 6)}/6 NIGHTS`;
    case "chief": return living(s, "enemy").some(u => u.role === "chief") ? "DEFEAT THE HOLLOW KING" : `HOLD SIGNAL ${s.signal}/1 NIGHT`;
  }
}
function checkResult(s: Battle, afterNight = false) {
  if (s.lantern <= 0 || living(s, "ally").length === 0) { s.result = "lost"; s.finishedTurn = s.turn - (afterNight ? 1 : 0); return; }
  const goal = MISSIONS[s.mission].goal;
  if (goal === "clear" && living(s, "enemy").length === 0 || goal === "signal" && s.signal >= 2 || goal === "survive" && s.turn > 6 || goal === "chief" && !living(s, "enemy").some(u => u.role === "chief") && s.signal >= 1) s.result = "won";
  if (s.result === "won") s.finishedTurn = s.turn - (afterNight ? 1 : 0);
}
/** Reverse Dijkstra field lets enemies route around a screen of friends instead of sticking to a local minimum. */
function routeCosts(s: Battle, goal: Point, self: Unit): Map<string, number> {
  const costs = new Map<string, number>(), queue: Point[] = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 12; x++) {
    const p = { x, y }, t = terrain(s, p), occupied = at(s, p);
    if (t !== "#" && t !== "~" && !same(p, LANTERN) && (!occupied || occupied.id === self.id) && distance(p, goal) <= ROLES[self.role].range && clearShot(s, p, goal)) {
      costs.set(`${x},${y}`, 0); queue.push(p);
    }
  }
  while (queue.length) {
    queue.sort((a, b) => costs.get(`${a.x},${a.y}`)! - costs.get(`${b.x},${b.y}`)!);
    const p = queue.shift()!, cost = costs.get(`${p.x},${p.y}`)!;
    for (const n of neighbours(p)) {
      const t = terrain(s, n), occupied = at(s, n);
      if (t === "#" || t === "~" || occupied && occupied.id !== self.id && !same(n, goal) || same(n, LANTERN) && !same(n, goal)) continue;
      const next = cost + (terrain(s, p) === "f" ? 2 : 1), key = `${n.x},${n.y}`;
      if (next < (costs.get(key) ?? Infinity)) { costs.set(key, next); queue.push(n); }
    }
  }
  return costs;
}
export function endTurn(s: Battle): string[] {
  if (s.result !== "playing") return [];
  const events: string[] = [];
  // Intent coordinates never follow a moving target. Killing the attacker cancels its strike.
  for (const intent of s.intents) {
    const e = atId(s, intent.id);
    if (!e || !intent.target) continue;
    const target = at(s, intent.target);
    if (target) { const n = damage(s, target, intent.damage); hurt(s, target, n); events.push(`${ROLES[e.role].name} > ${ROLES[target.role].name.split(" / ")[0]}: -${n} HP${target.hp === 0 ? " / KO" : ""}.`); }
    else if (same(intent.target, LANTERN)) { s.lantern = Math.max(0, s.lantern - intent.damage); events.push(`Lantern hit for ${intent.damage}.`); }
    else events.push(`${ROLES[e.role].name}: missed at ${intent.target.x + 1},${intent.target.y + 1}.`);
  }
  s.signal = at(s, SIGNAL)?.team === "ally" ? s.signal + 1 : 0;
  s.turn++;
  checkResult(s, true);
  if (s.result === "playing") {
    for (const e of living(s, "enemy")) {
      const targets: Point[] = e.role === "sapper" ? [LANTERN] : [...living(s, "ally"), LANTERN];
      const target = targets.toSorted((a, b) => distance(e, a) - distance(e, b))[0];
      const routes = routeCosts(s, target, e);
      const spots = [...reachable(s, e).entries()].map(([k, cost]) => { const [x, y] = k.split(",").map(Number); return { x, y, cost }; });
      const next = spots.toSorted((a, b) => {
        const score = (p: Point) => distance(p, target) <= ROLES[e.role].range && clearShot(s, p, target) ? 0 : routes.get(`${p.x},${p.y}`) ?? 999;
        return score(a) - score(b) || a.cost - b.cost;
      })[0];
      if (next) { e.x = next.x; e.y = next.y; }
    }
    for (const [i, wave] of MISSIONS[s.mission].waves.entries()) if (wave.turn === s.turn) {
      const spawn = [wave, ...neighbours(wave)].find(p => !at(s, p) && !["#", "~"].includes(terrain(s, p)) && !same(p, LANTERN));
      if (spawn) { s.units.push(unit(`wave${i}`, wave.role, "enemy", spawn.x, spawn.y)); events.push("Enemy reinforcements arrived."); }
    }
    for (const u of living(s, "ally")) { u.moved = false; u.acted = false; u.guard = false; if (terrain(s, u) === "+") u.hp = Math.min(u.maxHp, u.hp + 1); }
    plan(s);
  }
  s.log = events.length ? events : ["The enemy advances. New intentions revealed."];
  return s.log;
}
export function turnsUsed(s: Battle): number { return s.finishedTurn ?? s.turn; }
export function medals(s: Battle): boolean[] { return [s.result === "won", s.result === "won" && s.lost === 0, s.result === "won" && turnsUsed(s) <= MISSIONS[s.mission].par]; }
