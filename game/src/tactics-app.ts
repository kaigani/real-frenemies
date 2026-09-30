import type { AppHost } from "./app.ts";
import { POOL, type Friend } from "./friends.ts";
import { readFriend } from "./onchain.ts";
import { Painter } from "./render/draw.ts";
import { TacticsView, MAP_X as X, MAP_Y as Y, MAP_TILE as T, type ViewPage } from "./tactics-view.ts";
import { Ui } from "./ui.ts";
import { act, at, canAct, copyBattle, createBattle, endTurn, forecast, LANTERN, living, medals, MISSIONS, move, objective, ROLES, same, SIGNAL, terrain, turnsUsed, type Action, type Point, type Unit } from "./tactics.ts";

type Page = ViewPage;
/** Cartridge campaign. Also owns the shared main menu and guide. */
export class TacticsApp {
  private p: Painter;
  private view: TacticsView;
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
  private active = true;
  private campaignReturn: Page | null = null;
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
  private onBattle: () => void;
  constructor(ctx: CanvasRenderingContext2D, host: AppHost, onBattle: () => void = () => {}) { this.p = new Painter(ctx); this.host = host; this.onBattle = onBattle; this.view = new TacticsView(this.p, this.ui, { command: (id, value) => this.command(id, value), tile: p => this.tile(p) }); }
  start() {
    const loop = (t: number) => { if (this.active) { this.tick = t; this.draw(); } this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    void Promise.all([readFriend(this.host.friendId), this.view.art.load()]).then(([friend]) => {
      if (this.disposed) return;
      this.commander = friend; this.go("title"); this.say("Real Frenemies. Main menu: PvP Battle, Campaign, Guide.");
    }).catch(() => { if (!this.disposed) { this.go("error"); this.say("Could not load the adventure. Use Retry to try again."); } });
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.raf); }
  setActive(on: boolean) { this.active = on; if (on) { this.emit(); this.draw(); } }
  showMenu() { const resume = this.page === "help" ? this.helpBack : this.page === "log" ? this.reportBack : this.page; if (!["title", "guide", "loading", "error"].includes(resume)) this.campaignReturn = resume; this.go("title"); this.say("Main menu: PvP Battle, Campaign, Guide. Progress is kept for this session."); }
  enterCampaign() { if (this.campaignReturn) { this.go(this.campaignReturn); this.say("Campaign resumed. " + this.summary()); } else this.begin(0); }
  showGuide() { this.go("guide"); this.say("Guide. Battle: build, raid and defend. Campaign: The Lantern Road. Choose a field guide for detailed controls."); }
  chooseMode(mode: "battle" | "campaign" | "guide") { if (mode === "battle") this.onBattle(); else if (mode === "campaign") this.enterCampaign(); else this.showGuide(); }
  setPaused(on: boolean) { this.paused = on; }
  setReducedMotion(on: boolean) { this.reducedMotion = on; this.emit(); }
  setMuted(on: boolean) { this.muted = on; this.host.setMuted(on); this.emit(); }
  private emit() { this.host.onState?.({ muted: this.muted, reducedMotion: this.reducedMotion, screen: `tactics-${this.page}` }); }
  private go(page: Page) { this.page = page; this.ui.focusId = null; this.confirmEnd = false; this.confirmRetry = false; this.emit(); }
  private say(text: string) { this.host.announce(text); }
  private note(text: string) { this.flash = text; this.flashUntil = this.tick + 3200; this.say(text); }
  private begin(mission: number) { this.pendingTurn = false; this.s = createBattle(mission); this.checkpoint = copyBattle(this.s); this.selected = "pip"; this.action = "move"; this.pendingTarget = null; this.report = []; this.effects = []; this.cursor = { x: 3, y: 3 }; this.go("brief"); this.say(`${MISSIONS[mission].name}. ${MISSIONS[mission].brief.join(" ")}`); }
  private enterBattle() { this.go("battle"); this.say(`${objective(this.s)}. Select a friend, then a dotted square to move. A attacks, S uses a skill, G guards, E ends the turn. Enemy marked squares are locked.`); }
  private selectedUnit() { return living(this.s).find(u => u.id === this.selected); }
  summary() { const u = this.selectedUnit(); return this.page === "title" ? "REAL FRENEMIES / PVP BATTLE / CAMPAIGN / GUIDE" : this.page === "guide" ? "GUIDE / CHOOSE YOUR ADVENTURE" : this.page === "battle" ? `Turn ${this.s.turn} · ${objective(this.s)} · Lantern ${this.s.lantern}/8${u ? ` · ${ROLES[u.role].name}: ${u.hp}/${u.maxHp} HP` : ""}` : "THE LANTERN ROAD · FOUR CHAPTER CAMPAIGN"; }
  private select(u: Unit) { this.selected = u.id; this.cursor = { x: u.x, y: u.y }; this.action = "move"; this.pendingTarget = null; this.ui.focusId = null; this.confirmEnd = false; this.host.play("select"); this.say(`${ROLES[u.role].name}, ${u.hp} of ${u.maxHp} HP. ${u.acted ? "Action spent." : "Ready."}`); }
  hover(x: number, y: number) { if (this.page === "battle" && x >= X && x < X + 12 * T && y >= Y && y < Y + 9 * T) this.cursor = { x: Math.floor((x - X) / T), y: Math.floor((y - Y) / T) }; }
  pointer(x: number, y: number) { if (!this.paused && (!this.pendingTurn || this.page !== "battle" || (x >= 550 && y < 22))) this.ui.press(Math.floor(x), Math.floor(y)); }
  private tile(p: Point) {
    if (this.pendingTurn) return;
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
    if (this.paused) return false;
    if (e.key === "Home") { this.showMenu(); return true; }
    if (this.pendingTurn && this.page === "battle") return false;
    const k = e.key.toLowerCase();
    if (k === "tab") return this.ui.step(e.shiftKey ? -1 : 1);
    if (k === "m") { this.setMuted(!this.muted); return true; }
    if (k === "h" || k === "?") { this.page === "title" ? this.showGuide() : this.page === "help" ? this.go(this.helpBack) : this.help(); return true; }
    if (k === "l" && ["battle", "result", "log"].includes(this.page)) { this.page === "log" ? this.go(this.reportBack) : this.openReport(); return true; }
    if (k === "c" && ["ending", "result", "title"].includes(this.page)) { this.chapters(); return true; }
    if (k === "escape") {
      if (this.page === "help") this.go(this.helpBack);
      else if (this.page === "log") this.go(this.reportBack);
      else if (["chapters", "guide", "brief", "result", "ending"].includes(this.page)) this.showMenu();
      else if (this.page === "battle") { this.action = "move"; this.confirmEnd = false; this.confirmRetry = false; }
      return true;
    }
    if (k === "enter" || k === " ") {
      if (this.ui.current()) this.ui.activate();
      else if (this.page === "title") this.onBattle();
      else if (this.page === "guide") this.help();
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
  private command(id: string, value?: number) {
    if (this.paused) return;
    if (id === "main-menu" || id === "title") { this.showMenu(); return; }
    if (this.pendingTurn && this.page === "battle") return;
    if (id.startsWith("chapter") && value !== undefined) { this.begin(value); return; }
    switch (id) {
      case "battle-mode": this.onBattle(); break;
      case "campaign-mode": this.enterCampaign(); break;
      case "main-guide": this.showGuide(); break;
      case "guide": case "help": this.help(); break;
      case "begin": this.enterBattle(); break;
      case "attack": case "skill": case "guard": this.choose(id); break;
      case "undo": this.undo(); break;
      case "end": this.end(); break;
      case "log": this.openReport(); break;
      case "retry": this.retry(); break;
      case "chapters": this.chapters(); break;
      case "sound": this.setMuted(!this.muted); break;
      case "back": this.go(this.page === "help" ? this.helpBack : this.reportBack); break;
      case "next": this.s.result === "won" ? this.s.mission === 3 ? this.go("ending") : this.begin(this.s.mission + 1) : this.begin(this.s.mission); break;
      case "replay": this.s.result === "won" ? this.begin(this.s.mission) : this.help(); break;
      case "retry-load": this.dispose(); this.disposed = false; this.start(); break;
    }
  }
  private draw() {
    if (this.page === "battle" && this.pendingTurn && this.tick >= this.enemyUntil && !this.paused) {
      this.pendingTurn = false;
      const before = copyBattle(this.s); this.report = [...endTurn(this.s)];
      for (const old of before.units) { const next = this.s.units.find(u => u.id === old.id); if (next && next.hp !== old.hp) this.effects.push({ x: old.x, y: old.y, text: next.hp <= 0 ? "KO" : `${next.hp > old.hp ? "+" : ""}${next.hp - old.hp}`, until: this.tick + 1300 }); }
      this.checkpoint = copyBattle(this.s); this.action = "move";
      if (!this.selectedUnit() || this.selectedUnit()?.team !== "ally") this.selected = living(this.s, "ally")[0]?.id ?? "pip";
      this.note(this.s.log.join(" ")); this.changed();
    }
    this.effects = this.effects.filter(e => e.until > this.tick);
    this.view.draw({ page: this.page, s: this.s, selected: this.selectedUnit(), cursor: this.cursor, action: this.action, tick: this.tick,
      reducedMotion: this.reducedMotion, pendingTurn: this.pendingTurn, pendingTarget: this.pendingTarget, confirmEnd: this.confirmEnd, confirmRetry: this.confirmRetry,
      flash: this.flash, flashUntil: this.flashUntil, effects: this.effects, scores: this.scores, report: this.report,
      chapterPick: this.chapterPick, unlocked: this.unlocked, muted: this.muted, commander: this.commander, description: this.tileDescription() });
  }
}
