"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { App, NATIVE_H, NATIVE_W } from "./src/app.ts";
import { TacticsApp } from "./src/tactics-app.ts";
import { TACTICS_W, TACTICS_H } from "./src/tactics-view.ts";
import "./style.css";

type View = { muted: boolean; reducedMotion: boolean; screen: string };

/** Thin adapter: the SDK runtime supplies the verified Friend, the fixed action client and the pause state. */
export default function RealFrenemies({ friendId, client, paused }: GameComponentProps) {
  const wrap = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const app = useRef<App | TacticsApp | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const navigate = useRef<(target: "menu" | "battle" | "campaign" | "guide") => void>(() => {});
  const [mode, setMode] = useState<"campaign" | "territory">("campaign");
  const nativeWidth = mode === "campaign" ? TACTICS_W : NATIVE_W;
  const nativeHeight = mode === "campaign" ? TACTICS_H : NATIVE_H;
  const [status, setStatus] = useState("Loading Real Frenemies…");
  const [view, setView] = useState<View>({ muted: true, reducedMotion: false, screen: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let disposeInstances = () => {};
    const kit = createFriendSoundKit({ muted: true });
    const ctx = canvas.current!.getContext("2d", { alpha: false })!;
    setError(null);
    // Read the runtime snapshot first so the runtime finishes loading. The game keeps its own simulated ledger.
    client.read().then(snapshot => {
      if (disposed) return;
      if (snapshot.friendId !== friendId) throw new Error("This game session does not match the selected Friend.");
      let campaign: TacticsApp;
      let battleApp: App | null = null;
      const hostFor = (kind: "campaign" | "battle") => ({
        friendId,
        mainMenu: () => navigate.current("menu"),
        play: (cue: Parameters<typeof kit.play>[0]) => { kit.play(cue); },
        setMuted: (muted: boolean) => { kit.setMuted(muted); if (!muted) void kit.unlock(); },
        announce: (text: string) => { if (kind === "campaign" ? app.current === campaign : app.current === battleApp) setStatus(text); },
        onState: (state: View) => { if (kind === "campaign" ? app.current === campaign : app.current === battleApp) setView(state); },
      });
      const activate = (instance: App | TacticsApp, mode: "campaign" | "territory") => {
        const previous = app.current;
        previous?.setActive(false);
        app.current = instance;
        instance.setMuted(previous?.muted ?? true);
        instance.setReducedMotion(previous?.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        instance.setPaused(pausedRef.current);
        instance.setActive(true);
        setMode(mode);
      };
      campaign = new TacticsApp(ctx, hostFor("campaign"), () => navigate.current("battle"));
      navigate.current = target => {
        if (disposed) return;
        if (target === "battle") {
          const fresh = !battleApp;
          battleApp ??= new App(ctx, hostFor("battle"));
          activate(battleApp, "territory");
          if (fresh) battleApp.start();
        } else {
          activate(campaign, "campaign");
          if (target === "menu") campaign.showMenu();
          else campaign.chooseMode(target);
        }
      };
      disposeInstances = () => { campaign.dispose(); battleApp?.dispose(); };
      activate(campaign, "campaign");
      campaign.start();
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not start the game session."); });
    return () => { disposed = true; disposeInstances(); app.current = null; navigate.current = () => {}; kit.dispose(); };
  }, [client, friendId, attempt]);

  useEffect(() => { app.current?.setPaused(paused); }, [paused, view.screen]);

  // Both modes share the HD display and reserve a readable touch command deck on narrow screens.
  useEffect(() => {
    const box = wrap.current!, c = canvas.current!;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const bounds = box.getBoundingClientRect();
      const w = Math.floor(bounds.width * dpr), h = Math.floor(bounds.height * dpr);
      const deckHeight = box.clientWidth <= 640 ? 245 * dpr : 0;
      const fitScale = Math.min(w / nativeWidth, (h - deckHeight) / nativeHeight);
      // Both modes use the same native 5x7 font. Enlarge at whole device-pixel multiples.
      // Low-DPI phones that cannot fit 640 physical pixels retain the compact overview and touch deck.
      const scale = fitScale >= 1 ? Math.floor(fitScale) : Math.max(.25, fitScale);
      const cw = Math.round(nativeWidth * scale), ch = Math.round(nativeHeight * scale);
      c.style.width = `${cw / dpr}px`;
      c.style.height = `${ch / dpr}px`;
      box.style.setProperty("--rf-canvas-height", `${ch / dpr}px`);
      c.style.left = `${(Math.round(bounds.left * dpr + (w - cw) / 2) - bounds.left * dpr) / dpr}px`;
      // With spare height (narrow 4:3 frames), pin to the top so the runtime toolbar sits in the band below.
      const spare = h - ch;
      const top = spare >= 24 * dpr ? 0 : Math.floor(spare / 2);
      c.style.top = `${(Math.round(bounds.top * dpr + top) - bounds.top * dpr) / dpr}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [mode, nativeWidth, nativeHeight]);

  const toNative = (event: PointerEvent<HTMLCanvasElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - r.left) * nativeWidth / r.width, (event.clientY - r.top) * nativeHeight / r.height] as const;
  };
  const touchKey = (key: string) => { if (!paused) app.current?.key(new KeyboardEvent("keydown", { key: key === "ShiftTab" ? "Tab" : key, shiftKey: key === "ShiftTab" })); };
  const battle = view.screen === "tactics-battle";
  const mainMenu = view.screen === "tactics-title";
  const menuButton = <button type="button" disabled={paused} onClick={() => navigate.current("menu")}>Main menu</button>;

  return <section className="rf-game" aria-label="Real Frenemies" ref={wrap}>
    <canvas ref={canvas} width={nativeWidth} height={nativeHeight} tabIndex={0} role="application"
      aria-label={mainMenu ? "Real Frenemies main menu. PvP Battle, Campaign, Guide. Tab chooses; Enter selects." : mode === "campaign" ? "The Lantern Road. Turn-based battlefield. 1, 2, 3 select friends. Arrows move cursor; Enter selects. A attacks; S skill; G guard; E end turn; U undo; H help." : "Real Frenemies territory board. Tab moves between controls, Enter selects, arrows move the cursor, H opens help."}
      aria-busy={view.screen === "loading" || view.screen === "tactics-loading"}
      onPointerDown={event => {
        event.currentTarget.focus({ preventScroll: true });
        if (paused) return;
        const [x, y] = toNative(event);
        app.current?.pointer(x, y);
      }}
      onPointerMove={event => { const [x, y] = toNative(event); if (app.current instanceof TacticsApp) app.current.hover(x, y); }}
      onKeyDown={event => { if (event.key === "Home" && !paused) { navigate.current("menu"); event.preventDefault(); } else if (app.current?.key(event.nativeEvent)) event.preventDefault(); }} />
    <div className="rf-sr" role="toolbar" aria-label="Game settings">
      <button type="button" aria-pressed={!view.muted} disabled={paused} onClick={() => app.current?.setMuted(!view.muted)}>{view.muted ? "Sound off" : "Sound on"}</button>
      <button type="button" aria-pressed={view.reducedMotion} disabled={paused} onClick={() => app.current?.setReducedMotion(!view.reducedMotion)}>Reduce motion</button>
      {mainMenu ? (["battle", "campaign", "guide"] as const).map(target => <button key={target} type="button" disabled={paused} onClick={() => navigate.current(target)}>{target === "battle" ? "PvP Battle" : target === "campaign" ? "Campaign" : "Guide"}</button>) : menuButton}
    </div>
    <p className="rf-sr" role="status" aria-live="polite">{status}</p>
    {mode === "territory" && <div className="rf-touch" aria-label="Battle command deck">
      <p className="rf-touch-summary">{app.current instanceof App ? app.current.summary() : "Preparing your territory"}</p>
      <p className="rf-touch-status">{status}</p>
      <div className="rf-touch-row">{menuButton}{[["ShiftTab", "Previous"], ["Tab", "Next control"], ["Enter", "Select"], ["Escape", "Back"], ["h", "Help"]].map(([key, label]) => <button key={key} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
      <div className="rf-touch-row">{[["ArrowLeft", "←", "Cursor left"], ["ArrowUp", "↑", "Cursor up"], ["ArrowDown", "↓", "Cursor down"], ["ArrowRight", "→", "Cursor right"]].map(([key, label, name]) => <button key={key} aria-label={name} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
      <div className="rf-touch-row">{(view.screen === "playback" ? [[" ", "Pause / play"], ["f", "Speed"], ["Escape", "Results"]] : view.screen === "build" ? [["r", "Raid"], ["e", "Defend"], ["t", "Territory"], ["o", "Standings"]] : [["m", "Sound"], ["Enter", "Confirm"]]).map(([key, label]) => <button key={key} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
    </div>}
    {mode === "campaign" && <div className="rf-touch" aria-label="Touch command deck">
      <p className="rf-touch-summary">{app.current instanceof TacticsApp ? app.current.summary() : "Waking the forest…"}</p>
      <p className="rf-touch-status">{status}</p>
      {mainMenu ? <div className="rf-touch-row">{(["battle", "campaign", "guide"] as const).map(target => <button key={target} type="button" disabled={paused} onClick={() => navigate.current(target)}>{target === "battle" ? "PvP Battle" : target === "campaign" ? "Campaign" : "Guide"}</button>)}</div> : view.screen === "tactics-guide" ? <div className="rf-touch-row">{menuButton}<button type="button" disabled={paused} onClick={() => navigate.current("battle")}>PvP Battle</button><button type="button" disabled={paused} onClick={() => touchKey("h")}>Campaign rules</button></div> : battle ? <>
        <div className="rf-touch-row">{[["1", "Pip"], ["2", "Rook"], ["3", "Moss"], ["u", "Undo"], ["h", "Help"], ["l", "Log"]].map(([key, label]) => <button key={key} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
        <div className="rf-touch-row">{[["ArrowLeft", "←", "Cursor left"], ["ArrowUp", "↑", "Cursor up"], ["ArrowDown", "↓", "Cursor down"], ["ArrowRight", "→", "Cursor right"], ["Enter", "Select", "Select or confirm target"]].map(([key, label, name]) => <button key={key} aria-label={name} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
        <div className="rf-touch-row">{menuButton}{[["a", "Attack"], ["s", "Skill"], ["g", "Guard"], ["Escape", "Cancel"], ["e", "End turn"]].map(([key, label]) => <button key={key} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
      </> : <div className="rf-touch-row">{menuButton}{view.screen === "tactics-chapters" && <button type="button" disabled={paused} onClick={() => touchKey("ArrowUp")}>Previous</button>}<button type="button" disabled={paused} onClick={() => touchKey("Enter")}>{view.screen === "tactics-help" || view.screen === "tactics-log" ? "Back to the road" : view.screen === "tactics-chapters" ? "Play chapter" : "Continue"}</button>{view.screen === "tactics-chapters" ? <button type="button" disabled={paused} onClick={() => touchKey("ArrowDown")}>Next</button> : <button type="button" disabled={paused} onClick={() => touchKey("h")}>Field guide</button>}{view.screen === "tactics-result" && <button type="button" disabled={paused} onClick={() => touchKey("c")}>Chapters</button>}<button type="button" disabled={paused} onClick={() => touchKey("m")}>{view.muted ? "Sound off" : "Sound on"}</button></div>}
    </div>}
    {error && <div className="rf-overlay" role="alert">
      <p>{error}</p>
      <button type="button" disabled={paused} onClick={() => setAttempt(n => n + 1)}>Retry</button>
    </div>}
  </section>;
}
