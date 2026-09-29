/** 640 x 480 presentation: generated pixel atlases, detailed 40px terrain and illustrated dialogue. */
import { Atlas, CHARACTER_CELL, SCENERY } from "./render/atlas.ts";
import { Painter, type Color } from "./render/draw.ts";
import { POOL, spriteBits, type Character, type Friend } from "./friends.ts";
import type { Ui } from "./ui.ts";
import { at, canAct, living, medals, MISSIONS, objective, reachable, ROLES, same, SIGNAL, LANTERN, terrain, turnsUsed, type Action, type Battle, type Point, type Role, type Unit } from "./tactics.ts";

export const TACTICS_W = 640, TACTICS_H = 480;
export const MAP_X = 8, MAP_Y = 24, MAP_TILE = 40;
export type ViewPage = "title" | "brief" | "battle" | "result" | "help" | "ending" | "chapters" | "log" | "loading" | "error";
export type TacticsPresentation = {
  page: ViewPage; s: Battle; selected?: Unit; cursor: Point; action: Action | "move"; tick: number;
  reducedMotion: boolean; pendingTurn: boolean; pendingTarget: string | null; confirmEnd: boolean; confirmRetry: boolean;
  flash: string; flashUntil: number; effects: { x: number; y: number; text: string; until: number }[];
  scores: boolean[][]; report: string[]; chapterPick: number; unlocked: number; muted: boolean; commander: Friend; description: string;
};
type Commands = { command(id: string, value?: number): void; tile(point: Point): void };
const NAMES: Record<Role, string> = { warden: "PIP", ranger: "ROOK", mender: "MOSS", raider: "BRAMBLE", archer: "THORN", sapper: "CINDER", chief: "HOLLOW KING" };
const FIELD_CHARACTERS: Record<Role, Character> = { warden: "Skeleton", ranger: "Asymmetry", mender: "Cellular", raider: "Mask", archer: "Sparkling", sapper: "Skeleton", chief: "Hollow" };
const QUOTES: Record<Role, string> = { warden: "Ready when you are! Let's bring the light home.", ranger: "Leave me a clear shot. I'll watch the far bank.", mender: "Stay close, friends. Nobody walks this road alone.", raider: "This crossing belongs to the brambles.", archer: "One more step. That's all I need.", sapper: "Such a pretty little light. Shame if it went out.", chief: "Every road ends in shadow. Even yours." };
const BRIEFS: { role: Role; line: string }[] = [
  { role: "warden", line: "The scouts have taken Mossbank. We'll cross together. Ready when you are!" },
  { role: "ranger", line: "See the signal beyond the river? Give me a path, and I'll light the way." },
  { role: "mender", line: "They're coming for our lantern. Stop the sappers. I'll keep everyone standing." },
  { role: "chief", line: "Little sparks, far from home. Come then. Show me what your friendship is worth." },
];

