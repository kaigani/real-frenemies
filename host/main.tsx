import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ConnectedGameHost } from "@rarefriends/friendsdk/runtime";
import { createFriendPublicClient, createFriendWalletSession, type FriendWalletSession } from "@rarefriends/friendsdk/wallet";
import { createGenerationSpriteReader, spriteFrame } from "@rarefriends/friendsdk/sprites";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import type { OwnedFriend } from "@rarefriends/friendsdk/owned";
import definitionJson from "../game/game.json";
import { characterUrl } from "../game/assets/lantern/packed.ts";
import { discoverFriends, verifyFriend } from "./discovery.ts";
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/runtime.css";
import "../game/host.css";
import "./style.css";

const definition = parseChanceGame(definitionJson), client = createFriendPublicClient();
const sprites = createGenerationSpriteReader(client);
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function FriendIcon({ id }: { id: bigint }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void sprites.read(id).then(art => {
      if (!alive || !canvas.current) return;
      const ctx = canvas.current.getContext("2d")!, bits = spriteFrame(art, "down", false, 0).frame.bitmap;
      ctx.clearRect(0, 0, 16, 16); ctx.fillStyle = "#182c24";
      for (let i = 0; i < 256; i++) if ((bits >> BigInt(i)) & 1n) ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
    }).catch(() => { /* Identity remains selectable if the optional artwork service is unavailable. */ });
    return () => { alive = false; };
  }, [id]);
  return <canvas ref={canvas} width={16} height={16} aria-hidden="true" />;
}

