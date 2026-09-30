/**
 * Real Frenemies versus renderer. Native-detail 640 × 480 art, a logical UI grid and chunky canonical icons.
 * The React adapter supplies accessible mirrors and a responsive touch command deck.
 */
import { feeFor, formatRf, rf, stakeAt } from "./economy.ts";
import { friendLabel, POOL, POOL_SOURCE, spriteBits, type Facing, type Friend } from "./friends.ts";
import type { Rival } from "./ghosts.ts";
import { readBlockNumber, readFriend } from "./onchain.ts";
import { describe, Replay, type UnitView } from "./replay.ts";
import { AFFINITY, BLOCKS_PER_DAY, CLAIM_COST, CLASSES, EXPAND_COST, FLOOR_RULES, GARRISON_FOR_BONUS, GRID_H, GRID_W, LANE_ROWS, MAX_GARRISON, MAX_RAIDERS, REBUILD_NIGHTS, RECLAIM_COST, REGION_BONUS, ROUND_DAYS, SUPPLY_PER_REGION, TICKS_PER_SECOND, unitStats } from "./rules.ts";
import { explain } from "./explain.ts";
import { routeOf, Session, type Held, type Incoming, type NightReport, type RaidRecord, type Snapshot } from "./session.ts";
import type { SimEvent } from "./sim.ts";
import { buildable, tileAt, WALL_HP, type Board } from "./terrain.ts";
import { garrisoned, regionKey, regionName, YOU, type Piece, type Region, type Territory } from "./territory.ts";
import { Painter, type Color } from "./render/draw.ts";
import { LINE_H, textWidth, wrap } from "./render/font.ts";
import { bigWidth } from "./render/bigfont.ts";
import { TILE, TILE_NAMES } from "./render/tiles.ts";
import { VersusArt } from "./render/versus-art.ts";
import { Ui, type Widget } from "./ui.ts";

/** Both game modes share the native display; versus UI coordinates are doubled while drawing. */
export const NATIVE_W = 640;
export const NATIVE_H = 480;
const LOGICAL_W = 320, LOGICAL_H = 240;
/** Simulated opening balance: enough for one expansion (250 RF) plus a garrison. */
export const START_BALANCE = rf(500);
const BX = 4, BY = 14;
const PX = 200, PY = 14, PW = 116, PH = 128;
const STRIP_Y = 146;
const BAR_Y = 185;
const HINT_Y = 204;

export type Cue = "select" | "purchase" | "action-start" | "action-ready" | "anticipation" | "impact" | "reveal-common" | "reveal-rare" | "reward";
export type AppHost = {
  friendId: bigint;
  play(cue: Cue): void;
  setMuted(muted: boolean): void;
  announce(text: string): void;
  onState?(state: { muted: boolean; reducedMotion: boolean; screen: string }): void;
};

type Selection = { kind: "recruit"; friend: Friend } | { kind: "piece"; key: string } | { kind: "core" } | { kind: "tile" } | null;
type Target = { kind: "rival"; index: number } | { kind: "reclaim"; key: string } | { kind: "practice"; snapshot: Snapshot };
type Queue = { report: NightReport; index: number };
type PlaybackScreen = { kind: "playback"; record: RaidRecord; battle: number; replay: Replay; tau: number; playing: boolean; speed: 1 | 2; lastFeedTick: number; cuedEnd: boolean; endedAt: number; queue: Queue | null };
type Screen =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "build" }
  | { kind: "territory"; sel: { dx: number; dy: number } | null }
  | { kind: "scout" }
  | { kind: "setup"; target: Target; picks: string[]; lane: number; view: number; inspect: number | null; route: string[]; page: number }
  | PlaybackScreen
  | { kind: "result"; record: RaidRecord; queue: Queue | null }
  | { kind: "incoming"; preview: Incoming | null }
  | { kind: "morning"; report: NightReport }
  | { kind: "round" }
  | { kind: "help"; page: number; back: Screen };

export class App {
  private readonly p: Painter;
  private readonly art: VersusArt;
  private readonly ui = new Ui();
  private readonly host: AppHost;
  private session: Session | null = null;
  private screen: Screen = { kind: "loading" };
  private cursor = { x: 6, y: 3 };
  private selection: Selection = null;
  private buildId = `${YOU}/0,0`;
  private rosterIndex = 0;
  private rosterPage = 0;
  private toast = { text: "", until: 0 };
  private now = 0;
  private lastFrame = 0;
  private paused = false;
  muted = true;
  reducedMotion = false;
  private raf = 0;
  private loadToken = 0;
  private lastImpact = 0;

  constructor(ctx: CanvasRenderingContext2D, host: AppHost) {
    // The compact 3x5 font is drawn at exactly 2x with the logical UI, never resampled into a different grid.
    this.p = new Painter(ctx);
    this.art = new VersusArt(ctx);
    this.host = host;
  }