export class TacticsView {
  readonly art = new Atlas();
  private p: Painter; private ui: Ui; private commands: Commands;
  private tick = 0; private reducedMotion = false;
  constructor(p: Painter, ui: Ui, commands: Commands) { this.p = p; this.ui = ui; this.commands = commands; }
  private words(text: string, width: number, scale = 1): string[] {
    const limit = Math.floor(width / (6 * scale)), lines: string[] = []; let line = "";
    for (const word of text.toUpperCase().split(/\s+/)) { if ((line + " " + word).trim().length > limit && line) { lines.push(line); line = word; } else line = (line + " " + word).trim(); }
    if (line) lines.push(line); return lines;
  }
  private text(text: string, x: number, y: number, color: Color = "black", scale = 1) {
    const c = this.p.ctx; c.save(); c.translate(Math.round(x), Math.round(y)); c.scale(scale, scale); this.p.big(text.toUpperCase(), 0, 0, color); c.restore();
  }
  private center(text: string, x: number, y: number, color: Color = "black", scale = 1) { this.text(text, x - Math.floor((text.length * 6 - 1) * scale / 2), y, color, scale); }
  private lines(text: string, x: number, y: number, width: number, scale = 1, color: Color = "black", limit = 99) { this.words(text, width, scale).slice(0, limit).forEach((line, i) => this.text(line, x, y + i * (10 * scale), color, scale)); }
  private box(x: number, y: number, w: number, h: number, fill: Color = "white") {
    const p = this.p; p.rect(x + 2, y + 3, w, h, "black"); p.rect(x, y, w, h, fill); p.notch(x, y, w, h, "black"); p.notch(x + 3, y + 3, w - 6, h - 6, "black");
    for (const [dx, dy] of [[0, 0], [w - 5, 0], [0, h - 5], [w - 5, h - 5]]) { p.rect(x + dx, y + dy, 5, 5, "black"); p.px(x + dx + 2, y + dy + 2, "white"); }
  }
  private button(id: string, label: string, x: number, y: number, w: number, h = 26, active = false, disabled = false, value?: number) {
    const focus = this.ui.focused(id), p = this.p, dark = active || focus;
    p.rect(x + 2, y + 2, w, h, "black"); p.rect(x, y, w, h, dark ? "black" : "white"); p.frame(x, y, w, h, "black"); p.frame(x + 2, y + 2, w - 4, h - 4, dark ? "lime" : disabled ? "lime" : "pink");
    const scale = h >= 25 && label.length * 12 <= w - 14 ? 2 : 1;
    this.center(label, x + w / 2, y + Math.floor((h - 7 * scale) / 2), disabled ? "pink" : dark ? "white" : "black", scale);
    if (focus) p.frame(x - 2, y - 2, w + 4, h + 4, "black");
    this.ui.add({ id, x, y, w, h, label, disabled, activate: () => this.commands.command(id, value) });
  }
  private header(title: string, right: string) {
    this.p.rect(0, 0, 640, 23, "black"); this.text(title, 10, 4, "white", 2); this.text(right, 630 - right.length * 6, 8, "white"); this.p.rect(0, 22, 640, 1, "pink");
  }
  private sprite(role: Role, x: number, y: number, size: number) { this.art.draw(this.p.ctx, "character", CHARACTER_CELL[role], x, y, size); }
  private fieldSprite(unit: Unit, commander: Friend, x: number, y: number, size: number) {
    const friend = unit.id === "pip" ? commander : POOL.find(f => f.character === FIELD_CHARACTERS[unit.role])!;
    const step = this.reducedMotion || unit.acted ? 0 : Math.floor(this.tick / 260);
    const bits = spriteBits(friend, "down", false, step), scale = Math.max(1, Math.floor((size - 4) / 16));
    const px = x + Math.floor((size - 16 * scale) / 2), py = y + size - 4 - 16 * scale;
    // Keep the original 16px icon's chunky integer pixels, with a pale silhouette rim over detailed terrain.
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) this.p.sprite(bits, px + dx, py + dy, "white", { scale });
    this.p.sprite(bits, px, py, unit.acted ? "pink" : "black", { scale });
  }
  private scenery(index: number, x: number, y: number, size: number, cutout = true) { this.art.draw(this.p.ctx, "terrain", index, x, y, size, cutout); }
  private road(s: Battle, x: number, y: number) {
    return !["#", "~", "f"].includes(terrain(s, { x, y })) && (y === 4 || x === 2 && y < 4 || x === 9 && y > 1 && y < 5);
  }
  private tile(s: Battle, x: number, y: number, ox = MAP_X, oy = MAP_Y, size = MAP_TILE) {
    const p = this.p, px = ox + x * size, py = oy + y * size, t = terrain(s, { x, y }), hash = (x * 71 + y * 137 + s.mission * 17) % 29;
    p.rect(px, py, size, size, "white");
    if (t === "~") {
      this.scenery(SCENERY.water, px, py, size, false);
      if (!this.reducedMotion) { const phase = Math.floor(this.tick / 600) % 4; p.rect(px + 6 + phase, py + 10, 5, 1, "white"); p.rect(px + size - 13 - phase, py + size - 11, 4, 1, "lime"); }
      // Continuous riverbanks, with pale foam immediately inside the dark bank.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (!["~", "="].includes(terrain(s, { x: x + dx, y: y + dy }))) {
        const bx = px + (dx === 1 ? size - 2 : 0), by = py + (dy === 1 ? size - 2 : 0);
        p.rect(bx, by, dx ? 2 : size, dy ? 2 : size, "black"); p.rect(bx + (dx === -1 ? 2 : dx === 1 ? -1 : 0), by + (dy === -1 ? 2 : dy === 1 ? -1 : 0), dx ? 1 : size, dy ? 1 : size, "white");
      }
    } else if (t === "=") {
      this.scenery(SCENERY.water, px, py, size, false); p.rect(px, py + 5, size, size - 10, "white");
      p.withClip(px, py + 7, size, size - 14, () => this.scenery(SCENERY.planks, px, py, size, false)); p.rect(px, py, size, 5, "pink"); p.rect(px, py + size - 5, size, 5, "pink");
      p.rect(px, py + 5, size, 2, "black"); p.rect(px, py + size - 7, size, 2, "black");
    } else {
      // Scattered grass instead of repeating a conspicuous square texture on every tile.
      for (let n = 0; n < 4; n++) { const gx = px + 4 + ((hash + n * 13) % (size - 9)), gy = py + 3 + ((hash * 3 + n * 7) % (size - 8)); p.px(gx, gy, "lime"); p.px(gx + 1, gy - 1, "lime"); p.px(gx + 2, gy, "pink"); }
      if (this.road(s, x, y)) {
        // Connected worn lanes are cosmetic ground; no movement rule is changed.
        const lo = Math.round(size * .22), width = size - lo * 2;
        p.rect(px + lo, py + lo, width, width, "lime");
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (this.road(s, x + dx, y + dy) || terrain(s, { x: x + dx, y: y + dy }) === "=") {
          p.rect(px + (dx < 0 ? 0 : lo), py + (dy < 0 ? 0 : lo), dx ? size - lo : width, dy ? size - lo : width, "lime");
        }
        for (let i = 0; i < 5; i++) { const sx = px + lo + (i * 7 + hash) % Math.max(1, width - 3), sy = py + lo + (i * 11 + hash) % Math.max(1, width - 3); p.rect(sx, sy, 3, 1, "white"); p.px(sx + 2, sy + 1, "pink"); }
      }
      if (t === "f") this.scenery((x + y) % 4 === 0 ? SCENERY.oak : SCENERY.pines, px, py, size);
      else if (t === "#") this.scenery(SCENERY.mountain, px, py, size);
      else if (t === "+") this.scenery(SCENERY.shrine, px - 2, py - 2, size + 4);
      else if ((hash === 3 || hash === 17) && !this.road(s, x, y)) this.scenery(SCENERY.flowers, px + 8, py + 11, Math.round(size * .55));
    }
    if (same({ x, y }, LANTERN)) this.scenery(SCENERY.tower, px - 2, py - 4, size + 4);
    if (same({ x, y }, SIGNAL) && ["signal", "chief"].includes(MISSIONS[s.mission].goal)) this.scenery(SCENERY.flag, px, py, size);
  }
  private map(s: Battle, x = MAP_X, y = MAP_Y, size = MAP_TILE) { for (let row = 0; row < 9; row++) for (let col = 0; col < 12; col++) this.tile(s, col, row, x, y, size); }
  private dialogue(role: Role, text: string, hint = "SELECT A FRIEND  /  MOVE  /  ACT") {
    const p = this.p; this.box(4, 388, 630, 87); p.rect(104, 391, 2, 80, "black");
    this.sprite(role, 8, 386, 94); p.rect(114, 393, NAMES[role].length * 6 + 14, 15, "black"); this.text(NAMES[role], 121, 397, "white");
    const lines = this.words(text, 502, 2);
    if (lines.length <= 2) lines.forEach((line, i) => this.text(line, 116, 415 + i * 19, "black", 2));
    else this.lines(text, 116, 413, 492, 1, "black", 4);
    this.text(hint, 116, 461, "pink"); p.line(612, 460, 620, 460, "black"); p.line(614, 462, 618, 462, "black"); p.px(616, 464, "black");
  }
  private title(v: TacticsPresentation) {
    const p = this.p; this.map(v.s, 0, 0, 54);
    // A small settlement gives the road a destination instead of a blank battlefield backdrop.
    this.scenery(SCENERY.cottage, 465, 94, 72); this.scenery(SCENERY.cottage, 531, 149, 62); this.scenery(SCENERY.tower, 470, 193, 96);
    this.box(24, 28, 397, 136); this.text("A RARE FRIENDS TACTICAL ADVENTURE", 43, 46);
    this.text("REAL FRENEMIES", 43, 66, "black", 3); this.text("THE LANTERN ROAD", 43, 106, "black", 2); this.text("THREE FRIENDS. ONE LAST LIGHT.", 43, 143, "pink");
    this.sprite("ranger", 170, 208, 118); this.sprite("mender", 354, 214, 108); this.sprite("warden", 257, 184, 142);
    this.box(20, 344, 598, 125); this.center("A SMALL WORLD. A BETTER PLAN.", 320, 358);
    this.button("start", "START CAMPAIGN", 40, 380, 336, 36, true); this.button("guide", "FIELD GUIDE", 390, 380, 208, 36);
    if (v.unlocked) this.button("chapters", "CHAPTER SELECT", 40, 431, 230, 22); else this.text("4 CHAPTERS / EVERY MOVE MATTERS", 40, 440, "pink");
    this.button("legacy", "TERRITORY MODE", 390, 431, 208, 22);
  }
  private brief(v: TacticsPresentation) {
    const p = this.p, m = MISSIONS[v.s.mission], story = BRIEFS[v.s.mission]; this.map(v.s, 0, 24, 54);
    for (const u of living(v.s)) this.fieldSprite(u, v.commander, u.x * 54, 24 + u.y * 54, 54);
    this.header(m.subtitle, `CHAPTER ${v.s.mission + 1} / 4`);
    this.box(16, 260, 605, 210); this.sprite(story.role, 20, 274, 162);
    p.rect(182, 275, 2, 147, "pink"); this.text(NAMES[story.role], 199, 279); this.lines(story.line, 199, 298, 400, 2, "black", 3);
    this.text("OBJECTIVE / " + objective(v.s), 199, 366, "pink");
    const goals = ["Defeat all three scouts. Keep the lantern standing.", "Hold the signal for two consecutive nights. Water stops feet, not a shove.", "Protect the lantern for six enemy turns. Sappers ignore us: stop their firebombs!", "Defeat the king, then hold the signal for one night. His attacks strike marked squares."];
    this.lines(goals[v.s.mission], 199, 382, 395, 1, "black", 3);
    this.button("begin", "DEPLOY SQUAD", 198, 431, 250, 28, true); this.button("guide", "FIELD GUIDE", 464, 431, 138, 28);
    this.text("NO FRIEND IS LOST FOREVER.", 29, 448, "pink");
  }
  private battle(v: TacticsPresentation) {
    const p = this.p, s = v.s, u = v.selected;
    this.map(s); this.header(MISSIONS[s.mission].name, `TURN ${String(s.turn).padStart(2, "0")} / LANTERN ${s.lantern}/8`);
    p.frame(7, 23, 482, 362, "black");
    const moves = u?.team === "ally" && !u.moved && !u.acted && v.action === "move" ? reachable(s, u) : new Map<string, number>();
    for (const key of moves.keys()) {
      const [x, y] = key.split(",").map(Number); if (at(s, { x, y })) continue;
      const px = MAP_X + x * MAP_TILE, py = MAP_Y + y * MAP_TILE;
      for (const [dx, dy] of [[2, 2], [34, 2], [2, 34], [34, 34]]) { p.rect(px + dx, py + dy, 4, 1, "pink"); p.rect(px + dx, py + dy, 1, 4, "pink"); }
      p.rect(px + 18, py + 18, 3, 3, "lime");
    }
    for (const wave of MISSIONS[s.mission].waves.filter(w => w.turn === s.turn + 1)) { const x = MAP_X + wave.x * 40, y = MAP_Y + wave.y * 40; p.frame(x + 4, y + 4, 32, 32, "black"); this.center("!", x + 20, y + 10, "black", 2); }
    for (const intent of s.intents) {
      const enemy = living(s, "enemy").find(e => e.id === intent.id); if (!enemy || !intent.target) continue;
      const x = MAP_X + intent.target.x * 40, y = MAP_Y + intent.target.y * 40;
      p.line(MAP_X + enemy.x * 40 + 20, MAP_Y + enemy.y * 40 + 20, x + 20, y + 20, "pink", 3);
      p.frame(x + 2, y + 2, 36, 36, "black"); p.rect(x + 14, y + 1, 12, 11, "black"); this.text("!", x + 17, y + 3, "white");
    }
    for (const unit of living(s)) {
      const x = MAP_X + unit.x * 40, y = MAP_Y + unit.y * 40, selected = unit.id === u?.id, enemy = unit.team === "enemy";
      // Team bases and command pips carry team/action information without recoloring the art.
      p.rect(x + 6, y + 31, 28, 5, enemy ? "black" : "white"); p.frame(x + 6, y + 31, 28, 5, "black");
      this.fieldSprite(unit, v.commander, x, y - 2, 40);
      if (enemy && unit.role === "archer") this.text("A", x + 31, y + 2, "black");
      if (selected) { p.frame(x + 1, y + 1, 38, 38, "black"); p.frame(x + 2, y + 2, 36, 36, "white"); }
      p.rect(x + 7, y + 36, 26, 3, "black"); p.rect(x + 8, y + 37, Math.ceil(unit.hp / unit.maxHp * 24), 1, "white");
      if (!enemy) { p.rect(x + 1, y + 1, 10, 10, "black"); this.text(unit.acted ? "-" : String(["pip", "rook", "moss"].indexOf(unit.id) + 1), x + 3, y + 3, "white"); }
      if (unit.guard) { p.rect(x + 30, y + 1, 9, 10, "black"); this.text("G", x + 32, y + 3, "white"); }
      if (u && v.action !== "move" && canAct(s, u, v.action, unit)) { p.frame(x, y, 40, 40, "black"); p.frame(x + 1, y + 1, 38, 38, "white"); }
    }
    const cx = MAP_X + v.cursor.x * 40, cy = MAP_Y + v.cursor.y * 40;
    for (const [dx, dy, sx, sy] of [[0, 0, 1, 1], [39, 0, -1, 1], [0, 39, 1, -1], [39, 39, -1, -1]]) { p.line(cx + dx, cy + dy, cx + dx + sx * 8, cy + dy, "black"); p.line(cx + dx, cy + dy, cx + dx, cy + dy + sy * 8, "black"); }
    this.ui.add({ id: "board", label: "Tactical battlefield", x: MAP_X, y: MAP_Y, w: 480, h: 360, activate: () => this.commands.tile(v.cursor), press: (x, y) => this.commands.tile({ x: Math.floor((x - MAP_X) / 40), y: Math.floor((y - MAP_Y) / 40) }) });
    this.panel(v);
    for (const effect of v.effects.filter(e => e.until > v.tick)) { p.rect(MAP_X + effect.x * 40 + 7, MAP_Y + effect.y * 40 + 4, 26, 15, "black"); this.center(effect.text, MAP_X + effect.x * 40 + 20, MAP_Y + effect.y * 40 + 7, "white"); }
    const role = u?.role ?? "warden";
    const text = v.pendingTurn ? "Hold fast, friends. Here they come!" : v.action !== "move" ? v.description : v.tick < v.flashUntil ? v.flash : QUOTES[role];
    const hint = v.pendingTarget ? "SELECT TARGET AGAIN TO CONFIRM / ESC TO CANCEL" : v.action !== "move" ? "CHOOSE AN OUTLINED TARGET / REVIEW THE FORECAST" : "1-3 SELECT   A ATTACK   S SKILL   G GUARD   U UNDO";
    this.dialogue(role, text, hint);
    if (v.pendingTurn) { this.box(126, 167, 245, 47, "black"); this.center("ENEMY TURN", 248, 183, "white", 2); }
  }
  private panel(v: TacticsPresentation) {
    const p = this.p, u = v.selected, x = 498; p.rect(492, 24, 148, 362, "lime");
    this.box(x, 29, 131, 156);
    if (u) {
      this.center(NAMES[u.role], 563, 38); this.sprite(u.role, 525, 49, 76);
      this.text(`${u.hp}/${u.maxHp} HP`, 508, 130); this.text(`MOV ${ROLES[u.role].move}`, 575, 130);
      p.rect(508, 143, 111, 5, "black"); p.rect(509, 144, Math.ceil(u.hp / u.maxHp * 109), 3, "pink");
      this.center(u.team === "enemy" ? "ENEMY" : u.acted ? "ACTION SPENT" : u.moved ? "ACTION READY" : "MOVE + ACTION", 563, 159, u.acted ? "pink" : "black");
      this.center(`RANGE ${ROLES[u.role].range} / DMG ${ROLES[u.role].damage}`, 563, 173, "pink");
    }
    this.lines(objective(v.s), 504, 195, 122, 1, "black", 2);
    if (u?.team === "ally") {
      this.button("attack", "A ATTACK", x, 223, 131, 25, v.action === "attack", u.acted);
      this.button("skill", `S ${ROLES[u.role].skill}`, x, 254, 131, 25, v.action === "skill", u.acted || u.role === "ranger" && u.moved);
      this.button("guard", "G GUARD", x, 285, 62, 23, false, u.acted); this.button("undo", "U UNDO", 567, 285, 62, 23);
    } else if (u) {
      const intent = v.s.intents.find(i => i.id === u.id); this.text("INTENTION", 505, 229);
      this.lines(intent?.target ? `STRIKE TILE ${intent.target.x + 1},${intent.target.y + 1}. TARGET IS LOCKED.` : u.role === "sapper" ? "HUNTS THE LANTERN. STOP THE FIREBOMB!" : "ADVANCE NEXT TURN.", 505, 247, 117, 1, "black", 5);
    }
    this.button("end", v.confirmEnd ? "CONFIRM END?" : "E END TURN", x, 320, 131, 29, true);
    this.button("help", "HELP", x, 358, 40, 22); this.button("log", "LOG", 543, 358, 40, 22); this.button("retry", v.confirmRetry ? "SURE?" : "RETRY", 588, 358, 41, 22);
  }
  private result(v: TacticsPresentation) {
    const p = this.p, won = v.s.result === "won"; this.map(v.s, 0, 0, 54);
    this.header(won ? "A LIGHT REKINDLED" : "THE LIGHT FADES", `CHAPTER ${v.s.mission + 1} / 4`);
    this.box(28, 49, 582, 268); this.center(won ? "MISSION COMPLETE" : "WE TRY AGAIN. TOGETHER.", 320, 70, "black", 2);
    this.center(MISSIONS[v.s.mission].name, 320, 100, "pink");
    const labels = ["LIGHT THE WAY", "ALL FRIENDS HOME", `WITHIN ${MISSIONS[v.s.mission].par} TURNS`];
    medals(v.s).forEach((earned, i) => { const x = 50 + i * 183; this.box(x, 129, 172, 87, earned ? "lime" : "white"); this.center(earned ? "+" : "-", x + 86, 144, "black", 3); this.center(labels[i], x + 86, 178); this.center(earned ? "EARNED" : "TRY AGAIN", x + 86, 197, "pink"); });
    this.center(`${turnsUsed(v.s)} TURNS / ${v.s.lost} FRIENDS LOST / LANTERN ${v.s.lantern}/8`, 320, 234);
    this.button("next", won ? v.s.mission === 3 ? "DAWN AWAITS" : "NEXT CHAPTER" : "TRY AGAIN", 49, 267, 278, 29, true); this.button("replay", won ? "REPLAY" : "FIELD GUIDE", 346, 267, 242, 29);
    this.button("chapters", "C CHAPTER SELECT", 216, 340, 208, 26);
    this.dialogue(won ? "mender" : "warden", won ? "One more light along the road. We did that together." : "It's not over. We'll find a better way.", "BEST MEDALS ARE KEPT FOR THIS SESSION");
  }
  private help(v: TacticsPresentation) {
    this.header("FIELD GUIDE", "H / ESC TO RETURN"); this.box(13, 36, 612, 333);
    const entries = [
      ["01 / MOVE, THEN ACT", "Select a friend (1/2/3), then a marked tile to move. Attack, skill or guard uses its action."],
      ["02 / READ THE ENEMY", "Enemy marked squares are locked. Move away to dodge. Defeat the attacker to cancel its strike."],
      ["03 / MAKE THE MAP YOUR WEAPON", "Shove pushes one tile. Water: KO. Collision: +2 damage. Pierce ignores trees but requires no move."],
      ["04 / KEEP YOUR FRIENDS CLOSE", "Moss heals 3 HP. Guard blocks 2 damage. Forest: 1 armor, 2 move cost. Shrine: heal 1 each night."],
      ["05 / TRY ANOTHER PLAN", "Arrows + Enter target. A/S/G act. E ends. U undoes. R retries. L opens turn report. M toggles sound."],
    ];
    entries.forEach(([title, body], i) => { this.text(title, 29, 53 + i * 59); this.lines(body, 29, 70 + i * 59, 568, 1, "pink", 3); });
    this.button("back", "BACK TO THE ROAD", 26, 397, 354, 34, true); this.button("sound", v.muted ? "SOUND OFF" : "SOUND ON", 399, 397, 211, 34);
    this.center("PREVIEW THE DAMAGE. SELECT AGAIN TO CONFIRM.", 320, 451);
  }
  private chapters(v: TacticsPresentation) {
    this.header("THE LANTERN ROAD", `${v.scores.flat().filter(Boolean).length}/12 MEDALS`); this.map(v.s, 0, 25, 54);
    this.box(28, 43, 582, 324); this.text("REVISIT A CHAPTER. KEEP YOUR BEST MEDALS.", 48, 62);
    MISSIONS.forEach((m, i) => { this.button(`chapter${i}`, `${i + 1} / ${m.name}`, 48, 93 + i * 63, 410, 42, i === v.chapterPick, i > v.unlocked, i); this.text(i > v.unlocked ? "LOCKED" : `${v.scores[i]?.filter(Boolean).length ?? 0}/3 MEDALS`, 486, 110 + i * 63, "pink"); });
    this.button("title", "BACK TO TITLE", 28, 397, 190, 32); this.text("ARROWS CHOOSE / ENTER DEPLOYS", 255, 409);
  }
  private report(v: TacticsPresentation) {
    this.header("LAST ENEMY TURN", "L / ESC TO RETURN"); this.box(14, 38, 608, 342);
    this.text("EVERY STRIKE, MISS AND REINFORCEMENT.", 29, 55);
    const lines = v.report.length ? v.report : ["No enemy turn yet. End turn to resolve marked squares."];
    lines.slice(0, 10).forEach((line, i) => { this.p.rect(27, 82 + i * 27, 579, 24, i % 2 ? "white" : "lime"); this.lines(line, 33, 89 + i * 27, 565, 1, "black", 2); });
    this.button("back", "RETURN TO THE ROAD", 115, 405, 410, 34, true);
  }
  draw(v: TacticsPresentation) {
    this.tick = v.tick; this.reducedMotion = v.reducedMotion;
    this.p.rect(0, 0, 640, 480, "white"); this.ui.begin();
    switch (v.page) {
      case "title": this.title(v); break;
      case "brief": this.brief(v); break;
      case "battle": this.battle(v); break;
      case "result": this.result(v); break;
      case "help": this.help(v); break;
      case "chapters": this.chapters(v); break;
      case "log": this.report(v); break;
      case "ending": this.map(v.s, 0, 0, 54); this.box(42, 47, 554, 182); this.center("AND SO CAME THE DAWN.", 320, 71, "black", 2); this.sprite("warden", 136, 108, 94); this.sprite("ranger", 270, 108, 94); this.sprite("mender", 404, 108, 94); this.center(`${v.scores.flat().filter(Boolean).length}/12 MEDALS / THE ROAD IS OURS AGAIN`, 320, 251); this.button("chapters", "CHAPTER SELECT / CHASE MEDALS", 105, 298, 430, 35, true); this.dialogue("mender", "The lanterns are lit. Nobody walks this road alone.", "REAL FRENEMIES / THANK YOU FOR PLAYING"); break;
      default: this.center(v.page === "error" ? "SIGNAL LOST" : "WAKING THE FOREST", 320, 204, "black", 2); if (v.page === "error") this.button("retry-load", "RETRY", 230, 257, 180, 35); break;
    }
    if (v.page === "title") { this.box(467, 8, 163, 28); this.text(`BANNER #${v.commander.tokenId}`, 476, 18); this.p.sprite(spriteBits(v.commander, "down", false, 0), 606, 13, "black"); }
    this.ui.settle();
  }
}