function Setup({ session }: { session: FriendWalletSession }) {
  const wallet = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [attempt, setAttempt] = useState(0), [progress, setProgress] = useState([0, 0]);
  const [result, setResult] = useState<{ revision: number; attempt: number; friends: readonly OwnedFriend[]; hidden: number; error?: string } | null>(null);
  const [selection, setSelection] = useState<{ revision: number; friend: OwnedFriend } | null>(null);
  const [playing, setPlaying] = useState(false), [manual, setManual] = useState(""), [manualBusy, setManualBusy] = useState(false), [manualError, setManualError] = useState("");
  const manualRequest = useRef<AbortController | null>(null);
  const connected = wallet.status === "connected", valid = connected && result?.revision === wallet.revision && result.attempt === attempt ? result : null;
  const chosen = connected && selection?.revision === wallet.revision ? selection.friend : null;
  const loading = connected && !valid;
  useEffect(() => {
    setPlaying(false); setSelection(null); setManualError(""); setManualBusy(false); setProgress([0, 0]);
    manualRequest.current?.abort();
    if (!connected || !wallet.account) return;
    const controller = new AbortController();
    void discoverFriends(client, wallet.account, controller.signal, (done, total) => { if (!controller.signal.aborted) setProgress([done, total]); }).then(value => {
      if (!controller.signal.aborted) setResult({ revision: wallet.revision, attempt, friends: value.friends, hidden: value.hiddenCount });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ revision: wallet.revision, attempt, friends: [], hidden: 0, error: "Your wallet is connected, but we couldn't finish loading your Friends. Try again, or look up a Friend by number below." });
    });
    return () => { controller.abort(); manualRequest.current?.abort(); };
  }, [wallet.revision, wallet.account, connected, attempt]);

  async function findFriend(event: React.FormEvent) {
    event.preventDefault(); if (!wallet.account || !connected || manualBusy) return;
    manualRequest.current?.abort(); const controller = new AbortController(); manualRequest.current = controller;
    setManualBusy(true); setManualError(""); const revision = wallet.revision;
    try {
      const friend = await verifyFriend(client, wallet.account, manual, controller.signal);
      if (session.getSnapshot().revision === revision && !controller.signal.aborted) setSelection({ revision, friend });
    } catch (error) {
      if (!controller.signal.aborted) setManualError(error instanceof Error && /Enter a valid|belongs to|generation 0/.test(error.message) ? error.message : "Couldn't check that Friend right now. Please try again.");
    } finally { if (!controller.signal.aborted) setManualBusy(false); }
  }

  return <div className="lantern-host">
    <header className="host-header"><a className="host-brand" href="./" aria-label="Real Frenemies home">RF<span>RARE FRIENDS<br />THE LANTERN ROAD</span></a><span className="host-edition">A POCKET TACTICAL ADVENTURE</span><a href="./demo/">Try the demo ↗</a></header>
    {playing && chosen ? <section className="play-shell" aria-label="The Lantern Road">
      <div className="play-heading"><span>● &nbsp; {chosen.label} / {short(wallet.account!)}</span><button onClick={() => setPlaying(false)}>Back to setup</button></div>
      <ConnectedGameHost definition={definition} frameUrl="./game.html" selectedFriend={chosen} account={wallet.account} chainId={wallet.chainId} publicClient={client} revision={wallet.revision} />
      <p className="play-note">Returning to setup restarts the adventure. Progress lasts for this session.</p>
    </section> : <main className="setup-shell">
      <section className="setup-story" aria-label="Welcome to The Lantern Road">
        <p className="eyebrow">REAL FRENEMIES / VOL. 01</p><h1>The Lantern<br />Road</h1><p className="story-tagline">Three friends.<br />One last light.</p>
        <div className="setup-art" role="img" aria-label="Pip, the horned woodland warden" style={{ backgroundImage: `url("${characterUrl}")` }} />
        <blockquote>“Ready when you are.<br />Let's bring the light home.”<cite>— PIP, WARDEN OF THE ROAD</cite></blockquote>
        <div className="story-facts"><span>4 CHAPTERS</span><span>TURN-BASED TACTICS</span><span>EVERY MOVE MATTERS</span></div>
      </section>
      <section className="setup-panel" aria-label="Game setup">
        <ol className="setup-steps" aria-label="Setup progress"><li data-active={!connected}>01 <span>CONNECT</span></li><li data-active={connected && !chosen}>02 <span>CHOOSE</span></li><li data-active={Boolean(chosen)}>03 <span>PLAY</span></li></ol>
        <div className="setup-content">
          <p className="eyebrow">YOUR ADVENTURE STARTS HERE</p><h2>{chosen ? "Ready for the road?" : connected ? "Choose your Friend." : "Bring a Friend."}</h2>
          <p className="setup-intro">{chosen ? "Your Friend leads the squad. Plan together, protect the lantern, and make it home." : connected ? "Pick a hardwired Rare Friend to carry your banner. Every Friend starts on equal footing." : "Connect your wallet, choose a Rare Friend, and lead your squad through four handcrafted battles."}</p>
          <div className="wallet-state" data-connected={connected}><span className="state-light" /><div><strong>{connected ? "Wallet connected" : wallet.status === "wrong-network" ? "Switch network to continue" : "Robinhood mainnet"}</strong><small>{wallet.account ? <span title={wallet.account}>{short(wallet.account)}</span> : "Connection only · no signing or spending"}</small></div>{wallet.account && <button className="text-button" onClick={() => session.disconnect()}>Disconnect</button>}</div>
          {wallet.error && <p className="setup-error" role="alert">{wallet.error}</p>}
          {wallet.status === "unavailable" && <div className="setup-message"><strong>Open your wallet to begin.</strong><p>Enable your browser wallet extension, or open this page in your wallet's browser.</p><button className="primary" onClick={() => { void session.connect(); }}>Check for wallet</button></div>}
          {(wallet.status === "disconnected" || wallet.status === "error") && <div className="connect-buttons">{wallet.wallets.length ? wallet.wallets.map(value => <button className="primary" key={value.id} onClick={() => { void session.connect(value.id); }}>{wallet.wallets.length === 1 ? "Connect wallet" : `Connect ${value.name}`} <span aria-hidden="true">→</span></button>) : <button className="primary" onClick={() => { void session.connect(); }}>Connect wallet →</button>}</div>}
          {(wallet.status === "connecting" || wallet.status === "switching-network") && <p className="setup-message" role="status">{wallet.status === "connecting" ? "Approve the connection in your wallet…" : "Approve the switch to Robinhood in your wallet…"}</p>}
          {wallet.status === "wrong-network" && <div className="setup-message"><p>Your wallet is on {wallet.chainId === 1 ? "Ethereum" : `chain ${wallet.chainId}`}. Your Friends live on Robinhood.</p><button className="primary" onClick={() => { void session.switchNetwork(); }}>Switch to Robinhood</button><button className="text-button" onClick={() => { void session.refresh(); }}>Check again</button></div>}
          {loading && <div className="discovery-status" role="status"><strong>Finding your Friends…</strong><p>{progress[1] ? `Reading wallet history · ${progress[0]} of ${progress[1]} sections` : "Checking your wallet on Robinhood…"}</p><progress aria-label="Loading Friends" value={progress[0]} max={Math.max(1, progress[1])} /></div>}
          {valid?.error && <div className="setup-error" role="alert"><strong>Your Friends are taking the scenic route.</strong><p>{valid.error}</p><button onClick={() => setAttempt(n => n + 1)}>Retry loading Friends</button></div>}
          {valid && !valid.error && <><div className="friends-heading"><span>{valid.friends.length} {valid.friends.length === 1 ? "FRIEND" : "FRIENDS"} READY</span><button className="text-button" onClick={() => setAttempt(n => n + 1)}>Refresh</button></div>
            {valid.friends.length ? <div className="owned-friends" aria-label="Your Friends">{valid.friends.map(friend => <button className="friend-card" key={String(friend.id)} aria-pressed={friend.id === chosen?.id} onClick={() => { setSelection({ revision: wallet.revision, friend }); setManualError(""); }}><FriendIcon id={friend.id} /><span><strong>{friend.label}</strong><small>GEN {friend.generation} / HARDWIRED</small></span><span className="friend-check" aria-hidden="true">{friend.id === chosen?.id ? "✓" : "+"}</span></button>)}</div> : <p className="setup-message">{valid.hidden ? "Your Friends are generation 0. Play needs a hardwired Friend (generation 1 or higher)." : "No Rare Friends were found in this wallet. Switch accounts, look up a Friend below, or try the demo."}</p>}
            {valid.hidden > 0 && valid.friends.length > 0 && <p className="quiet">{valid.hidden} generation-0 Friends aren't eligible to play.</p>}</>}
          {connected && <details className="manual-friend"><summary>Know your Friend number?</summary><p>Look it up directly if your collection isn't appearing.</p><form onSubmit={event => { void findFriend(event); }}><label htmlFor="friend-number">Friend number</label><div><input id="friend-number" inputMode="numeric" autoComplete="off" placeholder="e.g. 7730" value={manual} onChange={event => setManual(event.target.value)} /><button disabled={manualBusy || !manual.trim()}>{manualBusy ? "Checking…" : "Find Friend"}</button></div></form>{manualError && <p role="alert" className="setup-error">{manualError}</p>}</details>}
          {chosen && <div className="launch-area"><p><strong>{chosen.label}</strong> is ready to lead your squad.</p><button className="primary" onClick={() => setPlaying(true)}>Start adventure <span aria-hidden="true">→</span></button></div>}
          <div className="setup-footer"><span>Just exploring?</span> <a href="./demo/">Play without a wallet ↗</a><p>No RF or gas needed. Game balances are simulated.<br />Progress resets when you leave or reload.</p></div>
        </div>
      </section>
    </main>}
    <footer className="host-footer"><span>REAL FRENEMIES / A SMALL WORLD. A BETTER PLAN.</span><span>KEYBOARD · MOUSE · TOUCH</span></footer>
  </div>;
}

function App() {
  const [session, setSession] = useState<FriendWalletSession | null>(null);
  useEffect(() => { const current = createFriendWalletSession(); setSession(current); return () => current.dispose(); }, []);
  return session ? <Setup session={session} /> : <p role="status">Waking the forest…</p>;
}
createRoot(document.getElementById("root")!).render(<App />);