  start() {
    const loop = (t: number) => { this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    void this.load();
  }

  dispose() { cancelAnimationFrame(this.raf); this.loadToken++; }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused && this.screen.kind === "playback") this.screen.playing = false;
  }

  setReducedMotion(on: boolean) { this.reducedMotion = on; this.emitState(); }
  setMuted(on: boolean) { this.muted = on; this.host.setMuted(on); this.emitState(); }
  private emitState() { this.host.onState?.({ muted: this.muted, reducedMotion: this.reducedMotion, screen: this.screen.kind }); }

  private async load() {
    const token = ++this.loadToken;
    this.go({ kind: "loading" });
    try {
      const [player, block] = await Promise.all([readFriend(this.host.friendId), readBlockNumber(), this.art.load()]);
      if (token !== this.loadToken) return;
      if (player.generation < 1) throw new Error("This Friend is Temporary (generation 0) and can't anchor a base.");
      this.session = new Session(player, POOL, START_BALANCE, block ?? 0);
      const home = this.session.home();
      this.cursor = { x: home.board.core.x - 3, y: home.board.core.y };
      this.buildId = `${YOU}/0,0`;
      this.selection = { kind: "core" };
      this.go({ kind: "help", page: 0, back: { kind: "build" } });
      this.host.announce(`Base loaded for Friend ${player.tokenId}, a ${player.character} on ${player.scenery} terrain.${block === null ? " Block number unavailable; the round clock starts at block 0." : ""}`);
    } catch (cause) {
      if (token !== this.loadToken) return;
      const message = cause instanceof Error ? cause.message : "Could not read your Friend.";
      this.go({ kind: "error", message });
      this.host.announce(`Error: ${message}`);
    }
  }

  private go(screen: Screen) {
    this.screen = screen;
    this.toast = { text: "", until: 0 };
    this.ui.focusId = null;
    this.emitState();
  }

  private say(text: string, cue?: Cue) {
    this.toast = { text, until: this.now + 2600 };
    this.host.announce(text);
    if (cue) this.host.play(cue);
  }

  /** The region the build screen shows; falls back to home when the previous one was lost. */
  private held(): Held {
    const s = this.session!;
    return s.heldById(this.buildId) ?? s.held()[0];
  }

  // ------------------------------------------------------------------ input

  pointer(x: number, y: number) {
    if (this.paused) return;
    this.ui.press(Math.floor(x / 2), Math.floor(y / 2));
    this.emitState();
  }

  summary() { return this.session ? `VERSUS / DAY ${this.session.day} / ${formatRf(this.session.ledger.balance)} SIM RF` : "PREPARING YOUR TERRITORY"; }

  key(event: KeyboardEvent): boolean {
    if (this.paused) return false;
    const k = event.key;
    if (k === "Tab") return this.ui.step(event.shiftKey ? -1 : 1);
    if (k === "Enter" || (k === " " && this.screen.kind !== "playback")) { this.ui.keyboard = true; this.ui.activate(); return true; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (this.screen.kind === "playback") {
      const s = this.screen;
      if (k === " ") { this.togglePlay(s); return true; }
      if (k === "ArrowLeft") { this.seek(s, -2 * TICKS_PER_SECOND); return true; }
      if (k === "ArrowRight") { this.seek(s, 2 * TICKS_PER_SECOND); return true; }
      if (k.toLowerCase() === "f") { s.speed = s.speed === 1 ? 2 : 1; return true; }
      if (k === "Escape") { this.finishPlayback(s); return true; }
    }
    if (arrows[k]) { this.ui.arrow(...arrows[k]); return true; }
    const lower = k.toLowerCase();
    if (lower === "m") { this.setMuted(!this.muted); return true; }
    if (lower === "h" || k === "?") { this.openHelp(); return true; }
    if (k === "Escape") { this.back(); return true; }
    if (!this.session) return false;
    if (this.screen.kind === "build") {
      if (lower === "r") { this.toScout(); return true; }
      if (lower === "e") { this.endDay(); return true; }
      if (lower === "l") { this.levelSelected(); return true; }
      if (lower === "x") { this.removeSelected(); return true; }
      if (k === "[" || k === "]") { this.cycleRegion(k === "]" ? 1 : -1); return true; }
    }
    if (["build", "territory", "scout", "round"].includes(this.screen.kind)) {
      if (lower === "t") { this.go({ kind: "territory", sel: null }); return true; }
      if (lower === "o") { this.go({ kind: "round" }); return true; }
    }
    return false;
  }

  private back() {
    const s = this.screen;
    if (s.kind === "help") this.go(s.back);
    else if (s.kind === "scout" || s.kind === "territory" || s.kind === "round") this.go({ kind: "build" });
    else if (s.kind === "setup") s.inspect !== null ? (s.inspect = null) : this.go(s.target.kind === "rival" ? { kind: "scout" } : { kind: "territory", sel: null });
    else if (s.kind === "build") this.selection = null;
  }

  private openHelp() {
    const s = this.screen;
    if (s.kind === "help" || s.kind === "loading" || s.kind === "error") return;
    if (s.kind === "playback") s.playing = false;
    this.go({ kind: "help", page: 0, back: s });
  }

  // ------------------------------------------------------------------ actions

  private tryAction(work: () => void, ok?: string, cue?: Cue) {
    try { work(); if (ok) this.say(ok, cue); }
    catch (cause) { this.say(cause instanceof Error ? cause.message : "That didn't work."); }
  }

  private cycleRegion(dir: 1 | -1) {
    const s = this.session!, list = s.held();
    const i = list.findIndex(h => h.id === this.buildId);
    const next = list[(i + dir + list.length) % list.length];
    this.buildId = next.id;
    this.selection = null;
    this.host.announce(`${regionName(next.region)}${next.rival ? ` at ${next.rival.name}` : ""}: ${next.region.garrison.length} pieces.`);
    this.host.play("select");
  }

  private clickTile(x: number, y: number) {
    const s = this.session!, held = this.held();
    this.cursor = { x, y };
    const sel = this.selection, region = held.region;
    const piece = region.garrison.find(p => p.x === x && p.y === y);
    if (region.home && held.territory.owner === YOU && x === region.board.core.x && y === region.board.core.y) { this.selection = { kind: "core" }; this.host.play("select"); return; }
    if (piece) { this.selection = { kind: "piece", key: piece.key }; this.host.play("select"); return; }
    if (sel?.kind === "recruit" && buildable(region.board, x, y)) {
      this.tryAction(() => {
        const placed = s.place(held, sel.friend, x, y);
        this.selection = { kind: "piece", key: placed.key };
      }, `Placed ${friendLabel(sel.friend)} for 1 simulated RF.`, "purchase");
      return;
    }
    if (sel?.kind === "piece" && buildable(region.board, x, y) && !s.away.has(sel.key) && region.garrison.some(p => p.key === sel.key)) {
      this.tryAction(() => s.move(sel.key, x, y), "Moved.", "select");
      return;
    }
    this.selection = { kind: "tile" };
  }

  private levelSelected() {
    const s = this.session!, sel = this.selection;
    if (sel?.kind === "core") {
      const cost = s.levelCost(s.coreLevel);
      if (!s.coreLevel) this.tryAction(() => s.activateCore(), "Core activated for 1 simulated RF.", "purchase");
      else if (cost !== null) this.tryAction(() => s.levelUpCore(), `Core is level ${s.coreLevel + 1}.`, "purchase");
    } else if (sel?.kind === "piece") {
      this.tryAction(() => s.levelUp(sel.key), `${sel.key} is level ${(s.piece(sel.key)?.level ?? 0) + 1}.`, "purchase");
    }
  }

  private removeSelected() {
    const s = this.session!, sel = this.selection;
    if (sel?.kind !== "piece") return;
    const piece = s.piece(sel.key);
    if (!piece) return;
    this.tryAction(() => { s.remove(sel.key); this.selection = { kind: "recruit", friend: piece.friend }; },
      `Removed ${sel.key}; ${formatRf(stakeAt(piece.level))} RF returned.`, "select");
  }

  private toScout() {
    const s = this.session!;
    if (s.raidedToday) { this.say("You already raided today. End the day to defend."); return; }
    if (!s.coreLevel) { this.say("Activate your Core first."); return; }
    this.go({ kind: "scout" });
    this.host.play("select");
  }

  private toSetup(target: Target, picks?: readonly string[]) {
    const s = this.session!;
    const available = [...s.pieces()].filter(p => target.kind === "practice" || !s.away.has(p.key)).sort((a, b) => b.level - a.level);
    const chosen = picks?.filter(k => available.some(p => p.key === k)) ?? available.slice(0, MAX_RAIDERS).map(p => p.key);
    this.go({ kind: "setup", target, picks: chosen, lane: 1, view: 0, inspect: null, route: this.setupRegions(target).regions.map(r => r.key), page: 0 });
    this.host.play("select");
  }

  private endDay() {
    const s = this.session!;
    if (!s.coreLevel && !s.isProtected(YOU)) { this.say(s.broke ? "Out of simulated RF: restart from the help menu." : "Activate your Core before ending the day."); return; }
    this.go({ kind: "incoming", preview: s.incoming() });
    this.host.play("anticipation");
  }

  private runNight() {
    const s = this.session!;
    this.tryAction(() => {
      const report = s.endDay();
      this.playQueue({ report, index: 0 });
    });
  }

  private playQueue(queue: Queue) {
    const record = queue.report.records[queue.index];
    if (record) this.startPlayback(record, queue);
    else this.morning(queue.report);
  }

  private morning(report: NightReport) {
    this.go({ kind: "morning", report });
    this.host.play("action-ready");
    this.host.announce(`Day ${this.session!.day}. ${report.news.join(" ")}`);
  }

  private launch(setup: Extract<Screen, { kind: "setup" }>) {
    const s = this.session!;
    this.tryAction(() => {
      const t = setup.target;
      const record = t.kind === "rival" ? s.raid(t.index, setup.picks, setup.lane, setup.route)
        : t.kind === "reclaim" ? s.reclaimRaid(t.key, setup.picks, setup.lane)
        : s.practice(t.snapshot, setup.picks, setup.lane, setup.route);
      this.startPlayback(record, null);
    });
  }

  private startPlayback(record: RaidRecord, queue: Queue | null) {
    const first = record.campaign.battles[0];
    if (!first) { this.go({ kind: "result", record, queue }); return; }
    this.go({ kind: "playback", record, battle: 0, replay: new Replay(first.result, first.board), tau: 0, playing: true, speed: 1, lastFeedTick: -1, cuedEnd: false, endedAt: 0, queue });
    this.host.play("action-start");
    this.host.announce(`${record.title}. ${record.campaign.battles.length} region${record.campaign.battles.length === 1 ? "" : "s"} to fight.`);
  }

  private nextBattle(s: PlaybackScreen) {
    const b = s.record.campaign.battles[s.battle + 1];
    if (!b) return;
    s.battle++; s.replay = new Replay(b.result, b.board); s.tau = 0; s.lastFeedTick = -1; s.cuedEnd = false; s.endedAt = 0; s.playing = true;
    this.host.announce(`Region ${s.battle + 1} of ${s.record.campaign.battles.length}: ${b.name}.`);
  }

  private finishPlayback(s: PlaybackScreen) {
    this.go({ kind: "result", record: s.record, queue: s.queue });
    const r = s.record;
    const won = r.attacker === YOU ? r.campaign.won : !r.campaign.won;
    this.host.play(won ? "reveal-rare" : "reveal-common");
    this.host.announce(`${resultTitle(r)}. Net ${formatRf(r.net, true)} simulated RF.`);
  }

  private togglePlay(s: PlaybackScreen) {
    if (s.tau >= s.replay.length - 1) { s.tau = 0; s.lastFeedTick = -1; s.cuedEnd = false; s.endedAt = 0; }
    s.playing = !s.playing;
  }

  private seek(s: PlaybackScreen, ticks: number) {
    s.tau = Math.max(0, Math.min(s.replay.length - 1, Math.floor(s.tau) + ticks));
    s.lastFeedTick = Math.floor(s.tau);
  }

  private afterResult(record: RaidRecord, queue: Queue | null) {
    if (queue) { this.playQueue({ report: queue.report, index: queue.index + 1 }); return; }
    if (record.kind === "practice" || record.kind === "reclaim") { this.go({ kind: "build" }); return; }
    this.endDay();
  }

  // ------------------------------------------------------------------ frame

  private frame(t: number) {
    const dt = this.lastFrame ? Math.min(100, t - this.lastFrame) : 0;
    this.lastFrame = t;
    this.now = t;
    const s = this.screen;
    if (s.kind === "playback" && !this.paused) {
      if (s.playing) {
        const rate = this.reducedMotion ? 4 : TICKS_PER_SECOND * s.speed;
        s.tau = Math.min(s.replay.length - 1, s.tau + (dt / 1000) * rate);
        if (s.tau >= s.replay.length - 1) { s.playing = false; s.endedAt = t; }
        this.playbackCues(s);
      } else if (s.endedAt && s.tau >= s.replay.length - 1 && s.battle < s.record.campaign.battles.length - 1 && t - s.endedAt > 1400) {
        this.nextBattle(s);
      }
    }
    this.render();
  }

  private playbackCues(s: PlaybackScreen) {
    const tick = Math.floor(s.tau);
    if (tick <= s.lastFeedTick) return;
    const result = s.record.campaign.battles[s.battle].result;
    for (const e of result.events) {
      if (e.t <= s.lastFeedTick || e.t > tick) continue;
      if (e.e === "hit" && !e.miss && e.dmg > 0 && this.now - this.lastImpact > 180) { this.host.play("impact"); this.lastImpact = this.now; }
      if (e.e === "ko" && result.units[e.id].core) this.host.play("reveal-rare");
    }
    s.lastFeedTick = tick;
    if (!s.cuedEnd && tick >= s.replay.length - 1) {
      s.cuedEnd = true;
      this.host.announce(describe(result.events.at(-1)!, () => "") ?? "Battle over.");
    }
  }

  private get anim() { return this.reducedMotion ? 0 : Math.floor(this.now / 250); }

  private render() {
    const p = this.p;
    p.ctx.save(); p.ctx.scale(2, 2);
    this.ui.begin();
    p.rect(0, 0, LOGICAL_W, LOGICAL_H, "white");
    if (["build", "setup", "playback", "result", "incoming"].includes(this.screen.kind)) p.rect(199, 12, 120, 133, "lime");
    this.drawTopBar();
    switch (this.screen.kind) {
      case "loading": this.drawCenterMessage("READING YOUR FRIEND ON CHAIN…", "Traits, sprite and block height from Robinhood mainnet"); break;
      case "error": this.drawError(this.screen.message); break;
      case "build": this.drawBuild(); break;
      case "territory": this.drawTerritory(this.screen); break;
      case "scout": this.drawScout(); break;
      case "setup": this.drawSetup(this.screen); break;
      case "playback": this.drawPlayback(this.screen); break;
      case "result": this.drawResult(this.screen.record, this.screen.queue); break;
      case "incoming": this.drawIncoming(this.screen.preview); break;
      case "morning": this.drawMorning(this.screen.report); break;
      case "round": this.drawRound(); break;
      case "help": this.drawHelp(this.screen); break;
    }
    if (this.toast.text && this.now < this.toast.until) {
      const lines = wrap(this.toast.text.toUpperCase(), 176);
      const h = lines.length * LINE_H + 4, y = BY + 3;
      p.rect(BX + 5, y, 184, h, "black");
      p.rect(BX + 4, y + 1, 186, h - 2, "black");
      p.rect(BX + 6, y + 2, 2, h - 4, "lime");
      p.lines(lines, BX + 11, y + 2, "white");
    }
    this.ui.settle();
    const focus = this.ui.current();
    if (focus && this.ui.keyboard) {
      p.frame(focus.x - 2, focus.y - 2, focus.w + 4, focus.h + 4, "pink");
      p.frame(focus.x - 1, focus.y - 1, focus.w + 2, focus.h + 2, "white");
    }
    this.drawDispatch();
    p.ctx.restore();
  }

  private drawDispatch() {
    const p = this.p, kind = this.screen.kind;
    const lines: Record<string, [string, string]> = {
      build: ["FORTIFY YOUR HOME", "RECRUIT A FRIEND. PLACE THEM. BUILD YOUR DEFENSE."],
      territory: ["EVERY FLAG COUNTS", "CHOOSE A REGION TO EXPAND, RECLAIM OR REINFORCE."],
      scout: ["KNOW YOUR RIVAL", "SCOUT THEIR TERRAIN BEFORE YOU COMMIT YOUR SQUAD."],
      setup: ["MAKE YOUR PLAN", "PICK YOUR RAIDERS, ENTRY LANE AND REGION ORDER."],
      playback: ["THE RAID IS UNDERWAY", "WATCH THE CLASH. PAUSE OR SEEK TO STUDY THE FIGHT."],
      result: ["EVERY RAID TEACHES", "REVIEW THE RESULT. PRACTICE THE REMATCH FOR FREE."],
      incoming: ["HOLD THE LINE", "YOUR GARRISON STANDS AGAINST TONIGHT'S RAIDERS."],
      morning: ["A NEW DAY", "CHECK YOUR LOSSES. REBUILD. PLAN YOUR NEXT RAID."],
      round: ["THE RACE FOR THE POT", "WIN RIVAL TERRITORIES TO CLIMB THE STANDINGS."],
      help: ["WELCOME, COMMANDER", "BUILD BY DAY. DEFEND BY NIGHT. OUTPLAN YOUR RIVALS."],
    };
    const copy = lines[kind] ?? ["REAL FRENEMIES", "YOUR FRIEND. YOUR TERRITORY. YOUR NEXT MOVE."];
    p.panel(3, 214, 312, 23); p.frame(5, 216, 308, 19, "pink");
    this.art.portrait(kind === "scout" || kind === "setup" ? 1 : kind === "incoming" || kind === "playback" ? 3 : 0, 6, 212, 26);
    p.rect(34, 217, 1, 17, "black"); p.big(copy[0], 40, 217, "black");
    p.text(copy[1], 40, 228, "pink");
  }

  // ------------------------------------------------------------------ widgets

  private button(id: string, x: number, y: number, w: number, label: string, activate: () => void, opts: { disabled?: boolean; primary?: boolean; h?: number } = {}) {
    const p = this.p, h = opts.h ?? 11;
    const primary = opts.primary && !opts.disabled;
    p.rect(x + 1, y + 1, w - 2, h - 2, primary ? "black" : "white");
    if (opts.disabled) {
      p.withClip(x, y, w, h, () => { p.dither(x + 1, y, w - 2, 1, "black", 2); p.dither(x + 1, y + h - 1, w - 2, 1, "black", 2); p.dither(x, y + 1, 1, h - 2, "black", 2); p.dither(x + w - 1, y + 1, 1, h - 2, "black", 2); });
    } else {
      p.notch(x, y, w, h, "black");
      p.rect(x + 2, y + h, w - 2, 1, "black");
      p.rect(x + w, y + 2, 1, h - 2, "black");
      if (primary) p.rect(x + 2, y + 1, w - 4, 1, "white");
    }
    p.textCenter(label, x + Math.floor(w / 2), y + Math.floor((h - 5) / 2), primary ? "white" : opts.disabled ? "pink" : "black");
    this.ui.add({ id, x, y, w, h, label, disabled: opts.disabled, activate: () => { if (!opts.disabled) activate(); } });
  }

  private drawTopBar() {
    const p = this.p, s = this.session;
    p.rect(0, 0, LOGICAL_W, 11, "black");
    p.text("REAL", 3, 3, "lime");
    p.big("FRENEMIES", 20, 2, "white", { shadow: "pink" });
    if (s) {
      p.text(`DAY ${s.day}`, 78, 3, "lime");
      p.text(`SIM RF ${formatRf(s.ledger.balance)}`, 104, 3, "white");
      p.text(`POT ${formatRf(s.round.pot)}`, 164, 3, "lime");
      p.text(`BURN ${formatRf(s.ledger.burned)}`, 206, 3, "pink");
    }
    this.smallToggle("sound", 250, this.muted ? "SND OFF" : "SND ON", () => this.setMuted(!this.muted), `Sound ${this.muted ? "off" : "on"}`);
    this.smallToggle("motion", 284, this.reducedMotion ? "FX LOW" : "FX ON", () => this.setReducedMotion(!this.reducedMotion), `Reduced motion ${this.reducedMotion ? "on" : "off"}`);
  }

  private smallToggle(id: string, x: number, label: string, activate: () => void, name: string) {
    const p = this.p;
    p.rect(x + 1, 1, 29, 9, "white");
    p.rect(x, 2, 31, 7, "white");
    p.textCenter(label, x + 15, 3, "black");
    this.ui.add({ id, x, y: 1, w: 31, h: 9, label: name, activate });
  }

  private drawCenterMessage(title: string, sub: string) {
    const p = this.p;
    p.textCenter(title, LOGICAL_W / 2, 90, "black");
    p.textCenter(sub.toUpperCase(), LOGICAL_W / 2, 100, "black");
    const n = this.reducedMotion ? 3 : 1 + (this.anim % 3);
    for (let i = 0; i < 3; i++) p.rect(LOGICAL_W / 2 - 8 + i * 6, 112, 4, 4, i < n ? "black" : "white");
  }

  private drawError(message: string) {
    const p = this.p;
    p.textCenter("COULDN'T LOAD YOUR FRIEND", LOGICAL_W / 2, 70, "pink");
    p.lines(wrap(message.toUpperCase(), 240), 40, 84, "black");
    this.button("retry", LOGICAL_W / 2 - 30, 130, 60, "RETRY", () => void this.load(), { primary: true });
  }

  // ------------------------------------------------------------------ board drawing

  private drawBoard(board: Board, walls?: ReadonlyMap<number, number>, spores?: ReadonlySet<number>) {
    const p = this.p;
    const L = BX - 1, T = BY - 1, W = GRID_W * TILE + 2, H = GRID_H * TILE + 2;
    // The island's cliff face (two striped rows) and a shadow on the right, like the on-chain art's floating land.
    p.rect(L + 1, T + H, W, 2, "black");
    for (let i = L + 3; i < L + W; i += 4) p.px(i, T + H, "white");
    p.rect(L + W, T + 2, 1, H - 1, "black");
    p.frame(L, T, W, H, "black");
    const kindAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
      const hp = walls?.get(y * GRID_W + x);
      return hp === 0 ? "ground" : tileAt(board, x, y).kind;
    };
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const tile = tileAt(board, x, y);
      const hp = walls?.get(y * GRID_W + x);
      const kind = kindAt(x, y)!;
      this.art.tile(kind, BX + x * TILE, BY + y * TILE, x, y, { dir: tile.dir, hp: hp ?? tile.hp, maxHp: WALL_HP[tile.kind], frame: this.anim,
        scenery: board.scenery, same: (dx, dy) => kindAt(x + dx, y + dy) === kind });
      if (spores?.has(y * GRID_W + x)) {
        const sx = BX + x * TILE, sy = BY + y * TILE;
        for (const [ox, oy] of [[4, 5], [9, 4], [6, 9], [11, 10], [8, 7]]) { p.rect(sx + ox - 1, sy + oy - 1, 3, 3, "white"); p.px(sx + ox, sy + oy, "black"); p.px(sx + ox + 1, sy + oy, "black"); p.px(sx + ox, sy + oy + 1, "black"); }
      }
    }
  }

  /** The flag tile of an expanded region: lime for you, pink for a ghost, dithered when the flag is down. */
  private drawFlag(x: number, y: number, holder: string | null) {
    const p = this.p;
    p.rect(x + 4, y + 14, 8, 2, "black");
    p.rect(x + 5, y + 13, 6, 1, "black");
    p.rect(x + 7, y + 2, 1, 11, "black");
    p.rect(x + 6, y + 1, 3, 1, "black");
    const wave = this.reducedMotion ? 0 : this.anim % 2;
    if (holder === null) { p.dither(x + 8, y + 3 + wave, 6, 5, "black", 2); p.frame(x + 8, y + 3 + wave, 6, 5, "black"); return; }
    p.rect(x + 8, y + 3 + wave, 7, 5, "black");
    p.rect(x + 9, y + 4 + wave, 5, 3, holder === YOU ? "lime" : "pink");
    p.px(x + 14, y + 5 + wave, "white");
  }

  private drawLanes(color: Color, active?: number) {
    const p = this.p;
    LANE_ROWS.forEach((row, i) => {
      const y = BY + row * TILE + 5;
      const on = active === undefined || active === i;
      for (let k = 0; k < 2; k++) {
        const x = BX + 2 + k * 5 + (this.reducedMotion ? 0 : (this.anim % 2));
        if (!on) continue;
        p.px(x, y, color); p.px(x + 1, y + 1, color); p.px(x + 2, y + 2, color); p.px(x + 1, y + 3, color); p.px(x, y + 4, color);
      }
    });
  }

  /** A unit on the board: team plate, white halo, black canonical sprite, optional HP bar and level pips. */
  private drawUnit(friend: Friend, x: number, y: number, team: Color, opts: { facing?: Facing; walking?: boolean; level?: number; hp?: number; maxHp?: number; core?: boolean; flash?: boolean; dissolve?: number; mini?: number } = {}) {
    const p = this.p;
    const step = this.reducedMotion ? 0 : Math.floor(this.now / (opts.walking ? 90 : 180));
    const bits = spriteBits(friend, opts.facing ?? "down", Boolean(opts.walking), step);
    const ix = Math.round(x), iy = Math.round(y);
    if (opts.dissolve !== undefined) {
      if (opts.dissolve <= 0) return;
      p.withClip(ix, iy, TILE, TILE, () => {
        p.sprite(bits, ix, iy, "black");
        p.dither(ix, iy, TILE, TILE, "white", (4 - Math.min(3, opts.dissolve!)) as 1 | 2 | 3);
      });
      return;
    }
    p.rect(ix + 3, iy + 13, 10, 3, "black");
    p.rect(ix + 2, iy + 14, 12, 1, "black");
    p.rect(ix + 3, iy + 14, 10, 1, team);
    p.outline(bits, ix, iy, team === "pink" ? "black" : "white");
    p.sprite(bits, ix, iy, opts.flash ? "pink" : team === "pink" ? "white" : "black");
    if (opts.mini !== undefined && opts.mini >= 0) { p.rect(ix + 12, iy, 4, 4, "white"); p.rect(ix + 13, iy + 1, 2, 2, team); }
    if (opts.core) {
      const cx = ix + 4, cy = iy - 6;
      for (const i of [0, 4, 8]) p.px(cx + i, cy, "black");
      p.rect(cx, cy + 1, 2, 1, "black"); p.rect(cx + 3, cy + 1, 3, 1, "black"); p.rect(cx + 7, cy + 1, 2, 1, "black");
      p.rect(cx, cy + 2, 9, 3, "black");
      p.rect(cx + 1, cy + 2, 7, 2, team);
      p.px(cx + 4, cy + 2, "white");
    }
    if (opts.level) {
      p.rect(ix, iy - 1, opts.level * 3 + 1, 4, "white");
      for (let i = 0; i < opts.level; i++) p.rect(ix + 1 + i * 3, iy, 2, 2, "black");
    }
    if (opts.hp !== undefined && opts.maxHp) {
      const w = 12, fill = Math.max(0, Math.round((opts.hp / opts.maxHp) * (w - 2)));
      p.rect(ix + 2, iy - 2, w, 3, "black");
      p.rect(ix + 3, iy - 1, w - 2, 1, "white");
      p.rect(ix + 3, iy - 1, fill, 1, team);
    }
  }

  private boardWidget(id: string, onTile: (x: number, y: number) => void, cursorVisible = true) {
    const w: Widget = {
      id, x: BX, y: BY, w: GRID_W * TILE, h: GRID_H * TILE, label: "Board",
      press: (x, y) => { const tx = Math.floor((x - BX) / TILE), ty = Math.floor((y - BY) / TILE); onTile(tx, ty); },
      activate: () => onTile(this.cursor.x, this.cursor.y),
      arrow: (dx, dy) => {
        this.cursor = { x: Math.max(0, Math.min(GRID_W - 1, this.cursor.x + dx)), y: Math.max(0, Math.min(GRID_H - 1, this.cursor.y + dy)) };
        return true;
      },
    };
    this.ui.add(w);
    if (cursorVisible && this.ui.focused(id) && (this.reducedMotion || this.anim % 2 === 0)) {
      const cx = BX + this.cursor.x * TILE, cy = BY + this.cursor.y * TILE;
      for (const [ox, oy] of [[0, 0], [TILE - 3, 0], [0, TILE - 3], [TILE - 3, TILE - 3]]) this.p.rect(cx + ox, cy + oy, 3, 3, "pink");
    }
  }

  /** A region's board with its garrison (and Core or flag) as it stands now. */
  /** Dotted outline of the tiles a unit at (tx, ty) can hit (Chebyshev range). */
  private drawRange(tx: number, ty: number, range: number, color: Color) {
    const p = this.p;
    const x0 = Math.max(0, tx - range), y0 = Math.max(0, ty - range), x1 = Math.min(GRID_W - 1, tx + range), y1 = Math.min(GRID_H - 1, ty + range);
    const L = BX + x0 * TILE, T = BY + y0 * TILE, R = BX + (x1 + 1) * TILE - 1, B = BY + (y1 + 1) * TILE - 1;
    for (let x = L; x <= R; x += 2) { p.px(x, T, color); p.px(x, B, color); p.px(x, T + 1, "black"); p.px(x, B - 1, "black"); }
    for (let y = T; y <= B; y += 2) { p.px(L, y, color); p.px(R, y, color); p.px(L + 1, y, "black"); p.px(R - 1, y, "black"); }
  }

  private drawRegion(region: Region, territory: Territory, team: Color, opts: { away?: ReadonlySet<string>; coreLevel?: number; highlight?: { x: number; y: number } | null } = {}) {
    const s = this.session!, p = this.p;
    this.drawBoard(region.board);
    const cx = BX + region.board.core.x * TILE, cy = BY + region.board.core.y * TILE;
    if (region.home) {
      const rival = s.rivalOf(territory);
      const level = territory.owner === YOU ? s.coreLevel : rival?.coreLevel ?? 0;
      if (level > 0) this.drawUnit(territory.anchor, cx, cy, territory.owner === YOU ? "lime" : "pink", { core: true, level, facing: "left" });
      else this.drawFlag(cx, cy, null);
    } else this.drawFlag(cx, cy, region.holder);
    for (const piece of region.garrison) {
      const x = BX + piece.x * TILE, y = BY + piece.y * TILE;
      if (opts.away?.has(piece.key)) { p.dither(x + 2, y + 2, 12, 12, "black", 1); p.textCenter("OUT", x + 8, y + 5, "black"); continue; }
      this.drawUnit(piece.friend, x, y, team, { level: piece.level, facing: "left" });
    }
    if (opts.highlight) p.frame(BX + opts.highlight.x * TILE - 1, BY + opts.highlight.y * TILE - 1, TILE + 2, TILE + 2, "pink");
  }

  // ------------------------------------------------------------------ build screen

  private drawBuild() {
    const s = this.session!, p = this.p, held = this.held();
    const region = held.region, sel = this.selection;
    const selTile = sel?.kind === "piece" ? region.garrison.find(g => g.key === sel.key) : sel?.kind === "core" && region.home && held.territory.owner === YOU ? region.board.core : null;
    this.drawRegion(region, held.territory, "lime", { away: s.away, highlight: selTile ?? null });
    this.drawLanes("pink");
    if (sel?.kind === "piece") {
      const piece = region.garrison.find(g => g.key === sel.key);
      if (piece) this.drawRange(piece.x, piece.y, unitStats(piece.friend, piece.level, region.board.scenery).range, "lime");
    }
    if (sel?.kind === "recruit") {
      for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
        if (buildable(region.board, x, y) && !region.garrison.some(g => g.x === x && g.y === y)) { p.px(BX + x * TILE + 7, BY + y * TILE + 7, "pink"); p.px(BX + x * TILE + 8, BY + y * TILE + 8, "pink"); }
      }
    }
    this.boardWidget("board", (x, y) => this.clickTile(x, y));
    this.drawBuildPanel(held);
    this.drawRoster(held);
    const canRaid = !s.raidedToday && s.coreLevel > 0 && s.pieces().length > 0;
    this.button("raid", 4, BAR_Y, 58, "RAID ►", () => this.toScout(), { primary: canRaid, disabled: !canRaid });
    this.button("end-day", 66, BAR_Y, 58, s.raidedToday ? "DEFEND ►" : "END DAY ►", () => this.endDay(), { primary: s.raidedToday });
    this.button("territory", 128, BAR_Y, 58, "TERRITORY", () => this.go({ kind: "territory", sel: null }));
    this.button("help", 190, BAR_Y, 30, "HELP", () => this.openHelp());
    if (s.broke) this.button("restart", 224, BAR_Y, 60, "RESTART SIM", () => { s.restart(); this.buildId = `${YOU}/0,0`; this.selection = { kind: "core" }; this.say("Simulated ledger restarted."); });
    const hint = sel?.kind === "recruit" ? "PICK A DOTTED TILE TO PLACE (1 RF)" : sel?.kind === "piece" ? "L LEVEL UP · X REMOVE · TILE TO MOVE" : "[ ] SWITCH REGION · T TERRITORY · O ROUND";
    p.text(hint, 122, HINT_Y, "black");
  }

  private drawRoster(held: Held) {
    const s = this.session!, p = this.p;
    const pool = s.pool;
    const cols = 18;
    const label = held.rival ? `${regionName(held.region)} AT ${held.rival.name}` : regionName(held.region);
    p.text(`RECRUIT POOL · ${label}: ${held.region.garrison.length}/${MAX_GARRISON} PIECES · SUPPLY ${s.supply(held.region)}/${SUPPLY_PER_REGION}`, 4, STRIP_Y, "black");
    const per = cols * 2, pages = Math.max(1, Math.ceil(pool.length / per));
    this.rosterPage = Math.min(this.rosterPage, pages - 1);
    const first = this.rosterPage * per;
    pool.slice(first, first + per).forEach((friend, j) => {
      const i = first + j;
      const x = 4 + (j % cols) * 17 + 1, y = STRIP_Y + 6 + Math.floor(j / cols) * 17;
      const placed = s.isPlaced(friend);
      const selected = (this.selection?.kind === "recruit" && this.selection.friend.tokenId === friend.tokenId) ||
        (this.selection?.kind === "piece" && this.selection.key === `#${friend.tokenId}`);
      const bits = spriteBits(friend, "down", false, this.reducedMotion ? 0 : Math.floor(this.now / 220) + i);
      if (placed) p.rect(x, y, 16, 16, "lime");
      p.sprite(bits, x, y, "black");
      if (selected) p.frame(x - 1, y - 1, 18, 18, "pink");
      if (this.ui.focused("roster") && i === this.rosterIndex) p.frame(x - 1, y - 1, 18, 18, "black");
    });
    const rows = Math.min(2, Math.ceil((pool.length - first) / cols));
    if (pages > 1) this.button("roster-page", 290, STRIP_Y - 1, 25, `${this.rosterPage + 1}/${pages} ►`, () => { this.rosterPage = (this.rosterPage + 1) % pages; this.rosterIndex = this.rosterPage * per; }, { h: 8 });
    const pick = (i: number) => {
      const friend = pool[i];
      if (!friend) return;
      this.rosterIndex = i;
      const placed = s.pieces().find(g => g.friend.tokenId === friend.tokenId);
      if (placed) { const where = s.regionOf(placed.key); if (where) this.buildId = where.id; }
      this.selection = placed ? { kind: "piece", key: placed.key } : { kind: "recruit", friend };
      this.host.play("select");
    };
    this.ui.add({
      id: "roster", x: 4, y: STRIP_Y + 5, w: cols * 17 + 1, h: rows * 17 + 1, label: "Recruit pool",
      press: (x, y) => pick(first + Math.floor((x - 5) / 17) + Math.floor((y - STRIP_Y - 6) / 17) * cols),
      activate: () => pick(this.rosterIndex),
      arrow: (dx, dy) => {
        const next = this.rosterIndex + dx + dy * cols;
        if (next >= 0 && next < pool.length) { this.rosterIndex = next; this.rosterPage = Math.floor(next / per); }
        const f = pool[this.rosterIndex];
        if (f) this.host.announce(`${friendLabel(f)}, generation ${f.generation}, ${f.scenery}, ${f.floor}`);
        return true;
      },
    });
  }

  private panelHeader(title: string, color: Color = "black") {
    const p = this.p;
    p.panel(PX, PY - 1, PW, PH + 1);
    p.rect(PX + 1, PY, PW - 2, 8, color);
    p.rect(PX + 1, PY + 8, PW - 2, 1, "black");
    const ink: Color = color === "black" ? "white" : "black";
    if (bigWidth(title) <= PW - 6) p.big(title, PX + 3, PY + 1, ink);
    else p.text(title, PX + 3, PY + 2, ink);
  }

  /** Friend card inside the side panel. Returns the next free y. */
  private friendCard(friend: Friend, level: number, boardScenery: Board["scenery"], opts: { core?: boolean; attacking?: boolean; y?: number; atkMul?: number; defMul?: number } = {}) {
    const p = this.p, y0 = opts.y ?? PY + 10;
    const bits = spriteBits(friend, "down", false, this.reducedMotion ? 0 : Math.floor(this.now / 220));
    p.frame(PX + 3, y0, 34, 34, "black");
    p.sprite(bits, PX + 4, y0 + 1, "black", { scale: 2 });
    const tx = PX + 41;
    p.text(`#${friend.tokenId}`, tx, y0 + 1, "black");
    p.text(friend.character.toUpperCase(), tx, y0 + 8, "black");
    p.text(`GEN ${friend.generation} · TIER ${friend.activationTier}`, tx, y0 + 15, "black");
    p.text(friend.state.toUpperCase(), tx, y0 + 22, "black");
    if (friend.source === "snapshot" && opts.core) p.text("SNAPSHOT", tx + 32, y0 + 22, "pink");
    let y = y0 + 37;
    p.text(`${friend.scenery.toUpperCase()} · ${friend.floor.toUpperCase()}`, PX + 3, y, "black"); y += LINE_H;
    if (!level) { p.text("NOT ACTIVE", PX + 3, y, "pink"); return y + LINE_H; }
    const st = unitStats(friend, level, boardScenery, { core: opts.core, attacking: opts.attacking, atkMul: opts.atkMul, defMul: opts.defMul });
    const def = CLASSES[friend.character];
    p.text(`LV${level} HP ${st.maxHp} DMG ${st.dmg} RNG ${st.range}`, PX + 3, y, "black"); y += LINE_H;
    p.text(`DEF ${def.defense.name.toUpperCase()}`, PX + 3, y, "black"); y += LINE_H;
    p.text(`RAID ${def.offense.name.toUpperCase()}`, PX + 3, y, "black"); y += LINE_H;
    p.text(`MAX ${def.upgrade.name.toUpperCase()}`, PX + 3, y, "black");
    p.textRight(st.upgrade ? "ON" : "AT LV4", PX + PW - 3, y, st.upgrade ? "black" : "pink");
    y += LINE_H;
    const aff = st.slots < 2 ? `GEN ${friend.generation}: NO SCENERY SLOT` : st.affinity ? `AFFINITY ON: ${friend.scenery.toUpperCase()}` : `AFFINITY OFF ON ${boardScenery.toUpperCase()}`;
    p.text(aff, PX + 3, y, "black"); y += LINE_H;
    return y;
  }

  private drawBuildPanel(held: Held) {
    const s = this.session!, p = this.p, sel = this.selection, region = held.region;
    const btnY1 = PY + PH - 25, btnY2 = PY + PH - 12;
    const defMul = s.bonus(YOU);
    if (sel?.kind === "core" && region.home && held.territory.owner === YOU) {
      this.panelHeader("YOUR CORE", "lime");
      this.friendCard(s.player, s.coreLevel, region.board.scenery, { core: true, defMul });
      if (!s.coreLevel) this.button("act", PX + 3, btnY2, PW - 6, "ACTIVATE · 1 RF", () => this.levelSelected(), { primary: true });
      else {
        const cost = s.levelCost(s.coreLevel);
        this.button("lvl", PX + 3, btnY2, PW - 6, cost === null ? "MAX LEVEL" : `LEVEL UP · ${formatRf(cost)} RF`, () => this.levelSelected(), { disabled: cost === null || s.ledger.balance < cost, primary: true });
      }
      return;
    }
    if (sel?.kind === "piece") {
      const piece = s.piece(sel.key);
      if (piece) {
        const away = s.away.has(piece.key);
        this.panelHeader(away ? "GARRISON · RAIDING" : "GARRISON");
        this.friendCard(piece.friend, piece.level, region.board.scenery, { defMul });
        p.text(`STAKE ${formatRf(stakeAt(piece.level))} RF`, PX + PW - 48, PY + 10 + 30, "black");
        const cost = s.levelCost(piece.level), error = s.levelUpError(piece.key);
        const label = cost === null ? "MAX LEVEL" : error?.startsWith("No supply") ? "NO SUPPLY LEFT" : `LEVEL UP · ${formatRf(cost)} RF`;
        this.button("lvl", PX + 3, btnY1, PW - 6, label, () => this.levelSelected(), { disabled: Boolean(error) || away, primary: true });
        this.button("rm", PX + 3, btnY2, PW - 6, `REMOVE · +${formatRf(stakeAt(piece.level))} RF`, () => this.removeSelected(), { disabled: away });
        return;
      }
    }
    if (sel?.kind === "recruit") {
      this.panelHeader("RECRUIT");
      this.friendCard(sel.friend, 1, region.board.scenery, { defMul });
      const error = region.garrison.length >= MAX_GARRISON ? "REGION FULL" : s.supply(region) + 1 > SUPPLY_PER_REGION ? "NO SUPPLY LEFT" : s.ledger.balance < stakeAt(1) ? "NEED 1 RF" : null;
      p.text(error ?? "PICK A TILE: STAKE 1 RF", PX + 3, btnY2 + 3, error ? "pink" : "black");
      return;
    }
    const list = s.held(), index = list.findIndex(h => h.id === held.id);
    this.panelHeader(held.rival ? `${regionName(region)} · AT ${held.rival.name}` : `${regionName(region)} · ${region.board.scenery.toUpperCase()}`, held.rival ? "pink" : "black");
    let y = PY + 10;
    p.text(`REGION ${index + 1}/${list.length}`, PX + 3, y, "black");
    this.button("prev-region", PX + PW - 45, y - 2, 20, "◄", () => this.cycleRegion(-1), { h: 9, disabled: list.length < 2 });
    this.button("next-region", PX + PW - 23, y - 2, 20, "►", () => this.cycleRegion(1), { h: 9, disabled: list.length < 2 });
    y += LINE_H + 1;
    p.text(`SUPPLY ${s.supply(region)}/${SUPPLY_PER_REGION} · ${region.garrison.length}/${MAX_GARRISON} PIECES`, PX + 3, y, "black"); y += LINE_H + 2;
    const aff = AFFINITY[region.board.scenery];
    for (const line of wrap(`${region.board.scenery}: ${aff.terrain}`.toUpperCase(), PW - 6)) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
    y += 2;
    const extra = s.extraRegions(YOU), counting = s.bonusRegions(YOU);
    p.text(`BONUS ×${defMul.toFixed(2)} · ${counting}/${extra} COUNT`, PX + 3, y, "black"); y += LINE_H;
    if (!region.home && !garrisoned(region)) { p.text(`NEEDS ${GARRISON_FOR_BONUS} PIECES TO COUNT`, PX + 3, y, "pink"); y += LINE_H; }
    y += 2;
    const tonight = s.incoming();
    const lines = s.isProtected(YOU) ? [`REBUILDING: PROTECTED ${s.protectedNights(YOU)} NIGHT${s.protectedNights(YOU) === 1 ? "" : "S"}`, "RAIDING ENDS PROTECTION"]
      : tonight ? [`TONIGHT: ${tonight.rival.name}`, `${tonight.party.length} RAIDERS · THREAT ${tonight.threat}`]
      : ["TONIGHT: NO RAID"];
    for (const line of lines) { if (y < PY + PH - 2) p.text(line, PX + 3, y, s.isProtected(YOU) ? "black" : "pink"); y += LINE_H; }
  }

  // ------------------------------------------------------------------ territory

  private drawTerritory(screen: Extract<Screen, { kind: "territory" }>) {
    const s = this.session!, p = this.p, t = s.territory;
    const options = s.expandOptions();
    const cellW = 60, cellH = 40;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = BX + (dx + 1) * 64, y = BY + (dy + 1) * 44;
      const region = t.regions.find(r => r.dx === dx && r.dy === dy);
      const option = options.some(o => o.dx === dx && o.dy === dy);
      const selected = screen.sel?.dx === dx && screen.sel?.dy === dy;
      if (region) {
        const color: Color = region.holder === YOU ? "lime" : region.holder === null ? "white" : "pink";
        p.panel(x, y, cellW, cellH);
        p.rect(x + 1, y + 1, cellW - 2, 8, color);
        p.rect(x + 1, y + 9, cellW - 2, 1, "black");
        if (region.holder === null) p.dither(x + 1, y + 1, cellW - 2, 8, "black", 1);
        p.text(regionName(region), x + 3, y + 3, "black");
        p.text(region.holder === YOU ? "YOURS" : region.holder === null ? "FLAG DOWN" : s.holderName(region.holder), x + 3, y + 12, "black");
        p.text(`${region.garrison.length} PIECES`, x + 3, y + 19, "black");
        if (!region.home && region.holder === YOU) p.text(garrisoned(region) ? "+15% BONUS" : "NO BONUS YET", x + 3, y + 33, garrisoned(region) ? "black" : "pink");
        p.text(region.board.scenery.toUpperCase(), x + 3, y + 26, "black");
        if (region.home) p.text(`CORE LV${s.coreLevel}`, x + 3, y + 33, s.coreLevel ? "black" : "pink");
      } else if (option) {
        p.withClip(x, y, cellW, cellH, () => { p.dither(x, y, cellW, 1, "black", 2); p.dither(x, y + cellH - 1, cellW, 1, "black", 2); p.dither(x, y, 1, cellH, "black", 2); p.dither(x + cellW - 1, y, 1, cellH, "black", 2); });
        p.textCenter("EXPAND", x + cellW / 2, y + 13, "black");
        p.textCenter(`${EXPAND_COST} RF`, x + cellW / 2, y + 21, "black");
      } else {
        p.dither(x, y, cellW, cellH, "black", 1);
      }
      if (selected) p.frame(x - 1, y - 1, cellW + 2, cellH + 2, "pink");
      if (region || option) this.ui.add({ id: `cell-${dx},${dy}`, x, y, w: cellW, h: cellH, label: region ? `${regionName(region)} region` : `Expand ${regionName({ dx, dy })}`, activate: () => { screen.sel = { dx, dy }; this.host.play("select"); } });
    }
    // Panel.
    const sel = screen.sel ? t.regions.find(r => r.dx === screen.sel!.dx && r.dy === screen.sel!.dy) ?? null : null;
    const selOption = screen.sel && !sel && options.some(o => o.dx === screen.sel!.dx && o.dy === screen.sel!.dy) ? screen.sel : null;
    const extra = s.extraRegions(YOU);
    if (sel) {
      this.panelHeader(`${regionName(sel)} · ${sel.board.scenery.toUpperCase()}`, sel.holder === YOU ? "lime" : sel.holder === null ? "black" : "pink");
      let y = PY + 10;
      const lines = [
        sel.holder === YOU ? "HELD BY YOU" : sel.holder === null ? "FLAG DOWN: NOBODY HOLDS IT" : `RESIDENT: ${s.holderName(sel.holder)}`,
        `${sel.garrison.length} PIECES · SUPPLY ${s.supply(sel)}/${SUPPLY_PER_REGION}`,
        sel.home ? "HOME: NO BONUS, HOLDS YOUR CORE" : garrisoned(sel) ? "BONUS ACTIVE (+15%)" : `BONUS NEEDS ${GARRISON_FOR_BONUS} PIECES HERE`,
        "", ...wrap(`${AFFINITY[sel.board.scenery].terrain}.`.toUpperCase(), PW - 6),
      ];
      for (const line of lines) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
      if (sel.holder === YOU) this.button("build-here", PX + 3, PY + PH - 12, PW - 6, "BUILD HERE ►", () => { this.buildId = `${YOU}/${sel.key}`; this.selection = null; this.go({ kind: "build" }); }, { primary: true });
      else if (sel.holder === null) this.button("reclaim", PX + 3, PY + PH - 12, PW - 6, `RECLAIM · ${RECLAIM_COST} RF`, () => this.tryAction(() => s.reclaim(sel.key), `${regionName(sel)} is yours again.`, "purchase"), { primary: true, disabled: s.ledger.balance < rf(RECLAIM_COST) });
      else {
        for (const line of wrap("EVICT THE RESIDENT WITH A RECLAIM RAID (ITS OWN DAILY RAID; NO WIN IS SCORED), THEN PAY 250 RF TO RAISE YOUR FLAG.", PW - 6)) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
        const can = !s.reclaimedToday && s.coreLevel > 0 && s.pieces().some(pc => !s.away.has(pc.key));
        this.button("reclaim-raid", PX + 3, PY + PH - 12, PW - 6, "RECLAIM RAID ►", () => this.toSetup({ kind: "reclaim", key: sel.key }), { primary: true, disabled: !can });
      }
    } else if (selOption) {
      this.panelHeader(`EXPAND: ${regionName(selOption)}`, "lime");
      let y = PY + 10;
      for (const line of wrap(`A NEW REGION NEXT TO YOUR TERRITORY WITH ITS OWN ${SUPPLY_PER_REGION} SUPPLY. ITS TERRAIN IS FIXED BY YOUR TOKEN. ONCE IT HOLDS ${GARRISON_FOR_BONUS}+ OF YOUR PIECES IT ADDS +${Math.round(REGION_BONUS * 100)}% ATTACK ON RAIDS AND +${Math.round(REGION_BONUS * 100)}% HP ON DEFENSE. RAIDERS MUST CLEAR EVERY REGION TO BEAT YOU. THE ${EXPAND_COST} RF GOES INTO THE ROUND'S REWARD POT.`, PW - 6)) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
      this.button("expand", PX + 3, PY + PH - 12, PW - 6, `EXPAND · ${EXPAND_COST} RF`, () => this.tryAction(() => { const r = s.expand(selOption.dx, selOption.dy); screen.sel = { dx: r.dx, dy: r.dy }; }, `Expanded to ${regionName(selOption)}.`, "purchase"), { primary: true, disabled: s.ledger.balance < rf(EXPAND_COST) || !s.coreLevel });
    } else {
      this.panelHeader("YOUR TERRITORY", "lime");
      let y = PY + 10;
      const lines = [`${t.regions.length} REGION${t.regions.length === 1 ? "" : "S"} · ${s.held().length - t.regions.filter(r => r.holder === YOU).length} OUTPOST${s.held().length - t.regions.filter(r => r.holder === YOU).length === 1 ? "" : "S"}`,
        `BONUS ×${s.bonus(YOU).toFixed(2)} (${s.bonusRegions(YOU)}/${extra} REGIONS COUNT)`, "",
        ...wrap(`EXPAND FOR ${EXPAND_COST} RF. A RIVAL WHO BEATS YOU CAN BUY A FLAG FOR ${CLAIM_COST} RF AND MOVE IN; EVICT THEM, THEN PAY ${RECLAIM_COST} RF TO GET IT BACK. ALL OF IT FEEDS THE POT.`, PW - 6)];
      for (const line of lines) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
    }
    // Strip: outposts in rival territories.
    const outposts = s.held().filter(h => h.rival);
    p.text(outposts.length ? "YOUR OUTPOSTS IN RIVAL TERRITORIES" : "NO OUTPOSTS YET: BEAT A RIVAL, THEN BUY ONE OF ITS FLAGS", 4, STRIP_Y, "black");
    outposts.slice(0, 4).forEach((h, i) => {
      const x = 4 + i * 78, y = STRIP_Y + 6;
      p.panel(x, y, 76, 30);
      p.rect(x + 1, y + 1, 74, 8, "lime");
      p.text(`${regionName(h.region)}`.slice(0, 9), x + 3, y + 3, "black");
      p.text(h.rival!.name, x + 3, y + 11, "black");
      p.text(`${h.region.garrison.length} PIECES`, x + 3, y + 18, "black");
      this.button(`outpost-${i}`, x + 40, y + 17, 33, "BUILD", () => { this.buildId = h.id; this.selection = null; this.go({ kind: "build" }); }, { h: 10 });
    });
    this.button("back", 4, BAR_Y, 40, "◄ BACK", () => this.go({ kind: "build" }));
    this.button("round", 48, BAR_Y, 58, "ROUND & POT", () => this.go({ kind: "round" }));
    this.button("help", 110, BAR_Y, 30, "HELP", () => this.openHelp());
    p.text("PICK A CELL · O ROUND · ESC BACK", 122, HINT_Y, "black");
  }

  // ------------------------------------------------------------------ scout + setup

  private rivalStake(rival: Rival) {
    return rival.territory.regions.reduce((sum, r) => sum + r.garrison.reduce((n, g) => n + stakeAt(g.level), 0n), stakeAt(Math.max(1, rival.coreLevel)));
  }

  private drawScout() {
    const s = this.session!, p = this.p;
    p.text(s.isProtected(YOU) ? "RAIDING ENDS YOUR OWN REBUILD PROTECTION" : "SCOUT A RIVAL · CLEAR EVERY REGION TO WIN AND BUY A FLAG", 4, BY, s.isProtected(YOU) ? "pink" : "black");
    s.rivals.forEach((rival, i) => {
      const x = 4 + i * 105, y = BY + 8, w = 102, h = 162;
      const home = rival.home();
      p.panel(x, y, w, h);
      p.rect(x + 1, y + 1, w - 2, 8, i === 2 ? "pink" : i === 1 ? "black" : "lime");
      p.rect(x + 1, y + 9, w - 2, 1, "black");
      p.big(rival.difficulty.toUpperCase(), x + 3, y + 1, i === 1 ? "white" : "black");
      p.textRight(rival.archetype.toUpperCase(), x + w - 3, y + 2, i === 1 ? "white" : "black");
      this.miniBoard(home.board, home.garrison, x + 3, y + 13, { friend: rival.core, level: rival.coreLevel });
      let ty = y + 13 + 68;
      p.text(`${rival.name} ${rival.core.character.toUpperCase().slice(0, 6)}`, x + 3, ty, "black"); ty += LINE_H;
      const mine = rival.territory.regions.filter(r => r.holder === YOU).length;
      p.text(`${rival.territory.regions.length} REGION${rival.territory.regions.length === 1 ? "" : "S"} · LV${rival.coreLevel} CORE${mine ? ` · ${mine} YOURS` : ""}`, x + 3, ty, "black"); ty += LINE_H;
      const pieces = rival.territory.regions.flatMap(r => r.holder === YOU ? [] : r.garrison);
      p.text(`${pieces.length} DEFENDERS · WINS ${s.round.wins.get(rival.id) ?? 0}`, x + 3, ty, "black"); ty += LINE_H;
      p.text(`WALLET ${formatRf(rival.wallet)} RF`, x + 3, ty, "black"); ty += LINE_H + 1;
      pieces.slice(0, 6).forEach((g, k) => p.sprite(spriteBits(g.friend, "left", false, 0), x + 3 + k * 16, ty, "black"));
      ty += 17;
      p.text("AT STAKE", x + 3, ty, "black");
      p.textRight(`${formatRf(this.rivalStake(rival))} RF`, x + w - 3, ty, "black");
      const shielded = s.isProtected(rival.id), n = s.protectedNights(rival.id);
      const tonight = s.tonight?.rivalId === rival.id && !s.isProtected(YOU);
      if (tonight) p.text("RAIDS YOU TONIGHT", x + 3, y + h - 23, "pink");
      this.button(`rival-${i}`, x + 3, y + h - 15, w - 6, shielded ? `REBUILDING · ${n} NIGHT${n === 1 ? "" : "S"}` : "SCOUT & PICK", () => this.toSetup({ kind: "rival", index: i }), { primary: !shielded, disabled: shielded });
    });
    this.button("back", 4, BAR_Y, 40, "◄ BACK", () => this.go({ kind: "build" }));
    p.text("PICK A BASE TO SEE ITS REGIONS", 122, HINT_Y, "black");
  }

  /** A half-scale map of a board: simplified terrain, 8 × 8 thumbnails of each piece and the Core, on an island edge. */
  private miniBoard(board: Board, garrison: readonly Piece[], x: number, y: number, core?: { friend: Friend; level: number }) {
    const p = this.p, t = 8, W = GRID_W * t, H = GRID_H * t;
    p.rect(x, y + H + 1, W + 1, 2, "black");
    for (let i = x + 2; i < x + W; i += 4) p.px(i, y + H + 1, "white");
    p.rect(x + W + 1, y + 1, 1, H, "black");
    p.frame(x - 1, y - 1, W + 2, H + 2, "black");
    p.rect(x, y, W, H, "white");
    const kindAt = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H ? null : tileAt(board, tx, ty).kind;
    for (let ty = 0; ty < GRID_H; ty++) for (let tx = 0; tx < GRID_W; tx++) {
      const tile = tileAt(board, tx, ty), kind = tile.kind;
      this.art.tile(kind, x + tx * t, y + ty * t, tx, ty, { scenery: board.scenery, dir: tile.dir, hp: tile.hp, maxHp: WALL_HP[kind], frame: 0,
        same: (dx, dy) => kindAt(tx + dx, ty + dy) === kind }, t);
    }
    for (const g of garrison) {
      const gx = x + g.x * t, gy = y + g.y * t;
      p.rect(gx, gy, t, t, "white");
      p.rect(gx + 1, gy + 7, 6, 1, "pink");
      p.mini(spriteBits(g.friend, "left", false, 0), gx, gy, "black");
    }
    const cx = x + board.core.x * t, cy = y + board.core.y * t;
    p.rect(cx - 1, cy - 1, t + 2, t + 2, "black");
    p.rect(cx, cy, t, t, "white");
    if (core && core.level > 0) p.mini(spriteBits(core.friend, "left", false, 0), cx, cy, "black");
    p.rect(cx + 1, cy - 3, 6, 2, "pink"); p.px(cx + 1, cy - 4, "pink"); p.px(cx + 3, cy - 4, "pink"); p.px(cx + 6, cy - 4, "pink");
  }

  private setupRegions(target: Target): { territory: Territory; regions: Region[]; rival: Rival | null } {
    const s = this.session!;
    if (target.kind === "rival") { const rival = s.rivals[target.index]; return { territory: rival.territory, regions: routeOf(rival.territory), rival }; }
    if (target.kind === "practice") {
      const snap = target.snapshot;
      const regions = snap.only ? snap.territory.regions.filter(r => r.key === snap.only) : routeOf(snap.territory);
      return { territory: snap.territory, regions, rival: snap.rivalIndex !== null ? s.rivals[snap.rivalIndex] : null };
    }
    const r = s.territory.regions.find(x => x.key === target.key)!;
    return { territory: s.territory, regions: [r], rival: s.rivals.find(x => x.id === r.holder) ?? null };
  }

  private drawSetup(setup: Extract<Screen, { kind: "setup" }>) {
    const s = this.session!, p = this.p;
    const { territory, regions: mapOrder, rival } = this.setupRegions(setup.target);
    const regions = setup.route.map(k => mapOrder.find(r => r.key === k)).filter((r): r is Region => Boolean(r));
    for (const r of mapOrder) if (!regions.includes(r)) regions.push(r);
    const practice = setup.target.kind === "practice";
    setup.view = Math.max(0, Math.min(regions.length - 1, setup.view));
    const region = regions[setup.view];
    const yours = region.holder === YOU;
    const all = practice || setup.target.kind === "rival" ? region.garrison : s.present(region);
    const inspected = setup.inspect !== null ? all[setup.inspect] ?? null : null;
    this.drawRegion(region, territory, yours ? "lime" : "pink", { highlight: inspected });
    if (inspected) this.drawRange(inspected.x, inspected.y, unitStats(inspected.friend, inspected.level, region.board.scenery).range, "pink");
    this.drawLanes("lime", setup.lane);
    if (yours) p.text("YOUR OUTPOST: NO BATTLE HERE", BX + 4, BY + 4, "black");
    if (regions.length > 1) {
      const label = `STOP ${setup.view + 1} OF ${regions.length} ON YOUR ROUTE`;
      p.rect(BX + GRID_W * TILE - textWidth(label) - 5, BY + 1, textWidth(label) + 4, 7, "black");
      p.text(label, BX + GRID_W * TILE - textWidth(label) - 3, BY + 2, "white");
    }
    this.boardWidget("board", (x, y) => {
      const hit = all.findIndex(g => g.x === x && g.y === y);
      if (hit >= 0) { setup.inspect = hit; this.host.play("select"); }
      else if (x <= 1) { setup.lane = LANE_ROWS.map((r, i) => [Math.abs(r - y), i]).sort((a, b) => a[0] - b[0])[0][1]; this.host.play("select"); }
      else setup.inspect = null;
    });
    const fee = feeFor(setup.picks.length);
    if (inspected) {
      this.panelHeader(yours ? "YOUR PIECE" : "RIVAL PIECE", yours ? "lime" : "pink");
      this.friendCard(inspected.friend, inspected.level, region.board.scenery, { defMul: s.bonus(region.holder ?? territory.owner) });
      p.text(`STAKE ${formatRf(stakeAt(inspected.level))} RF`, PX + PW - 48, PY + 40, "black");
      this.button("close", PX + 3, PY + PH - 12, PW - 6, "BACK TO RAID PLAN", () => { setup.inspect = null; });
    } else {
      const t = setup.target;
      const title = t.kind === "rival" ? `RAID: ${rival!.difficulty.toUpperCase()}` : t.kind === "reclaim" ? `RECLAIM ${regionName(region)}` : "PRACTICE REMATCH";
      this.panelHeader(title, practice ? "black" : "pink");
      let y = PY + 10;
      const defenders = regions.filter(r => r.holder !== YOU).reduce((n, r) => n + r.garrison.length, 0);
      const lines = t.kind === "rival"
        ? [`${rival!.name} · ${rival!.archetype.toUpperCase()}`, `${regions.length} REGION${regions.length === 1 ? "" : "S"} · ${defenders} DEFENDERS`, `AT STAKE ${formatRf(this.rivalStake(rival!))} RF`, `THEIR BONUS ×${s.bonus(rival!.id).toFixed(2)}`]
        : t.kind === "reclaim" ? [`RESIDENT ${rival?.name ?? "?"}`, `${defenders} DEFENDERS`, `AT STAKE ${formatRf(all.reduce((n, g) => n + stakeAt(g.level), 0n))} RF`, "OWN DAILY RAID · NO WIN SCORED"]
        : [t.snapshot.label.slice(0, 28), `${regions.length} REGION${regions.length === 1 ? "" : "S"} · ${defenders} DEFENDERS`, "AS IT STOOD BEFORE YOUR RAID", "FREE: NO RF, NO SCORE"];
      lines.push("", `PARTY ${setup.picks.length}/${MAX_RAIDERS} · LANE ${setup.lane + 1} · ×${s.bonus(YOU).toFixed(2)}`, practice ? "NO FEE" : `FEE ${formatRf(fee)} RF (2 + 1 EACH)`);
      for (const line of lines) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
      if (regions.length > 1) {
        y += 2;
        p.text("ROUTE", PX + 3, y, "black"); y += LINE_H;
        const route = regions.map((r, i) => `${i + 1}.${regionName(r).slice(0, 5)}`).join(" ");
        for (const line of wrap(route, PW - 6)) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
      }
      const error = practice
        ? (setup.picks.length ? null : "PICK RAIDERS")
        : s.raidError(setup.picks, t.kind === "reclaim" ? "reclaim" : "raid", t.kind === "rival" ? t.index : undefined);
      this.button("launch", PX + 3, PY + PH - 12, PW - 6, error ? "CAN'T LAUNCH" : practice ? "PRACTICE ►" : `LAUNCH · ${formatRf(fee)} RF`, () => this.launch(setup), { primary: true, disabled: Boolean(error) });
      if (error && !practice) p.text(error.toUpperCase().slice(0, 28), PX + 3, PY + PH - 20, "pink");
    }
    // Party picker in the strip: every piece you hold, 24 per page.
    const pieces = [...s.pieces()].sort((a, b) => b.level - a.level || a.key.localeCompare(b.key));
    const pages = Math.max(1, Math.ceil(pieces.length / 24));
    setup.page = Math.min(setup.page, pages - 1);
    const mine = pieces.slice(setup.page * 24, setup.page * 24 + 24);
    p.text(`YOUR RAID PARTY: UP TO 4 OF YOUR ${pieces.length} PIECES${pages > 1 ? ` · PAGE ${setup.page + 1}/${pages}` : ""}`, 4, STRIP_Y, "black");
    mine.forEach((g, i) => {
      const x = 4 + (i % 12) * 26, y = STRIP_Y + 6 + Math.floor(i / 12) * 17;
      const on = setup.picks.includes(g.key);
      const out = !practice && s.away.has(g.key);
      if (on) p.rect(x, y, 25, 16, "lime");
      p.frame(x, y, 25, 16, "black");
      p.sprite(spriteBits(g.friend, "right", on, on && !this.reducedMotion ? Math.floor(this.now / 120) : 0), x + 1, y, "black");
      if (out) p.dither(x + 1, y + 1, 23, 14, "white", 2);
      p.text(String(g.level), x + 19, y + 5, "black");
      this.ui.add({ id: `pick-${g.key}`, x, y, w: 25, h: 16, label: `${on ? "Remove" : "Add"} ${g.key} ${g.friend.character} level ${g.level}`, disabled: out, activate: () => {
        if (on) setup.picks = setup.picks.filter(k => k !== g.key);
        else if (setup.picks.length < MAX_RAIDERS) setup.picks = [...setup.picks, g.key];
        else this.say("Four attackers at most.");
        this.host.play("select");
      } });
    });
    if (!mine.length) p.text("PLACE FRIENDS ON YOUR BOARDS FIRST", 8, STRIP_Y + 16, "pink");
    if (pages > 1) this.button("page", 290, STRIP_Y - 1, 25, "MORE", () => { setup.page = (setup.page + 1) % pages; }, { h: 8 });
    this.button("back", 4, BAR_Y, 40, "◄ BACK", () => this.back());
    LANE_ROWS.forEach((_, i) => this.button(`lane-${i}`, 48 + i * 34, BAR_Y, 32, `LANE ${i + 1}`, () => { setup.lane = i; }, { primary: setup.lane === i }));
    if (regions.length > 1) {
      this.button("view-prev", 154, BAR_Y, 16, "◄", () => { setup.view = (setup.view + regions.length - 1) % regions.length; setup.inspect = null; });
      p.text(`${setup.view + 1}.${regionName(region).slice(0, 5)}`, 173, BAR_Y + 3, "black");
      this.button("view-next", 200, BAR_Y, 16, "►", () => { setup.view = (setup.view + 1) % regions.length; setup.inspect = null; });
      this.button("route-first", 220, BAR_Y, 50, "FIGHT FIRST", () => {
        setup.route = [region.key, ...regions.filter(r => r !== region).map(r => r.key)];
        setup.view = 0; this.host.play("select");
        this.host.announce(`Route: ${setup.route.map(k => regionName(regions.find(r => r.key === k)!)).join(", ")}.`);
      }, { disabled: setup.view === 0 });
    }
    p.text(regions.length > 1 ? "LANE · ROUTE ORDER · THEN LAUNCH" : "PICK A LANE, THEN LAUNCH", 122, HINT_Y, "black");
  }

  // ------------------------------------------------------------------ incoming + playback + result

  private drawIncoming(preview: Incoming | null) {
    const s = this.session!, p = this.p, home = s.home();
    this.drawRegion(home, s.territory, "lime", { away: s.away });
    if (preview) {
      const { rival, party, lane } = preview;
      this.drawLanes("pink", lane);
      party.forEach((a, i) => this.drawUnit(a.friend, BX + (i % 2) * TILE, BY + (LANE_ROWS[lane] + (i < 2 ? 0 : i === 2 ? -1 : 1)) * TILE, "pink", { facing: "right", level: a.level }));
      this.panelHeader(`INCOMING · ${rival.name}`, "pink");
      let y = PY + 10;
      const lines = [`THREAT ${preview.threat} · ${party.length} RAIDERS · LANE ${lane + 1}`, ...party.map(a => `LV${a.level} ${friendLabel(a.friend)}`),
        ...(preview.thinned ? [`${preview.thinned} STAYED HOME: YOUR RAID KO'D THEM`] : []), "",
        `THEY MUST CLEAR ${s.territory.regions.length} REGION${s.territory.regions.length === 1 ? "" : "S"} TO WIN`,
        s.away.size ? `${s.away.size} OF YOURS STILL OUT RAIDING` : "FULL GARRISON HOME", "",
        `HOLD AND THREAT RISES; LOSE AND YOU GET ${REBUILD_NIGHTS} PROTECTED NIGHTS.`];
      for (const line of lines) { for (const l of wrap(line, PW - 6)) { p.text(l, PX + 3, y, "black"); y += LINE_H; } }
      this.button("defend", PX + 3, PY + PH - 12, PW - 6, "DEFEND ►", () => this.runNight(), { primary: true });
    } else {
      this.panelHeader(s.isProtected(YOU) ? "REBUILDING" : "QUIET NIGHT", "lime");
      let y = PY + 12;
      const text = s.isProtected(YOU)
        ? `YOU WERE BEATEN OR LOST YOUR CORE, SO NOBODY CAN RAID YOU FOR ${s.protectedNights(YOU)} MORE NIGHT${s.protectedNights(YOU) === 1 ? "" : "S"}. RAIDING A RIVAL ENDS THIS EARLY. THE GHOSTS STILL FIGHT EACH OTHER.`
        : "NO RIVAL CAN RAID YOU TONIGHT. THE GHOSTS STILL FIGHT EACH OTHER.";
      for (const line of wrap(text, PW - 6)) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
      this.button("defend", PX + 3, PY + PH - 12, PW - 6, "NIGHT ►", () => this.runNight(), { primary: true });
    }
    this.ui.settle("defend");
  }

  private drawPlayback(s: PlaybackScreen) {
    const p = this.p, record = s.record, battle = record.campaign.battles[s.battle], result = battle.result;
    const smooth = !this.reducedMotion;
    const state = s.replay.at(s.tau, smooth);
    const youAttack = record.attacker === YOU;
    const team = (side: "atk" | "def"): Color => (side === "atk") === youAttack ? "lime" : "pink";
    let shakeX = 0;
    if (!this.reducedMotion) {
      const coreHit = state.recent.some(e => e.e === "hit" && !e.miss && result.units[e.target].core && state.tick - e.t < 2);
      if (coreHit) shakeX = (Math.floor(this.now / 50) % 2) ? 1 : -1;
    }
    this.p.ctx.save();
    this.p.ctx.translate(shakeX, 0);
    this.drawBoard(battle.board, state.walls, state.spores);
    if (!battle.home || !battle.core) this.drawFlag(BX + battle.board.core.x * TILE, BY + battle.board.core.y * TILE, battle.holder);
    const views = [...state.units].sort((a, b) => a.y - b.y || a.unit.id - b.unit.id);
    for (const v of views) this.drawUnitView(v, team(v.unit.side), state.tick, s.tau);
    if (!this.reducedMotion) this.drawEffects(state.recent, state.units, s.tau);
    this.drawFloaters(state.recent, state.units, s.tau);
    this.p.ctx.restore();
    this.boardWidget("board", () => this.togglePlay(s), false);
    const n = record.campaign.battles.length;
    this.panelHeader(`${record.title.replace("GHOST ", "").slice(0, 18)} · ${s.battle + 1}/${n}`, youAttack ? "lime" : "pink");
    p.text(`${battle.name} · TICK ${String(state.tick).padStart(3, "0")}/${result.ticks}`, PX + 3, PY + 10, "black");
    p.textRight(`${s.speed}X${s.playing ? "" : " ||"}`, PX + PW - 3, PY + 10, "black");
    const name = (id: number) => {
      if (id < 0) return "TERRAIN";
      const u = result.units[id];
      return u.core ? (team(u.side) === "lime" ? "YOUR CORE" : "RIVAL CORE") : u.friend.character.toUpperCase();
    };
    const feed = result.events.filter(e => e.t <= state.tick).map(e => describe(e, name)).filter((x): x is string => Boolean(x)).slice(-14);
    let y = PY + 19;
    for (const line of feed.flatMap(l => wrap(l, PW - 6)).slice(-15)) { p.text(line, PX + 3, y, "black"); y += LINE_H; }
    const drawTeam = (side: "atk" | "def", row: number, label: string) => {
      const units = state.units.filter(u => u.unit.side === side);
      p.text(label, 4, STRIP_Y + row * 19 + 5, "black");
      units.slice(0, 13).forEach((u, i) => {
        const x = 34 + i * 21, y = STRIP_Y + row * 19;
        const bits = spriteBits(u.unit.friend, "down", false, 0);
        p.sprite(bits, x, y, "black");
        if (!u.alive) { p.dither(x, y, 16, 16, "white", 3); for (let k = 3; k < 13; k++) { p.px(x + k, y + k, "pink"); p.px(x + 15 - k, y + k, "pink"); } }
        p.rect(x - 1, y + 16, 18, 2, "black");
        p.rect(x, y + 16, Math.round(16 * u.hp / Math.max(1, u.maxHp)), 1, team(side));
      });
    };
    drawTeam(youAttack ? "atk" : "def", 0, "YOU");
    drawTeam(youAttack ? "def" : "atk", 1, "RIVAL");
    p.notch(PX + 2, STRIP_Y + 2, PW - 4, 6, "black");
    p.dither(PX + 3, STRIP_Y + 3, PW - 6, 4, "black", 1);
    p.rect(PX + 3, STRIP_Y + 3, Math.round((PW - 6) * s.tau / Math.max(1, s.replay.length - 1)), 4, "black");
    for (let k = 1; k < 10; k++) p.px(PX + 3 + Math.round((PW - 6) * k / 10), STRIP_Y + 7, "black");
    record.campaign.battles.forEach((b, i) => {
      const x = PX + 3 + i * 22;
      p.rect(x, STRIP_Y + 10, 20, 5, i < s.battle ? (b.result.cleared ? "lime" : "pink") : i === s.battle ? "black" : "white");
      p.frame(x, STRIP_Y + 10, 20, 5, "black");
    });
    this.button("restart", 4, BAR_Y, 22, "|◄", () => { s.tau = 0; s.lastFeedTick = -1; s.endedAt = 0; s.playing = true; });
    this.button("rew", 28, BAR_Y, 22, "◄◄", () => this.seek(s, -2 * TICKS_PER_SECOND));
    this.button("play", 52, BAR_Y, 34, s.playing ? "PAUSE" : "PLAY", () => this.togglePlay(s), { primary: !s.playing });
    this.button("fwd", 88, BAR_Y, 22, "►►", () => this.seek(s, 2 * TICKS_PER_SECOND));
    this.button("speed", 112, BAR_Y, 22, s.speed === 1 ? "2X" : "1X", () => { s.speed = s.speed === 1 ? 2 : 1; });
    const done = s.tau >= s.replay.length - 1 && s.battle === n - 1;
    if (s.battle < n - 1) this.button("next", 136, BAR_Y, 44, "NEXT ►", () => this.nextBattle(s));
    this.button("results", s.battle < n - 1 ? 184 : 136, BAR_Y, 58, done ? "RESULTS ►" : "SKIP ►|", () => this.finishPlayback(s), { primary: done });
    if (done) this.ui.settle("results");
    p.text("SPACE PAUSE · ← → SEEK · F SPEED", 122, HINT_Y, "black");
  }

  private tileXY(v: { x: number; y: number }) { return [BX + Math.round(v.x * TILE), BY + Math.round(v.y * TILE)] as const; }

  private drawUnitView(v: UnitView, team: Color, tick: number, tau: number) {
    const [x, y] = this.tileXY(v);
    if (!v.alive) {
      const since = tau - v.koAt;
      if (since < 4) this.drawUnit(v.unit.friend, x, y, team, { dissolve: 3 - Math.floor(since) });
      return;
    }
    const flash = tick - v.hitAt < 1 && Math.floor(this.now / 60) % 2 === 0;
    this.drawUnit(v.unit.friend, x, y, team, { facing: v.facing, walking: v.walking, hp: v.hp, maxHp: v.maxHp, core: v.unit.core, flash, mini: v.unit.mini });
    if (v.shield > 0) this.p.frame(x - 1, y - 1, TILE + 2, TILE + 2, "black");
  }

  /** Particles: projectiles and power rings. Disabled with reduced motion. */
  private drawEffects(recent: readonly SimEvent[], units: readonly UnitView[], tau: number) {
    const p = this.p;
    for (const e of recent) {
      const age = tau - e.t;
      if (e.e === "hit" && (e.kind === "ranged" || e.kind === "air") && e.id >= 0 && age >= 0 && age < 0.8) {
        const a = units[e.id], b = units[e.target];
        const [ax, ay] = this.tileXY(a), [bx, by] = this.tileXY(b);
        const k = Math.min(1, age / 0.8);
        const px = ax + 8 + (bx - ax) * k, py = ay + 6 + (by - ay) * k;
        p.rect(Math.round(px) - 1, Math.round(py) - 1, 3, 3, "black");
        p.px(Math.round(px), Math.round(py), e.kind === "air" ? "lime" : "pink");
      }
      if (e.e === "power" && e.r && age >= 0 && age < 2) {
        // An expanding dotted pulse (with a fainter trailing ring), clipped to the board.
        const u = units[e.id], [ux, uy] = this.tileXY(u);
        const reach = e.r * TILE + 8, grow = Math.min(reach, Math.round(6 + (age / 1.2) * reach));
        const ring = (radius: number, gap: number, color: Color) => {
          const cx = ux + 8, cy = uy + 8, x0 = cx - radius, y0 = cy - radius, n = radius * 2;
          for (let i = 0; i <= n; i += gap) { p.px(x0 + i, y0, color); p.px(x0 + i, y0 + n, color); p.px(x0, y0 + i, color); p.px(x0 + n, y0 + i, color); }
        };
        p.withClip(BX, BY, GRID_W * TILE, GRID_H * TILE, () => {
          ring(grow, 2, "pink");
          if (grow > 10) ring(grow - 4, 4, "pink");
          if (age < 0.6) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.px(ux + 8 + dx * 3, uy + 8 + dy * 3, "white");
        });
      }
    }
  }

  /** Damage numbers and power names, newest first, laid out so no two overlap. Static with reduced motion. */
  private drawFloaters(recent: readonly SimEvent[], units: readonly UnitView[], tau: number) {
    const p = this.p;
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const fits = (x: number, y: number, w: number, h: number) => !taken.some(r => x < r.x + r.w + 1 && r.x < x + w + 1 && y < r.y + r.h + 1 && r.y < y + h + 1);
    const place = (x: number, y: number, w: number, h: number, step: number) => {
      const cx = Math.max(BX, Math.min(BX + GRID_W * TILE - w, x));
      for (let k = 0; k < 4; k++) {
        const cy = Math.max(BY, Math.min(BY + GRID_H * TILE - h, y + k * step));
        if (fits(cx, cy, w, h)) { taken.push({ x: cx, y: cy, w, h }); return [cx, cy] as const; }
      }
      return null;
    };
    const powered = new Set<number>();
    const numbers = new Map<number, number>();
    for (const e of [...recent].reverse()) {
      const age = tau - e.t;
      if (age < 0 || age > 6) continue;
      const rise = this.reducedMotion ? 0 : Math.floor(age * 2);
      if ((e.e === "hit" || e.e === "heal") && age < 3) {
        const id = e.e === "hit" ? e.target : e.id;
        if ((numbers.get(id) ?? 0) >= 2) continue;
        numbers.set(id, (numbers.get(id) ?? 0) + 1);
        const [ux, uy] = this.tileXY(units[id]);
        const text = e.e === "heal" ? `+${e.amount}` : e.miss ? "MISS" : `-${e.dmg}`;
        const w = textWidth(text) + 2;
        const at = place(ux + 8 - Math.ceil(w / 2), uy - 10 - rise, w, 7, -8);
        if (!at) continue;
        p.textOutlined(text, at[0] + 1, at[1] + 1, e.e === "heal" ? "lime" : e.miss ? "white" : "pink");
      } else if (e.e === "power" && age < 4 && e.name !== "Disguise off" && !powered.has(e.id)) {
        powered.add(e.id);
        const [ux, uy] = this.tileXY(units[e.id]);
        const text = e.name.toUpperCase();
        const w = textWidth(text) + 4;
        const at = place(ux + 8 - Math.ceil(w / 2), uy + 17, w, 7, 8);
        if (!at) continue;
        p.rect(at[0] + 1, at[1], w - 2, 7, "black");
        p.rect(at[0], at[1] + 1, w, 5, "black");
        p.text(text, at[0] + 2, at[1] + 1, "white");
      }
    }
  }

  private drawResult(record: RaidRecord, queue: Queue | null) {
    const s = this.session!, p = this.p, c = record.campaign;
    const last = c.battles.at(-1);
    const youAttack = record.attacker === YOU;
    if (last) {
      const replay = new Replay(last.result, last.board);
      const final = replay.at(replay.length, false);
      this.drawBoard(last.board, final.walls);
      if (!last.core) this.drawFlag(BX + last.board.core.x * TILE, BY + last.board.core.y * TILE, last.holder);
      for (const v of final.units) {
        if (!v.alive) continue;
        const team: Color = (v.unit.side === "atk") === youAttack ? "lime" : "pink";
        const [x, y] = this.tileXY(v);
        this.drawUnit(v.unit.friend, x, y, team, { facing: v.facing, hp: v.hp, maxHp: v.maxHp, core: v.unit.core });
      }
    } else this.drawRegion(s.home(), s.territory, "lime");
    const won = youAttack ? c.won : !c.won;
    this.panelHeader(resultTitle(record).toUpperCase(), won ? "lime" : "pink");
    let y = PY + 10;
    const why = explain(c, youAttack ? "atk" : "def");
    const put = (text: string, color: Color = "black") => { for (const line of wrap(text, PW - 6)) { if (y < PY + PH - 26) p.text(line, PX + 3, y, color); y += LINE_H; } };
    put(why.progress);
    if (record.kind === "raid" && c.won) put(record.claimable.length ? "A WIN! THEY REBUILD FOR 2 NIGHTS. BUY ONE FLAG BELOW." : "A WIN! THEY REBUILD FOR 2 NIGHTS.", "black");
    else if (record.kind === "raid") put(c.battles.some(b => b.result.defeated.length) ? "NO WIN: PLUNDER ONLY" : "NO WIN", "pink");
    if (record.reset && record.defender === YOU) put(`CORE LOST: HOME RESET, ${REBUILD_NIGHTS} PROTECTED NIGHTS`, "pink");
    else if (record.kind === "defense" && c.won) put(`BEATEN: ${REBUILD_NIGHTS} PROTECTED NIGHTS TO REBUILD`, "pink");
    y += 2;
    for (const h of why.highlights) put(`· ${h}`);
    const ry = PY + PH - 23;
    if (record.kind === "practice") p.text("PRACTICE: NO RF, NO SCORE", PX + 3, ry + 7, "black");
    else {
      p.text("NET", PX + 3, ry, "black"); p.textRight(`${formatRf(record.net, true)} RF`, PX + PW - 3, ry, record.net >= 0n ? "black" : "pink");
      p.text("BURNED", PX + 3, ry + 7, "black"); p.textRight(`${formatRf(record.settlement.burned)} RF`, PX + PW - 3, ry + 7, "pink");
      p.text("BALANCE", PX + 3, ry + 14, "black"); p.textRight(`${formatRf(s.ledger.balance)} RF`, PX + PW - 3, ry + 14, "black");
    }
    // Strip: claims, reclaim, or the settlement lines.
    const rival = record.rivalIndex !== null ? s.rivals[record.rivalIndex] : null;
    const claimable = record.kind === "raid" && rival ? s.claimable(rival.index) : [];
    if (claimable.length) {
      p.text(`BUY ONE FLAG · ${CLAIM_COST} RF INTO THE POT · BECOME RESIDENT`, 4, STRIP_Y, "black");
      claimable.slice(0, 4).forEach((r, i) => this.button(`claim-${r.key}`, 4 + i * 78, STRIP_Y + 8, 74, `${regionName(r).slice(0, 5)} · 500`, () =>
        this.tryAction(() => { s.claim(rival!.index, r.key); this.buildId = `${rival!.id}/${r.key}`; }, `${regionName(r)} is yours. Garrison it from the build screen.`, "reward"), { disabled: s.ledger.balance < rf(CLAIM_COST), primary: true }));
      p.text(`${rival!.name} ${rival!.territory.regions.filter(r => r.holder === YOU).length ? "ALREADY HOSTS YOU" : ""}`, 4, STRIP_Y + 24, "black");
    } else if (record.reclaimable) {
      const r = s.territory.regions.find(x => x.key === record.reclaimable)!;
      p.text("RESIDENT EVICTED · THE FLAG IS DOWN", 4, STRIP_Y, "black");
      if (r.holder === YOU) p.text(`${regionName(r)} IS YOURS AGAIN.`, 4, STRIP_Y + 10, "black");
      else this.button("reclaim-now", 4, STRIP_Y + 8, 110, `RECLAIM · ${RECLAIM_COST} RF`, () => this.tryAction(() => s.reclaim(r.key), `${regionName(r)} is yours again.`, "purchase"), { primary: true, disabled: s.ledger.balance < rf(RECLAIM_COST) });
    } else if (record.kind === "practice") {
      p.text("PRACTICE ONLY: NOTHING WAS STAKED, PAID OR SCORED.", 4, STRIP_Y, "black");
      p.text("TRY ANOTHER PARTY, LANE OR ROUTE WITH PRACTICE ►", 4, STRIP_Y + 7, "black");
    } else {
      p.text("SETTLEMENT (SIMULATED RF)", 4, STRIP_Y, "black");
      const rows = record.settlement.lines.slice(0, 10);
      rows.forEach((line, i) => {
        const col = i < 5 ? 0 : 1, x = 4 + col * 158, ly = STRIP_Y + 7 + (i % 5) * LINE_H;
        const who = line.to === "burn" ? "BURN" : line.to === "treasury" ? "TRSY" : line.to === "you" ? "YOU" : line.to === "pot" ? "POT" : "RIVAL";
        p.text(line.label.toUpperCase().slice(0, 24), x, ly, "black");
        p.textRight(`${formatRf(line.amount)} ${who}`, x + 154, ly, line.to === "burn" ? "pink" : "black");
      });
    }
    this.button("replay", 4, BAR_Y, 44, "REPLAY", () => this.startPlayback(record, queue));
    const more = queue && queue.index + 1 < queue.report.records.length;
    const label = queue ? (more ? "NEXT BATTLE ►" : "MORNING ►") : record.kind === "raid" ? "TONIGHT ►" : "DONE ►";
    this.button("continue", 52, BAR_Y, 78, label, () => this.afterResult(record, queue), { primary: true });
    const snapshot = record.snapshot;
    if (snapshot && !queue) this.button("practice", 134, BAR_Y, 62, "PRACTICE ►", () => this.toSetup({ kind: "practice", snapshot }, record.campaign.attackersLeft.map(a => a.key)));
    this.ui.settle("continue");
  }

  private drawMorning(report: NightReport) {
    const s = this.session!, p = this.p;
    p.panel(4, BY - 1, 192, 130);
    p.rect(5, BY, 190, 9, "black");
    p.big(`DAY ${s.day} BEGINS`, 7, BY + 1, "white");
    let y = BY + 11;
    const news = report.news.length ? report.news : ["A QUIET NIGHT."];
    for (const item of news) {
      const aboutYou = /\bYOU\b|YOUR/.test(item.toUpperCase());
      const lines = wrap(item.toUpperCase(), 176);
      if (y < BY + 124) { p.rect(9, y + 1, 3, 3, aboutYou ? "pink" : "black"); }
      for (const line of lines) { if (y < BY + 124) p.text(line, 16, y, "black"); y += LINE_H; }
      y += 2;
    }
    if (report.payout) {
      y += 2;
      for (const line of wrap(`ROUND ${report.payout.round} ENDED. POT ${formatRf(report.payout.pot)} RF PAID 50/25/25.`, 184)) { if (y < BY + 124) p.text(line, 8, y, "lime"); y += LINE_H; }
    }
    this.drawStandings(PX, PY, PW, PH);
    p.text(`ROUND ${s.round.index} · ${s.daysLeft} DAY${s.daysLeft === 1 ? "" : "S"} LEFT · POT ${formatRf(s.round.pot)} RF`, 4, STRIP_Y, "black");
    p.text(`BLOCK ${s.block.toLocaleString("en-US")} OF ${s.round.endBlock.toLocaleString("en-US")}`, 4, STRIP_Y + 7, "black");
    this.button("start", 4, BAR_Y, 78, `START DAY ${s.day} ►`, () => { this.buildId = `${YOU}/0,0`; this.selection = s.coreLevel ? null : { kind: "core" }; this.go({ kind: "build" }); }, { primary: true });
    this.ui.settle("start");
  }

  private drawStandings(x: number, y: number, w: number, h: number) {
    const s = this.session!, p = this.p;
    p.panel(x, y - 1, w, h + 1);
    p.rect(x + 1, y, w - 2, 8, "lime");
    p.rect(x + 1, y + 8, w - 2, 1, "black");
    if (w >= 150) p.big(`ROUND ${s.round.index} STANDINGS`, x + 3, y, "black"); else p.text(`ROUND ${s.round.index} STANDINGS`, x + 3, y + 1, "black");
    let ly = y + 10;
    p.text("WINS  CAPTURED", x + w - 60, ly, "black"); ly += LINE_H;
    s.standings().forEach((st, i) => {
      p.text(`${i + 1}. ${st.name}`.slice(0, 15), x + 3, ly, "black");
      if (st.you) { p.rect(x + 1, ly - 1, w - 2, 7, "lime"); p.text(`${i + 1}. ${st.name}`.slice(0, 15), x + 3, ly, "black"); }
      p.textRight(`${st.wins}   ${formatRf(st.captured)}`, x + w - 3, ly, "black");
      if (i < 3 && w >= 150) p.text(["50%", "25%", "25%"][i], x + w - 90, ly, "pink");
      ly += LINE_H;
    });
  }

  private drawRound() {
    const s = this.session!, p = this.p;
    this.drawStandings(4, BY, 192, 130);
    this.panelHeader("REWARD POT", "lime");
    let y = PY + 10;
    const lines = [`POT ${formatRf(s.round.pot)} RF`, `ROUND ${s.round.index} · ${s.daysLeft} DAY${s.daysLeft === 1 ? "" : "S"} LEFT`, `${s.blocksLeft.toLocaleString("en-US")} BLOCKS TO GO`, "",
      ...wrap(`EXPANSIONS (${EXPAND_COST}), FLAG CLAIMS (${CLAIM_COST}) AND RECLAIMS (${RECLAIM_COST}) FEED THE POT. AFTER ${ROUND_DAYS} DAYS OF BLOCKS THE TOP 3 BY WINS TAKE 50 / 25 / 25%.`, PW - 6),
      "", ...wrap("A WIN = CLEARING EVERY REGION OF A RIVAL'S TERRITORY. EVICTING A RESIDENT AT HOME SCORES NOTHING.", PW - 6)];
    for (const line of lines) { if (y < PY + PH - 4) p.text(line, PX + 3, y, "black"); y += LINE_H; }
    p.text(`A DAY IS ${BLOCKS_PER_DAY.toLocaleString("en-US")} BLOCKS (ABOUT 0.1 S EACH)`, 4, STRIP_Y, "black");
    p.text(`ROUND ENDS AT BLOCK ${s.round.endBlock.toLocaleString("en-US")} · NOW ${s.block.toLocaleString("en-US")}`, 4, STRIP_Y + 7, "black");
    this.button("back", 4, BAR_Y, 40, "◄ BACK", () => this.go({ kind: "build" }));
    this.button("territory", 48, BAR_Y, 58, "TERRITORY", () => this.go({ kind: "territory", sel: null }));
    p.text("T TERRITORY · ESC BACK", 122, HINT_Y, "black");
  }

  // ------------------------------------------------------------------ help

  /** Illustrated versus title card with canonical Friend icons. Returns the y where help text may start. */
  private drawCover(s: Session) {
    const p = this.p, cx = LOGICAL_W / 2, board = s.home().board;
    p.withClip(5, BY + 12, 309, 98, () => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 20; x++) {
        const tile = tileAt(board, x % GRID_W, y % GRID_H);
        this.art.tile(tile.kind, 5 + x * 16, BY + 12 + y * 16, x, y, { scenery: board.scenery, dir: tile.dir, frame: this.anim });
      }
    });
    p.panel(29, BY + 15, 262, 25);
    p.bigCenter("REAL FRENEMIES / VERSUS", cx, BY + 20, "black");
    p.textCenter("BUILD YOUR HOME. RAID YOUR RIVALS.", cx, BY + 31, "pink");
    this.art.scenery(4, 18, BY + 56, 42); this.art.scenery(3, 263, BY + 57, 42);
    const step = this.reducedMotion ? 0 : Math.floor(this.now / 200);
    p.panel(cx - 28, BY + 46, 56, 56, "lime");
    p.sprite(spriteBits(s.player, "down", false, step), cx - 24, BY + 50, "black", { scale: 3 });
    for (const [i, x] of [[0, 68], [2, 218]]) {
      p.panel(x - 3, BY + 55, 38, 39, "black");
      p.sprite(spriteBits(s.rivals[i].core, "down", false, step), x, BY + 58, "white", { scale: 2 });
    }
    p.big("VS", 112, BY + 69, "black"); p.big("VS", 197, BY + 69, "black");
    p.rect(28, BY + 104, 264, 9, "white");
    p.textCenter("YOUR FRIEND #" + s.player.tokenId + " / ALL RF SIMULATED", cx, BY + 106, "black");
    return BY + 119;
  }

  private drawHelp(screen: Extract<Screen, { kind: "help" }>) {
    const p = this.p;
    const pages = helpPages(this.session);
    const page = pages[screen.page];
    p.panel(4, BY - 1, LOGICAL_W - 9, BAR_Y - BY - 3);
    p.rect(5, BY, LOGICAL_W - 11, 9, "black");
    if (bigWidth(page.title) <= LOGICAL_W - 40) p.big(page.title, 8, BY + 1, "white"); else p.text(page.title, 8, BY + 2, "white");
    p.textRight(`${screen.page + 1}/${pages.length}`, LOGICAL_W - 10, BY + 2, "lime");
    let y = BY + 13;
    if (page.cover && this.session) y = this.drawCover(this.session);
    for (const para of page.body) {
      for (const line of wrap(para.toUpperCase(), LOGICAL_W - 16)) { if (y < BAR_Y - 8) p.text(line, 8, y, "black"); y += LINE_H; }
      y += 2;
    }
    if (page.kits) {
      const names = Object.keys(CLASSES) as (keyof typeof CLASSES)[];
      names.forEach((c, i) => {
        const def = CLASSES[c], x = 8 + (i % 3) * 102, ky = BY + 12 + Math.floor(i / 3) * 52;
        const sample = POOL.find(f => f.character === c)!;
        p.sprite(spriteBits(sample, "down", false, this.reducedMotion ? 0 : Math.floor(this.now / 220)), x, ky, "black");
        p.text(c.toUpperCase(), x + 19, ky + 1, "black");
        p.text(`${def.reach.toUpperCase()} · ${def.trait.split(":")[0].toUpperCase()}`.slice(0, 19), x + 19, ky + 8, "black");
        let ly = ky + 18;
        for (const [tag, pw] of [["D", def.defense], ["R", def.offense], ["4", def.upgrade]] as const) {
          for (const line of wrap(`${tag} ${pw.name}: ${pw.text}`.toUpperCase(), 96).slice(0, 2)) { p.text(line, x, ly, "black"); ly += 6; }
        }
      });
    }
    this.button("prev", 4, BAR_Y, 44, "◄ PREV", () => { screen.page = Math.max(0, screen.page - 1); }, { disabled: screen.page === 0 });
    this.button("next", 52, BAR_Y, 44, "NEXT ►", () => { screen.page = Math.min(pages.length - 1, screen.page + 1); }, { disabled: screen.page === pages.length - 1 });
    this.button("close", 100, BAR_Y, 64, screen.back.kind === "build" && !this.session?.history.length && this.session?.day === 1 ? "START BUILDING" : "CLOSE", () => this.go(screen.back), { primary: true });
    if (this.session?.broke) this.button("restart", 168, BAR_Y, 60, "RESTART SIM", () => { this.session!.restart(); this.buildId = `${YOU}/0,0`; this.selection = { kind: "core" }; this.go({ kind: "build" }); });
    p.text("TAB / ENTER OR CLICK · H HELP · M SOUND", 122, HINT_Y, "black");
    this.ui.settle("close");
  }
}

