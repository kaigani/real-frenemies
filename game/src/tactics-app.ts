import type { AppHost } from "./app.ts";
import { POOL, spriteBits, type Friend } from "./friends.ts";
import { readFriend } from "./onchain.ts";
import { Painter, type Color } from "./render/draw.ts";
import { Ui } from "./ui.ts";
import { act, at, canAct, copyBattle, createBattle, endTurn, forecast, LANTERN, living, medals, MISSIONS, move, objective, reachable, ROLES, same, SIGNAL, terrain, turnsUsed, type Action, type Battle, type Point, type Unit } from "./tactics.ts";

const X = 8, Y = 33, T = 16;
type Page = "title" | "brief" | "battle" | "result" | "help" | "ending" | "chapters" | "log" | "loading" | "error";
/** Cartridge campaign. The old territory simulation remains available through the adapter's mode control. */
export class TacticsApp {
  private p: Painter;
  private ui = new Ui();
  private host: AppHost;
  private page: Page = "loading";
  private helpBack: Page = "title";
  private s = createBattle();
  private checkpoint = copyBattle(this.s);
  private selected = "pip";
  private action: Action | "move" = "move";
  private cursor: Point = { x: 3, y: 3 };
  private tick = 0;
  private raf = 0;
  private disposed = false;
  private paused = false;
  private commander: Friend = POOL[0];
  private scores: boolean[][] = [];
  private flash = "";
  private flashUntil = 0;
  private confirmEnd = false;
  private confirmRetry = false;
  private enemyUntil = 0;
  private pendingTurn = false;
  private pendingTarget: string | null = null;
  private effects: { x: number; y: number; text: string; until: number }[] = [];
  private report: string[] = [];
  private reportBack: Page = "battle";
  private chapterPick = 0;
  private unlocked = 0;
  muted = true;
  reducedMotion = false;
  private legacy: () => void;
  constructor(ctx: CanvasRenderingContext2D, host: AppHost, legacy: () => void = () => {}) { this.p = new Painter(ctx); this.host = host; this.legacy = legacy; }
  start() {
    const loop = (t: number) => { this.tick = t; this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    void readFriend(this.host.friendId).then(friend => {
      if (this.disposed) return;
      this.commander = friend; this.go("title"); this.say("Real Frenemies: The Lantern Road. Start campaign to play four turn-based missions.");
    }).catch(() => { if (!this.disposed) { this.go("error"); this.say("Could not load your Friend. Use Retry to try again."); } });
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.raf); }
  setPaused(on: boolean) { this.paused = on; }
  setReducedMotion(on: boolean) { this.reducedMotion = on; this.emit(); }
  setMuted(on: boolean) { this.muted = on; this.host.setMuted(on); this.emit(); }
  private emit() { this.host.onState?.({ muted: this.muted, reducedMotion: this.reducedMotion, screen: `tactics-${this.page}` }); }
  private go(page: Page) { this.page = page; this.ui.focusId = null; this.confirmEnd = false; this.confirmRetry = false; this.emit(); }
  private say(text: string) { this.host.announce(text); }
  private note(text: string) { this.flash = text; this.flashUntil = this.tick + 3200; this.say(text); }
  private begin(mission: number) { this.s = createBattle(mission); this.checkpoint = copyBattle(this.s); this.selected = "pip"; this.action = "move"; this.pendingTarget = null; this.report = []; this.effects = []; this.cursor = { x: 3, y: 3 }; this.go("brief"); this.say(`${MISSIONS[mission].name}. ${MISSIONS[mission].brief.join(" ")}`); }
  private enterBattle() { this.go("battle"); this.say(`${objective(this.s)}. Select a friend, then a dotted square to move. A attacks, S uses a skill, G guards, E ends the turn. Enemy marked squares are locked.`); }
  private friend(u: Unit): Friend {
    if (u.id === "pip") return this.commander;
    const character = { warden: "Skeleton", ranger: "Asymmetry", mender: "Cellular", raider: "Mask", archer: "Sparkling", sapper: "Skeleton", chief: "Hollow" }[u.role];
    return POOL.find(f => f.character === character)!;
  }
  private selectedUnit() { return living(this.s).find(u => u.id === this.selected); }
  summary() { const u = this.selectedUnit(); return this.page === "battle" ? `Turn ${this.s.turn} · ${objective(this.s)} · Lantern ${this.s.lantern}/8${u ? ` · ${ROLES[u.role].name}: ${u.hp}/${u.maxHp} HP` : ""}` : "THE LANTERN ROAD · FOUR CHAPTER CAMPAIGN"; }
  private select(u: Unit) { this.selected = u.id; this.cursor = { x: u.x, y: u.y }; this.action = "move"; this.pendingTarget = null; this.ui.focusId = null; this.confirmEnd = false; this.host.play("select"); this.say(`${ROLES[u.role].name}, ${u.hp} of ${u.maxHp} HP. ${u.acted ? "Action spent." : "Ready."}`); }
  hover(x: number, y: number) { if (this.page === "battle" && x >= X && x < X + 192 && y >= Y && y < Y + 144) this.cursor = { x: Math.floor((x - X) / T), y: Math.floor((y - Y) / T) }; }
  pointer(x: number, y: number) { if (!this.paused && !this.pendingTurn) this.ui.press(Math.floor(x), Math.floor(y)); }
  private tile(p: Point) {
    this.cursor = p;
    const target = at(this.s, p), u = this.selectedUnit();
    if (u && this.action !== "move" && target && canAct(this.s, u, this.action, target)) {
      if (this.pendingTarget !== target.id) { this.pendingTarget = target.id; this.note(`${forecast(this.s, u, this.action, target)}. Select target again to confirm.`); return; }
      const hp = target.hp;
      act(this.s, u.id, this.action, target.id); this.effects.push({ x: target.x, y: target.y, text: target.hp <= 0 ? "KO" : `${target.hp > hp ? "+" : ""}${target.hp - hp}`, until: this.tick + 1100 });
      this.pendingTarget = null; this.host.play(target.hp <= 0 ? "reveal-rare" : "impact"); this.note(this.s.log[0]); this.action = "move"; this.changed(); return;
    }
    if (target) {
      if (this.action !== "move" && target.team === "enemy" && u?.team === "ally") { this.note("Out of range. Move closer or choose another target."); return; }
      this.select(target); return;
    }
    if (u && this.action === "move" && move(this.s, u.id, p)) { this.host.play("select"); this.say(this.s.log[0]); }
    else this.note(u?.acted ? "Action spent. Select another friend or end turn." : "Choose a dotted tile to move; A to attack.");
    this.confirmEnd = false; this.pendingTarget = null; this.ui.focusId = null;
  }
  private choose(action: Action) {
    const u = this.selectedUnit();
    if (!u || u.team !== "ally" || u.acted) { this.note("Select a ready friend first."); return; }
    this.confirmEnd = false; this.pendingTarget = null; this.ui.focusId = null;
    if (action === "skill" && u.role === "ranger" && u.moved) { this.note("Pierce requires standing still. Use Attack or undo."); return; }
    if (action === "guard") { act(this.s, u.id, action); this.note(this.s.log[0]); this.action = "move"; this.host.play("action-ready"); this.changed(); }
    else { this.action = action; this.host.play("select"); this.say(action === "attack" ? "Choose a outlined enemy to attack. Hover or use arrows for exact damage." : `${ROLES[u.role].skill}: choose a outlined target. Hover or use arrows for a forecast.`); }
  }
  private changed() {
    if (this.s.result !== "playing") {
      this.scores[this.s.mission] = medals(this.s).map((earned, i) => earned || this.scores[this.s.mission]?.[i] || false);
      if (this.s.result === "won") this.unlocked = Math.max(this.unlocked, Math.min(3, this.s.mission + 1));
      this.go("result"); this.host.play(this.s.result === "won" ? "reward" : "impact");
      this.say(`${this.s.result === "won" ? "Mission complete" : "Lantern extinguished"}. ${turnsUsed(this.s)} turns, ${this.s.lost} friends lost. ${medals(this.s).filter(Boolean).length} of 3 medals.`);
    }
  }
  private end() {
    if (this.pendingTurn || this.s.result !== "playing") return;
    const ready = living(this.s, "ally").filter(u => !u.acted).length;
    if (ready && !this.confirmEnd) { this.confirmEnd = true; this.note(`${ready} friends still have actions. End turn again to confirm.`); return; }
    this.confirmEnd = false; this.pendingTurn = true; this.enemyUntil = this.tick + (this.reducedMotion ? 250 : 750); this.host.play("anticipation"); this.say("Enemy turn. Resolving marked squares.");
  }
  private undo() { this.s = copyBattle(this.checkpoint); this.selected = "pip"; this.action = "move"; this.pendingTarget = null; this.effects = []; this.confirmEnd = false; this.ui.focusId = null; this.note("Turn reset. Try another plan."); }
  private retry() { if (!this.confirmRetry) { this.confirmRetry = true; this.note("Restart this mission? Press R or RETRY again."); } else this.begin(this.s.mission); }
  private help() { this.helpBack = this.page; this.go("help"); this.say("Field guide. Move each friend once, then attack, use a skill, or guard. Enemy targets stay fixed until end turn. U resets your current turn. Escape returns."); }
  private openReport() { this.reportBack = this.page; this.go("log"); this.say(this.report.length ? `Last enemy turn. ${this.report.join(" ")}` : "No enemy turn yet. Locked attacks resolve when you end your turn."); }
  private chapters() { this.chapterPick = Math.min(this.s.mission, this.unlocked); this.go("chapters"); this.say(`Chapter select. ${this.unlocked + 1} chapters unlocked. Arrows choose; Enter deploys. Your best medals are kept this session.`); }
  key(e: KeyboardEvent): boolean {
    if (this.paused || this.pendingTurn) return false;
    const k = e.key.toLowerCase();
    if (k === "tab") return this.ui.step(e.shiftKey ? -1 : 1);
    if (k === "m") { this.setMuted(!this.muted); return true; }
    if (k === "h" || k === "?") { this.page === "help" ? this.go(this.helpBack) : this.help(); return true; }
    if (k === "l" && ["battle", "result", "log"].includes(this.page)) { this.page === "log" ? this.go(this.reportBack) : this.openReport(); return true; }
    if (k === "c" && ["ending", "result", "title"].includes(this.page)) { this.chapters(); return true; }
    if (k === "escape") {
      if (this.page === "help") this.go(this.helpBack);
      else if (this.page === "log") this.go(this.reportBack);
      else if (this.page === "chapters") this.go("title");
      else if (this.page === "battle") { this.action = "move"; this.confirmEnd = false; this.confirmRetry = false; }
      return true;
    }
    if (k === "enter" || k === " ") {
      if (this.ui.current()) this.ui.activate();
      else if (this.page === "title") this.begin(0);
      else if (this.page === "brief") this.enterBattle();
      else if (this.page === "battle") this.tile(this.cursor);
      else if (this.page === "result") this.s.result === "won" ? this.s.mission === 3 ? this.go("ending") : this.begin(this.s.mission + 1) : this.begin(this.s.mission);
      else if (this.page === "help") this.go(this.helpBack);
      else if (this.page === "ending") this.chapters();
      else if (this.page === "chapters") this.begin(this.chapterPick);
      else if (this.page === "log") this.go(this.reportBack);
      return true;
    }
    if (this.page === "chapters" && ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { this.chapterPick = (this.chapterPick + (k === "arrowup" || k === "arrowleft" ? this.unlocked : 1)) % (this.unlocked + 1); this.ui.focusId = null; this.say(MISSIONS[this.chapterPick].name); return true; }
    if (this.page !== "battle") return false;
    const dirs: Record<string, Point> = { arrowleft: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, arrowup: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 } };
    if (dirs[k]) { this.cursor.x = Math.max(0, Math.min(11, this.cursor.x + dirs[k].x)); this.cursor.y = Math.max(0, Math.min(8, this.cursor.y + dirs[k].y)); this.ui.focusId = null; this.say(`Tile ${this.cursor.x + 1},${this.cursor.y + 1}: ${this.tileDescription()}`); return true; }
    if (["1", "2", "3"].includes(k)) { const u = living(this.s, "ally").find(u => u.id === ["pip", "rook", "moss"][Number(k) - 1]); if (u) this.select(u); return true; }
    if (k === "a" || k === "s" || k === "g") { this.choose(k === "a" ? "attack" : k === "s" ? "skill" : "guard"); return true; }
    if (k === "e") { this.end(); return true; }
    if (k === "u") { this.undo(); return true; }
    if (k === "r") { this.retry(); return true; }
    return false;
  }
  private tileDescription() {
    const target = at(this.s, this.cursor), u = this.selectedUnit();
    if (target && u && this.action !== "move") return forecast(this.s, u, this.action, target);
    const names: Record<string, string> = { ".": "MEADOW", "f": "FOREST: ARMOR 1", "~": "WATER: SHOVE = KO", "#": "CLIFF: BLOCKS SHOTS", "=": "BRIDGE", "+": "SHRINE: HEALS 1" };
    if (same(this.cursor, LANTERN)) return `LANTERN ${this.s.lantern}/8 HP`;
    if (same(this.cursor, SIGNAL)) return "SIGNAL: STAND HERE";
    return target ? `${ROLES[target.role].name} ${target.hp}HP` : names[terrain(this.s, this.cursor)];
  }
  private button(id: string, label: string, x: number, y: number, w: number, fn: () => void, opts: { active?: boolean; disabled?: boolean; h?: number } = {}) {
    const p = this.p, h = opts.h ?? 13, focus = this.ui.focused(id), dark = opts.active || focus;
    p.rect(x + 1, y + 1, w, h, "black"); p.rect(x, y, w, h, dark ? "black" : opts.disabled ? "lime" : "white"); p.frame(x, y, w, h, "black");
    p.textCenter(label, x + w / 2, y + Math.floor((h - 5) / 2), dark ? "white" : opts.disabled ? "pink" : "black");
    if (focus) p.frame(x - 2, y - 2, w + 4, h + 4, "pink");
    this.ui.add({ id, label, x, y, w, h, disabled: opts.disabled, activate: fn });
  }
  private draw() {
    if (this.pendingTurn && this.tick >= this.enemyUntil && !this.paused) {
      this.pendingTurn = false;
      const before = copyBattle(this.s); this.report = [...endTurn(this.s)];
      for (const old of before.units) { const next = this.s.units.find(u => u.id === old.id); if (next && next.hp !== old.hp) this.effects.push({ x: old.x, y: old.y, text: next.hp <= 0 ? "KO" : `${next.hp > old.hp ? "+" : ""}${next.hp - old.hp}`, until: this.tick + 1300 }); }
      this.checkpoint = copyBattle(this.s); this.action = "move";
      if (!this.selectedUnit() || this.selectedUnit()?.team !== "ally") this.selected = living(this.s, "ally")[0]?.id ?? "pip";
      this.note(this.s.log.join(" ")); this.changed();
    }
    this.ui.begin(); this.p.rect(0, 0, 319, 212, "white");
    if (this.page === "title") this.drawTitle();
    else if (this.page === "brief") this.drawBrief();
    else if (this.page === "battle") this.drawBattle();
    else if (this.page === "help") this.drawHelp();
    else if (this.page === "result") this.drawResult();
    else if (this.page === "ending") this.drawEnding();
    else if (this.page === "chapters") this.drawChapters();
    else if (this.page === "log") this.drawReport();
    else { this.p.bigCenter(this.page === "error" ? "SIGNAL LOST" : "WAKING THE FOREST", 159, 82, "black"); if (this.page === "error") this.button("retry-load", "RETRY", 110, 115, 100, () => { this.dispose(); this.disposed = false; this.start(); }); }
    this.ui.settle();
  }
  private tree(x: number, y: number, tall = false) {
    const p = this.p; p.rect(x + 5, y + 11, 3, tall ? 7 : 4, "black");
    p.rect(x + 2, y + 5, 10, 7, "black"); p.rect(x + 4, y + 2, 6, 12, "black"); p.rect(x + 1, y + 8, 12, 3, "black");
    p.rect(x + 4, y + 4, 5, 2, "lime"); p.rect(x + 3, y + 7, 4, 2, "pink"); p.px(x + 5, y + 3, "white"); p.px(x + 9, y + 10, "pink");
  }
  private landscape() {
    const p = this.p;
    p.rect(0, 0, 319, 147, "lime");
    p.rect(236, 19, 23, 23, "white"); p.rect(232, 24, 31, 13, "white");
    for (let i = 0; i < 10; i++) { const x = i * 35 - 7, y = 63 + (i % 3) * 9; p.rect(x, y, 32, 84 - y, "pink"); p.rect(x + 5, y - 5, 22, 6, "pink"); }
    p.dither(0, 85, 319, 50, "white", 1);
    // The old signal tower, with crenellations, masonry, a lit window and a winding road.
    p.rect(243, 59, 37, 72, "black"); p.rect(247, 65, 29, 64, "pink");
    for (let x = 242; x < 280; x += 12) p.rect(x, 54, 8, 11, "black");
    p.rect(258, 76, 8, 16, "black"); p.rect(260, 77, 4, 13, "white");
    for (let i = 0; i < 6; i++) { const y = 98 + i * 5; p.rect(248, y, 26, 1, "black"); p.rect(252 + i % 2 * 11, y, 1, 5, "black"); }
    p.rect(256, 115, 12, 16, "black");
    for (let y = 127; y < 151; y++) { const x = 256 - (y - 127) * 3; p.rect(x, y, 15 + (y - 127), 1, "white"); }
    for (const [x, y] of [[7, 107], [26, 116], [194, 107], [220, 119], [290, 99], [304, 119]]) this.tree(x, y, true);
    p.rect(0, 146, 319, 3, "black"); p.rect(0, 149, 319, 1, "pink");
  }
  private drawTitle() {
    const p = this.p; this.landscape();
    p.rect(17, 17, 180, 66, "white"); p.frame(19, 19, 176, 62, "black");
    p.text("A RARE FRIENDS TACTICAL ADVENTURE", 26, 26, "black");
    // Native bitmap lettering at 2x, with no font rasterization or smoothing.
    p.ctx.save(); p.ctx.translate(27, 39); p.ctx.scale(2, 2); p.big("REAL", 0, 0, "black"); p.big("FRENEMIES", 0, 11, "black"); p.ctx.restore();
    p.text("T H E  L A N T E R N  R O A D", 27, 88, "black");
    const team = createBattle().units.filter(u => u.team === "ally");
    team.forEach((u, i) => { p.sprite(spriteBits(this.friend(u), "down", false, this.reducedMotion ? 0 : Math.floor(this.tick / 230)), 43 + i * 43, 109, "black", { scale: 2 }); });
    p.textCenter("THREE FRIENDS. ONE LAST LIGHT.", 159, 155, "black");
    this.button("start", "START CAMPAIGN", 25, 169, 165, () => this.begin(0), { active: true, h: 20 });
    this.button("guide", "FIELD GUIDE", 204, 169, 90, () => this.help(), { h: 20 });
    if (this.unlocked > 0) this.button("chapters", "C CHAPTERS", 25, 197, 165, () => this.chapters(), { h: 11 });
    else p.text("4 CHAPTERS / NO RANDOM HITS", 24, 201, "black");
    this.button("legacy", "TERRITORY MODE", 204, 197, 90, this.legacy, { h: 11 });
  }
  private header(title: string, right = "") {
    const p = this.p; p.rect(0, 0, 319, 17, "black"); p.big(title, 8, 5, "white"); p.textRight(right, 311, 6, "lime");
  }
  private drawBrief() {
    const p = this.p, m = MISSIONS[this.s.mission]; this.header("THE LANTERN ROAD", `CHAPTER ${this.s.mission + 1}/4`);
    p.text(m.subtitle, 16, 29, "pink"); p.big(m.name, 16, 43, "black");
    p.frame(15, 59, 289, 83, "black"); p.rect(18, 62, 283, 77, "lime");
    m.brief.forEach((line, i) => p.text(line.toUpperCase(), 26, 72 + i * 15, "black"));
    for (let i = 0; i < 4; i++) { p.rect(25 + i * 73, 151, 50, 2, i <= this.s.mission ? "black" : "pink"); p.text(`${i + 1}`, 46 + i * 73, 158, "black"); }
    this.button("begin", "DEPLOY SQUAD", 16, 177, 177, () => this.enterBattle(), { active: true, h: 20 });
    this.button("guide", "FIELD GUIDE", 208, 177, 96, () => this.help(), { h: 20 });
    p.text("NO PERMADEATH. RETRY ANY MISSION. RELOAD RESETS THE RUN.", 16, 204, "black");
  }
  private drawTile(x: number, y: number) {
    const p = this.p, tx = X + x * T, ty = Y + y * T, t = terrain(this.s, { x, y }), n = (x * 19 + y * 31) % 11;
    p.rect(tx, ty, T, T, "lime");
    if (t === "~") {
      p.rect(tx, ty, T, T, "pink");
      for (let i = 0; i < 2; i++) { const off = this.reducedMotion ? 0 : Math.floor(this.tick / 650) % 3; p.rect(tx + ((x * 3 + off + i * 7) % 11), ty + 4 + i * 7, 4, 1, "white"); }
      if (terrain(this.s, { x: x - 1, y }) !== "~") p.rect(tx, ty, 1, 16, "black");
      if (terrain(this.s, { x: x + 1, y }) !== "~") p.rect(tx + 15, ty, 1, 16, "black");
    } else if (t === "#") {
      p.rect(tx + 1, ty + 3, 14, 13, "black"); p.rect(tx + 3, ty + 1, 10, 10, "pink"); p.rect(tx + 4, ty + 2, 7, 2, "white"); p.line(tx + 3, ty + 11, tx + 11, ty + 11, "lime");
    } else if (t === "=") {
      p.rect(tx, ty + 1, 16, 14, "black"); p.rect(tx, ty + 3, 16, 10, "white");
      for (let i = 3; i < 16; i += 4) p.rect(tx + i, ty + 3, 1, 10, "pink");
    } else if (t === "f") { this.tree(tx + 1, ty); }
    else if (t === "+") { p.frame(tx + 3, ty + 3, 10, 10, "pink"); p.rect(tx + 7, ty + 4, 2, 8, "white"); p.rect(tx + 4, ty + 7, 8, 2, "white"); }
    else { p.px(tx + 3 + n % 8, ty + 5 + n % 7, "pink"); if (n < 4) { p.px(tx + 9, ty + 11, "pink"); p.px(tx + 10, ty + 10, "pink"); } }
    if (same({ x, y }, LANTERN)) {
      p.rect(tx + 2, ty + 13, 12, 2, "black"); p.rect(tx + 6, ty + 7, 4, 7, "black"); p.rect(tx + 4, ty + 2, 8, 8, "black"); p.rect(tx + 5, ty + 3, 6, 5, "white"); p.px(tx + 8, ty + 4, "pink");
    }
    if (same({ x, y }, SIGNAL) && MISSIONS[this.s.mission].goal !== "clear" && MISSIONS[this.s.mission].goal !== "survive") {
      p.rect(tx + 4, ty + 2, 1, 13, "black"); p.rect(tx + 5, ty + 2, 8, 6, "black"); p.rect(tx + 6, ty + 3, 5, 3, "white");
    }
  }
  private drawBattle() {
    const p = this.p, s = this.s, u = this.selectedUnit();
    this.header(MISSIONS[s.mission].name, `TURN ${String(s.turn).padStart(2, "0")}`);
    p.text(objective(s), 8, 23, "black"); p.textRight(`LANTERN ${s.lantern}/8`, 311, 23, "black");
    p.frame(X - 2, Y - 2, 196, 148, "black");
    for (let y = 0; y < 9; y++) for (let x = 0; x < 12; x++) this.drawTile(x, y);
    const moves = u?.team === "ally" && !u.moved && !u.acted && this.action === "move" ? reachable(s, u) : new Map<string, number>();
    for (const key of moves.keys()) { const [x, y] = key.split(",").map(Number); if (!at(s, { x, y })) { p.rect(X + x * T + 6, Y + y * T + 6, 4, 4, "white"); p.frame(X + x * T + 6, Y + y * T + 6, 4, 4, "black"); } }
    for (const wave of MISSIONS[s.mission].waves.filter(w => w.turn === s.turn + 1)) { const x = X + wave.x * T, y = Y + wave.y * T; p.frame(x + 1, y + 1, 14, 14, "black"); p.textOutlined("!", x + 7, y + 5, "white"); }
    for (const intent of s.intents) {
      const enemy = living(s, "enemy").find(e => e.id === intent.id);
      if (!intent.target || !enemy) continue;
      const x = X + intent.target.x * T, y = Y + intent.target.y * T;
      p.line(X + enemy.x * T + 8, Y + enemy.y * T + 8, x + 8, y + 8, "black", 3);
      for (const [dx, dy] of [[1, 1], [12, 1], [1, 12], [12, 12]]) { p.rect(x + dx, y + dy, 3, 1, "black"); p.rect(x + dx, y + dy, 1, 3, "black"); }
      p.rect(x + 6, y, 5, 6, "black"); p.text("!", x + 7, y, "white");
    }
    for (const unit of living(s)) {
      const x = X + unit.x * T, y = Y + unit.y * T, enemy = unit.team === "enemy", selected = unit.id === this.selected;
      p.rect(x + 2, y + 2, 12, 12, enemy ? "black" : "white");
      p.sprite(spriteBits(this.friend(unit), "down", false, this.reducedMotion || unit.acted ? 0 : Math.floor(this.tick / 260)), x, y - 1, enemy ? "white" : unit.acted ? "pink" : "black");
      p.rect(x + 1, y + 14, 14, 2, "black"); p.rect(x + 2, y + 14, Math.max(1, Math.ceil(unit.hp / unit.maxHp * 12)), 1, "white");
      if (selected) { p.frame(x, y, 16, 16, "black"); p.px(x + 1, y + 1, "white"); }
      if (!enemy) { p.rect(x, y, 5, 6, "black"); p.text(unit.acted ? "-" : `${["pip", "rook", "moss"].indexOf(unit.id) + 1}`, x + 1, y, "white"); }
      if (unit.guard) { p.rect(x + 11, y, 5, 6, "white"); p.text("G", x + 12, y, "black"); }
      if (u && this.action !== "move" && canAct(s, u, this.action, unit)) { p.frame(x, y, 16, 16, "black"); p.frame(x + 1, y + 1, 14, 14, "white"); }
    }
    const cx = X + this.cursor.x * T, cy = Y + this.cursor.y * T;
    p.frame(cx, cy, 16, 16, "white"); p.line(cx + 3, cy, cx + 11, cy, "black"); p.line(cx + 3, cy + 15, cx + 11, cy + 15, "black");
    this.ui.add({ id: "board", label: "Tactical battlefield", x: X, y: Y, w: 192, h: 144, activate: () => this.tile(this.cursor), press: (x, y) => this.tile({ x: Math.floor((x - X) / T), y: Math.floor((y - Y) / T) }) });
    this.drawPanel();
    this.effects = this.effects.filter(e => e.until > this.tick);
    for (const e of this.effects) p.textOutlined(e.text, X + e.x * T + 3, Y + e.y * T - (this.reducedMotion ? 0 : Math.floor((1300 - (e.until - this.tick)) / 200)), "white");
    p.rect(6, 184, 307, 13, "black");
    const line = this.pendingTurn ? "ENEMY TURN / RESOLVING MARKED SQUARES" : this.action !== "move" ? this.tileDescription() + (this.pendingTarget ? " / SELECT AGAIN TO CONFIRM" : " / SELECT A TARGET") : this.tick < this.flashUntil ? this.flash.toUpperCase() : this.tileDescription();
    p.text(line.length > 74 ? line.slice(0, 71) + "..." : line, 10, 188, "white");
    p.text("1-3 SELECT  ARROWS MOVE CURSOR  A/S/G ACT  E END  U UNDO", 8, 203, "black");
    if (this.pendingTurn) { p.rect(39, 91, 132, 22, "black"); p.bigCenter("ENEMY TURN", 105, 99, "white"); }
  }
  private drawPanel() {
    const p = this.p, s = this.s, u = this.selectedUnit(), x = 209;
    p.rect(x - 1, 32, 104, 146, "white");
    if (u) {
      p.text(ROLES[u.role].name, x, 35, "black");
      p.rect(x, 44, 34, 34, "lime"); p.sprite(spriteBits(this.friend(u), "down", false, 0), x + 1, 45, "black", { scale: 2 });
      p.text(`HP ${u.hp}/${u.maxHp}`, x + 41, 46, "black"); p.text(`MOVE ${ROLES[u.role].move}`, x + 41, 56, "black"); p.text(`RANGE ${ROLES[u.role].range}`, x + 41, 66, "black");
      if (u.team === "enemy") {
        const intent = s.intents.find(i => i.id === u.id);
        p.text("ENEMY INTENTION", x, 86, "black");
        p.text(intent?.target ? `STRIKE ${intent.target.x + 1},${intent.target.y + 1}` : "ADVANCE NEXT TURN", x, 98, "black");
        p.text(`${ROLES[u.role].damage} BASE DAMAGE`, x, 108, "black"); p.text(u.role === "sapper" ? "HUNTS YOUR LANTERN!" : "TARGET WILL NOT MOVE", x, 120, "pink");
      } else {
        p.text(u.acted ? "ACTION SPENT" : u.moved ? "MOVED / ACTION READY" : "MOVE + ACTION READY", x, 83, u.acted ? "pink" : "black");
        this.button("attack", "A ATTACK", x, 94, 48, () => this.choose("attack"), { active: this.action === "attack", disabled: u.acted });
        this.button("skill", `S ${ROLES[u.role].skill}`, x + 52, 94, 50, () => this.choose("skill"), { active: this.action === "skill", disabled: u.acted || u.role === "ranger" && u.moved });
        this.button("guard", "G GUARD", x, 111, 48, () => this.choose("guard"), { disabled: u.acted });
        this.button("undo", "U UNDO", x + 52, 111, 50, () => this.undo());
        const hint = this.action === "skill" ? u.role === "warden" ? ["PUSH FOE ONE TILE.", "WATER = INSTANT KO."] : u.role === "ranger" ? ["PIERCE: +1 DAMAGE.", "MUST NOT HAVE MOVED."] : ["HEAL ALLY +3 HP.", "RANGE 2. NO DAMAGE."] : u.acted ? ["PICK ANOTHER FRIEND", "OR END YOUR TURN."] : s.mission === 0 && s.turn === 1 && u.id === "pip" ? ["TRY: MOVE ONE RIGHT", "THEN SHOVE THE SCOUT"] : ["DOTTED TILES: MOVE", "A / S: PICK A TARGET"];
        hint.forEach((line, i) => p.text(line, x, 130 + i * 8, "black"));
      }
    }
    this.button("end", this.confirmEnd ? "CONFIRM END?" : "E END TURN", x, 150, 102, () => this.end(), { active: true });
    this.button("help", "H HELP", x, 166, 32, () => this.help(), { h: 11 });
    this.button("log", "L LOG", x + 35, 166, 32, () => this.openReport(), { h: 11 });
    this.button("retry", this.confirmRetry ? "SURE?" : "RETRY", x + 70, 166, 32, () => this.retry(), { h: 11 });
  }
  private drawHelp() {
    const p = this.p; this.header("FIELD GUIDE", "H / ESC TO RETURN");
    const entries = [
      ["01 / MOVE, THEN ACT", "Select a friend (1/2/3). Dotted tiles are legal moves.", "Move once, then attack, use a skill, or guard."],
      ["02 / READ THE ENEMY", "Enemy ! squares are locked attacks. Move out to dodge.", "A defeated enemy cannot strike. No counterattacks."],
      ["03 / MAKE THE MAP YOUR WEAPON", "Warden SHOVE: push one tile. Water KO; collision +2.", "Ranger PIERCE: +1 damage, ignores trees; no move first."],
      ["04 / KEEP YOUR FRIENDS CLOSE", "Mender heals 3 HP at range 2. Guard reduces hits by 2.", "Forest: 1 armor, move cost 2. Shrine: heal 1 per night."],
      ["05 / A BETTER PLAN IS ALWAYS ONE TURN AWAY", "Arrows + Enter: target. A/S/G: action. E: end turn.", "U: undo. R: retry. L: turn report. M: sound."],
    ];
    entries.forEach(([title, a, b], i) => { const y = 27 + i * 30; p.big(title, 10, y, "black"); p.text(a.toUpperCase(), 10, y + 11, "black"); p.text(b.toUpperCase(), 10, y + 19, "black"); });
    this.button("back", "BACK TO THE ROAD", 10, 184, 177, () => this.go(this.helpBack), { active: true, h: 18 });
    this.button("sound", this.muted ? "SOUND OFF" : "SOUND ON", 204, 184, 105, () => this.setMuted(!this.muted), { h: 18 });
  }
  private drawResult() {
    const p = this.p, won = this.s.result === "won", earned = medals(this.s);
    this.header(won ? "A LIGHT REKINDLED" : "THE LIGHT FADES", `CHAPTER ${this.s.mission + 1}/4`);
    p.bigCenter(won ? MISSIONS[this.s.mission].name : "EVEN FRIENDS NEED A SECOND TRY", 159, 33, "black");
    p.textCenter(won ? "THE ROAD REMEMBERS WHAT YOU DID HERE." : this.s.lantern <= 0 ? "THE LANTERN FELL. INTERCEPT THE MARKED ATTACKS." : "THE SQUAD FELL. DODGE THE MARKED SQUARES.", 159, 48, "black");
    const labels = ["LIGHT THE WAY", "ALL FRIENDS HOME", `WITHIN ${MISSIONS[this.s.mission].par} TURNS`];
    labels.forEach((label, i) => {
      const x = 13 + i * 102; p.frame(x, 66, 94, 61, "black"); p.rect(x + 3, 69, 88, 55, earned[i] ? "lime" : "white");
      p.bigCenter(earned[i] ? "+" : "-", x + 47, 80, "black"); p.textCenter(label, x + 47, 102, "black"); p.textCenter(earned[i] ? "EARNED" : "TRY AGAIN", x + 47, 114, "pink");
    });
    p.textCenter(`${turnsUsed(this.s)} TURNS  /  ${this.s.lost} FRIENDS LOST  /  LANTERN ${this.s.lantern}/8`, 159, 141, "black");
    p.textCenter(won ? "A PERFECT PLAN IS OPTIONAL. KEEP GOING." : "UNDO IS FREE DURING YOUR TURN. USE IT TO EXPERIMENT.", 159, 155, "black");
    this.button("next", won ? this.s.mission === 3 ? "DAWN AWAITS" : "NEXT CHAPTER" : "TRY AGAIN", 16, 177, 177, () => won ? this.s.mission === 3 ? this.go("ending") : this.begin(this.s.mission + 1) : this.begin(this.s.mission), { active: true, h: 20 });
    this.button("replay", won ? "REPLAY" : "FIELD GUIDE", 208, 177, 96, () => won ? this.begin(this.s.mission) : this.help(), { h: 20 });
    this.button("chapters", "C CHAPTER SELECT", 100, 200, 120, () => this.chapters(), { h: 11 });
  }
  private drawEnding() {
    const p = this.p; this.landscape(); p.rect(17, 17, 199, 70, "white"); p.frame(19, 19, 195, 66, "black");
    p.big("AND SO CAME THE DAWN.", 27, 29, "black");
    p.text("THE LANTERNS ARE LIT.", 27, 46, "black"); p.text("THE ROAD IS OURS AGAIN.", 27, 57, "black"); p.text("NOBODY WALKS IT ALONE.", 27, 68, "black");
    p.textCenter(`${this.scores.flat().filter(Boolean).length}/12 MEDALS / THE LANTERN ROAD COMPLETE`, 159, 158, "black");
    this.button("again", "CHAPTER SELECT / CHASE MEDALS", 50, 176, 219, () => this.chapters(), { active: true, h: 20 });
    p.textCenter("REAL FRENEMIES / THANK YOU FOR PLAYING", 159, 204, "black");
  }
  private drawReport() {
    const p = this.p; this.header("LAST ENEMY TURN", "L / ESC TO RETURN");
    p.text("EVERY STRIKE, MISS AND REINFORCEMENT.", 12, 28, "black");
    const lines = this.report.length ? this.report : ["No enemy turn yet. End turn to resolve marked squares."];
    lines.slice(0, 10).forEach((line, i) => { p.rect(10, 42 + i * 13, 299, 11, i % 2 ? "white" : "lime"); p.text(line.toUpperCase(), 14, 45 + i * 13, "black"); });
    this.button("back", "RETURN TO THE ROAD", 50, 185, 219, () => this.go(this.reportBack), { active: true, h: 18 });
  }
  private drawChapters() {
    const p = this.p; this.header("THE LANTERN ROAD", `${this.scores.flat().filter(Boolean).length}/12 MEDALS`);
    p.text("REVISIT A CHAPTER. YOUR BEST MEDALS ARE KEPT.", 12, 28, "black");
    MISSIONS.forEach((m, i) => {
      this.button(`chapter${i}`, `${i + 1} ${m.name}`, 12, 44 + i * 32, 218, () => this.begin(i), { active: i === this.chapterPick, disabled: i > this.unlocked, h: 25 });
      p.text(i > this.unlocked ? "LOCKED" : `${this.scores[i]?.filter(Boolean).length ?? 0}/3 MEDALS`, 244, 54 + i * 32, "black");
    });
    this.button("title", "BACK TO TITLE", 12, 185, 135, () => this.go("title"), { h: 18 });
    p.text("ARROWS PICK / ENTER PLAY", 169, 190, "black");
  }
}
