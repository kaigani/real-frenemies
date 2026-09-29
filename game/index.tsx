"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { App, NATIVE_H, NATIVE_W } from "./src/app.ts";
import { TacticsApp } from "./src/tactics-app.ts";
import "./style.css";

type View = { muted: boolean; reducedMotion: boolean; screen: string };

/** Thin adapter: the SDK runtime supplies the verified Friend, the fixed action client and the pause state. */
export default function RealFrenemies({ friendId, client, paused }: GameComponentProps) {
  const wrap = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const app = useRef<App | TacticsApp | null>(null);
  const [mode, setMode] = useState<"campaign" | "territory">("campaign");
  const [status, setStatus] = useState("Loading Real Frenemies…");
  const [view, setView] = useState<View>({ muted: true, reducedMotion: false, screen: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    const kit = createFriendSoundKit({ muted: true });
    const ctx = canvas.current!.getContext("2d", { alpha: false })!;
    setError(null);
    // Read the runtime snapshot first so the runtime finishes loading. The game keeps its own simulated ledger.
    client.read().then(snapshot => {
      if (disposed) return;
      if (snapshot.friendId !== friendId) throw new Error("This game session does not match the selected Friend.");
      const host = {
        friendId,
        play: (cue: Parameters<typeof kit.play>[0]) => { kit.play(cue); },
        setMuted: (muted: boolean) => { kit.setMuted(muted); if (!muted) void kit.unlock(); },
        announce: (text: string) => setStatus(text),
        onState: (state: View) => setView(state),
      };
      const instance = mode === "campaign" ? new TacticsApp(ctx, host, () => setMode("territory")) : new App(ctx, host);
      instance.setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      app.current = instance;
      instance.start();
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not start the game session."); });
    return () => { disposed = true; app.current?.dispose(); app.current = null; kit.dispose(); };
  }, [client, friendId, attempt, mode]);

  useEffect(() => { app.current?.setPaused(paused); }, [paused, view.screen]);

  // Whole-number scale in device pixels, so every native pixel is an exact square block. Offsets are whole too.
  useEffect(() => {
    const box = wrap.current!, c = canvas.current!;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(box.clientWidth * dpr), h = Math.round(box.clientHeight * dpr);
      const scale = Math.max(1, Math.floor(Math.min(w / NATIVE_W, h / NATIVE_H)));
      const cw = NATIVE_W * scale, ch = NATIVE_H * scale;
      c.style.width = `${cw / dpr}px`;
      c.style.height = `${ch / dpr}px`;
      box.style.setProperty("--rf-canvas-height", `${ch / dpr}px`);
      c.style.left = `${Math.floor((w - cw) / 2) / dpr}px`;
      // With spare height (narrow 4:3 frames), pin to the top so the runtime toolbar sits in the band below.
      const spare = h - ch;
      c.style.top = `${(spare >= 24 * dpr ? 0 : Math.floor(spare / 2)) / dpr}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, []);

  const toNative = (event: PointerEvent<HTMLCanvasElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - r.left) * NATIVE_W / r.width, (event.clientY - r.top) * NATIVE_H / r.height] as const;
  };
  const touchKey = (key: string) => { if (!paused) app.current?.key(new KeyboardEvent("keydown", { key })); };
  const battle = view.screen === "tactics-battle";

  return <section className="rf-game" aria-label="Real Frenemies" ref={wrap}>
    <canvas ref={canvas} width={NATIVE_W} height={NATIVE_H} tabIndex={0} role="application"
      aria-label={mode === "campaign" ? "The Lantern Road. Turn-based battlefield. 1, 2, 3 select friends. Arrows move cursor; Enter selects. A attacks; S skill; G guard; E end turn; U undo; H help." : "Real Frenemies territory board. Tab moves between controls, Enter selects, arrows move the cursor, H opens help."}
      aria-busy={view.screen === "loading" || view.screen === "tactics-loading"}
      onPointerDown={event => {
        event.currentTarget.focus({ preventScroll: true });
        if (paused) return;
        const [x, y] = toNative(event);
        app.current?.pointer(x, y);
      }}
      onPointerMove={event => { const [x, y] = toNative(event); if (app.current instanceof TacticsApp) app.current.hover(x, y); }}
      onKeyDown={event => { if (app.current?.key(event.nativeEvent)) event.preventDefault(); }} />
    <div className="rf-sr" role="toolbar" aria-label="Game settings">
      <button type="button" aria-pressed={!view.muted} disabled={paused} onClick={() => app.current?.setMuted(!view.muted)}>{view.muted ? "Sound off" : "Sound on"}</button>
      <button type="button" aria-pressed={view.reducedMotion} disabled={paused} onClick={() => app.current?.setReducedMotion(!view.reducedMotion)}>Reduce motion</button>
      <button type="button" disabled={paused} onClick={() => setMode(mode === "campaign" ? "territory" : "campaign")}>{mode === "campaign" ? "Territory mode (resets campaign)" : "Campaign mode (resets territory)"}</button>
    </div>
    <p className="rf-sr" role="status" aria-live="polite">{status}</p>
    {mode === "campaign" && <div className="rf-touch" aria-label="Touch command deck">
      <p className="rf-touch-summary">{app.current instanceof TacticsApp ? app.current.summary() : "Waking the forest…"}</p>
      <p className="rf-touch-status">{status}</p>
      {battle ? <>
        <div className="rf-touch-row">{[["1", "Pip"], ["2", "Rook"], ["3", "Moss"], ["u", "Undo"], ["h", "Help"], ["l", "Log"]].map(([key, label]) => <button key={key} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
        <div className="rf-touch-row">{[["ArrowLeft", "←", "Cursor left"], ["ArrowUp", "↑", "Cursor up"], ["ArrowDown", "↓", "Cursor down"], ["ArrowRight", "→", "Cursor right"], ["Enter", "Select", "Select or confirm target"]].map(([key, label, name]) => <button key={key} aria-label={name} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
        <div className="rf-touch-row">{[["a", "Attack"], ["s", "Skill"], ["g", "Guard"], ["Escape", "Cancel"], ["e", "End turn"]].map(([key, label]) => <button key={key} disabled={paused} type="button" onClick={() => touchKey(key)}>{label}</button>)}</div>
      </> : <div className="rf-touch-row">{view.screen === "tactics-chapters" && <button type="button" disabled={paused} onClick={() => touchKey("ArrowUp")}>Previous</button>}<button type="button" disabled={paused} onClick={() => touchKey("Enter")}>{view.screen === "tactics-title" ? "Start adventure" : view.screen === "tactics-help" || view.screen === "tactics-log" ? "Back to the road" : view.screen === "tactics-chapters" ? "Play chapter" : "Continue"}</button>{view.screen === "tactics-chapters" ? <button type="button" disabled={paused} onClick={() => touchKey("ArrowDown")}>Next</button> : <button type="button" disabled={paused} onClick={() => touchKey("h")}>Field guide</button>}{view.screen === "tactics-result" && <button type="button" disabled={paused} onClick={() => touchKey("c")}>Chapters</button>}<button type="button" disabled={paused} onClick={() => touchKey("m")}>{view.muted ? "Sound off" : "Sound on"}</button></div>}
    </div>}
    {error && <div className="rf-overlay" role="alert">
      <p>{error}</p>
      <button type="button" disabled={paused} onClick={() => setAttempt(n => n + 1)}>Retry</button>
    </div>}
  </section>;
}