function resultTitle(record: RaidRecord): string {
  const c = record.campaign;
  switch (record.kind) {
    case "practice": return c.won ? "Practice: cleared" : "Practice: held";
    case "raid": return c.won ? "Raid won" : c.battles.some(b => b.result.defeated.length) ? "Raid partly paid" : "Raid failed";
    case "reclaim": return c.won ? "Resident evicted" : "Reclaim failed";
    case "defense": return c.won ? (record.reset ? "Core lost" : "Territory lost") : "Territory held";
    case "outpost": return c.won ? "Outpost lost" : "Outpost held";
  }
}

type HelpPage = { title: string; body: string[]; kits?: boolean; cover?: boolean };
function helpPages(session: Session | null): HelpPage[] {
  const you = session?.player;
  const aff = you ? AFFINITY[you.scenery] : null;
  return [
    { title: "WELCOME", cover: true, body: [
      you ? `Your Friend is the Core of a ${you.scenery} territory generated from its token. Garrison it with recruits, raid your frenemies, buy their flags and top the round for the pot.` : "Your Friend is the Core of a territory generated from its token.",
      "Every piece's powers come from its on-chain traits. Next for the rules, or start building.",
    ] },
    { title: "HOW A DAY WORKS", body: [
      you ? `Your Friend #${you.tokenId} (${you.character}) is the Core. If a raid knocks it out, your home board resets.` : "If a raid knocks out your Core, your home board resets.",
      "Day loop: build your garrisons, optionally raid a rival, then defend against tonight's raid while the ghosts fight each other. Raiders leave their tile empty at home until the next day.",
      `Build: pick a Friend from the recruit pool, then a dotted tile. Placing stakes 1 RF; level-ups top up 1, 2 and 4 RF (8 RF at max). Each region has ${SUPPLY_PER_REGION} supply and a piece uses its level: six level-2 pieces or three level-4s.`,
      "Raid: pick up to 4 attackers, a lane and a route. Your party fights every region of the rival's territory in the order you choose, carrying its wounds. Clear every defender on every region and it's a win. Practice any raid again for free from its result.",
      "Tonight's raid is fixed at dawn from your threat level (up after nights you hold, down after nights you lose). Knocking out its raiders in your own raid keeps them home.",
      "Recruits are real Generations Friends from a fixed public pool, because the SDK only shares the one Friend you selected. All RF here is simulated.",
    ] },
    { title: "TERRITORY, FLAGS AND THE POT", body: [
      `Expand for ${EXPAND_COST} RF into a region next to your land (up to 4). Each extra region holding ${GARRISON_FOR_BONUS}+ of your pieces gives +${Math.round(REGION_BONUS * 100)}% attack on raids and +${Math.round(REGION_BONUS * 100)}% HP on defense. Raiders must clear all of it to beat you.`,
      `Beat a rival (clear every region) and you may buy one of its flags for ${CLAIM_COST} RF: you become resident there and garrison it. One flag per win. The same can happen to you.`,
      `Whoever is beaten, or loses their Core, rebuilds: nobody can raid them for ${REBUILD_NIGHTS} nights. Raiding someone else ends that protection early.`,
      `To take a region back, evict the resident with a reclaim raid (its own daily raid; no win scored), then pay ${RECLAIM_COST} RF to raise your flag.`,
      `Expansions, claims and reclaims feed the round's pot; winning raids' fees fill the treasury, which seeds the next pot. A round is ${ROUND_DAYS} days of blocks; the top 3 by wins split the pot 50 / 25 / 25.`,
    ] },
    { title: "RF STAKES AND SETTLEMENT", body: [
      "Raid fee: 2 RF + 1 RF per attacker (3-6 RF). 20% of every fee is burned.",
      "Every defender a raid knocks out pays its stake to the raider; 10% of it is burned. Knock out a Core and the raider takes its stake too, and that home resets (survivors' stakes are returned).",
      "Failed raid: whoever held the region that stopped it keeps 80% of the fee. Winning raid: 80% goes to the treasury. The ghosts pay from finite wallets too, and re-stake their losses each morning.",
      "Level-up top-ups are stake, not burn. Market pieces on a Market base Haggle: they only pay half their stake.",
    ] },
    { title: "TRAITS ARE POWERS", body: [
      "Character is the class and its three powers (defense, raid, max level). Generation sets the stat budget and power slots: Gen 1-2 get Character + Scenery + Floor, Gen 3-4 Character + Scenery, Gen 5-6 Character only.",
      "Scenery: a piece whose Scenery matches the region it stands on gets its affinity bonus (needs a Scenery slot). Expanded regions have their own Scenery. Floor: movement pattern; the quirk needs a Floor slot.",
      "Activation tier adds 1 HP per tier and, at tier 4, unlocks the max-level power at level 3. Active pieces regenerate 1 HP every 10 ticks.",
      aff ? `Your home (${you!.scenery}): ${aff.terrain}. ${you!.scenery} pieces: ${aff.bonus}.` : "",
      `Floors: ${Object.entries(FLOOR_RULES).map(([k, v]) => `${k} ${v.moves.toLowerCase()} (${v.quirk.toLowerCase()})`).join("; ")}.`,
    ] },
    { title: "ROCK PAPER SCISSORS", body: [
      "Reach: melee beats ranged (they close the gap), ranged beats flyers (only they hit them, for double), flyers beat melee (immune to it).",
      "Numbers: area beats swarm (one Nova hits all three Family minis), swarm beats single-target, single-target beats area casters (low HP).",
      "Mask and Cellular support whoever is next to them; terrain breaks ties. Scout a base's regions and pieces before you pick attackers.",
      "Level-ups sharpen a role, they don't change it: a level 4 Skeleton still can't touch a level 1 Hoverer.",
    ] },
    { title: "THE 9 KITS (D DEFENSE, R RAID, 4 MAX LEVEL)", body: [], kits: true },
    { title: "EXACT RULES", body: [
      "Library tiles: a unit standing on one can't use its D, R or 4 powers or its Scenery affinity. Class traits (flight, Family's three bodies, Hollow's half melee damage, ranged double vs flyers), Floor movement and quirks, basic attacks and Active regeneration still work.",
      "Turn order each tick: start-of-tick effects, then defenders in placement order, then the Core, then raiders in party order.",
      "Each region of a raid is its own battle: once-per-battle effects (Reassemble, Reunion, Phase-step, Dive, Ambush, first-hit bonuses) reset; HP does not.",
      "Raiders head for the Core while it stands, then hunt the nearest defender they can hit. Melee and flying defenders leave their post by up to 2 tiles to intercept.",
      "Knocked-out raiders aren't captured: they sit out until morning. Every defender knocked out pays its stake.",
    ] },
    { title: "CONTROLS", body: [
      "Mouse / touch: click a Friend, then a tile. Buttons along the bottom.",
      "Keyboard: Tab / Shift+Tab move focus, Enter selects, arrows move the board cursor or the roster pick. R raid, E end day, L level up, X remove, [ ] switch region, T territory, O round, H help, M sound, Esc back.",
      "Playback: Space pause, left / right seek 2 s, F toggles 2x, Esc skips to results. Reduce motion (FX LOW) steps replays at 4 per second with no particles or shake.",
      `Recruit pool snapshot from Robinhood mainnet block ${POOL_SOURCE.blockNumber} (${POOL_SOURCE.readAt}). Economy, raids and rivals are simulated for the Vibeathon preview; reloading starts a new session.`,
    ] },
  ];
}

export { regionKey };
