/** Deterministic beam-search playtest; emits legal input plans for the browser test. */
import { act, canAct, copyBattle, createBattle, distance, endTurn, living, medals, MISSIONS, move, reachable, same, SIGNAL, type Action, type Battle, type Point } from "../game/src/tactics.ts";
export type Command = { id: string; dest: Point; action: Action; target?: string };
function score(s: Battle): number {
  if (s.result === "won") return 10000 + s.lantern * 5 - s.lost * 100;
  if (s.result === "lost") return -10000;
  const allies = living(s, "ally"), enemies = living(s, "enemy"), goal = MISSIONS[s.mission].goal;
  let value = s.lantern * 9 - s.lost * 100 + allies.reduce((n, u) => n + u.hp * 3, 0) - enemies.reduce((n, u) => n + u.hp * 3 + 15, 0);
  if (goal === "signal" || goal === "chief") value += s.signal * 35 - Math.min(...allies.map(u => distance(u, SIGNAL))) * 4;
  else if (goal === "clear" && enemies.length) value -= allies.reduce((n, u) => n + Math.min(...enemies.map(e => distance(u, e))), 0) * 1.5;
  for (const i of s.intents) if (i.target && enemies.some(e => e.id === i.id)) {
    const u = allies.find(a => same(a, i.target!));
    if (u) value -= Math.max(1, i.damage - (u.guard ? 2 : 0)) * 4;
  }
  return value;
}
export function solveMission(mission: number) {
  let s = createBattle(mission);
  const turns: Command[][] = [];
  for (let turn = 0; turn < 20 && s.result === "playing"; turn++) {
    let beam: { state: Battle; commands: Command[]; score: number }[] = [{ state: copyBattle(s), commands: [], score: 0 }];
    for (const original of living(s, "ally")) {
      const next: typeof beam = [];
      for (const b of beam) {
        const u = living(b.state, "ally").find(a => a.id === original.id)!;
        if (b.state.result !== "playing") { next.push(b); continue; }
        for (const key of reachable(b.state, u).keys()) {
          const [x, y] = key.split(",").map(Number), dest = { x, y }, moved = copyBattle(b.state);
          if (!same(u, dest)) move(moved, u.id, dest);
          const mu = living(moved, "ally").find(a => a.id === u.id)!;
          for (const action of ["attack", "skill", "guard"] as Action[]) {
            const targets = action === "guard" ? [undefined] : living(moved).filter(t => canAct(moved, mu, action, t));
            for (const target of targets) {
              const result = copyBattle(moved);
              if (!act(result, u.id, action, target?.id)) continue;
              const cmd = { id: u.id, dest, action, target: target?.id };
              next.push({ state: result, commands: [...b.commands, cmd], score: score(result) });
            }
          }
        }
      }
      beam = next.toSorted((a, b) => b.score - a.score).slice(0, 12);
    }
    const outcomes = beam.map(b => { const after = copyBattle(b.state); endTurn(after); return { ...b, after, score: score(after) }; }).sort((a, b) => b.score - a.score);
    if (!outcomes[0]) throw new Error(`No legal plan for mission ${mission}`);
    turns.push(outcomes[0].commands); s = outcomes[0].after;
  }
  return { mission, turns, result: s.result, turn: s.turn, lost: s.lost, lantern: s.lantern, medals: medals(s) };
}
if (process.argv[1]?.endsWith("tactics-solver.ts")) {
  const results = MISSIONS.map((_, i) => solveMission(i));
  console.log(JSON.stringify(results, null, 2));
  if (results.some(r => r.result !== "won")) process.exitCode = 1;
}
