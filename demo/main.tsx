import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameClient } from "@rarefriends/friendsdk/game";
import RealFrenemies from "../game/index.tsx";
import { CHARACTERS, friendLabel, POOL, spriteBits, type Friend } from "../game/src/friends.ts";
import "./demo.css";

/**
 * Wallet-free demo. It skips the SDK runtime's ownership gate and lets anyone pick a Friend from the recruit-pool
 * snapshot. The game keeps its own simulated ledger, so the only thing the stub client must do is answer read().
 * This is not the Vibeathon preview; that one stays at the site root, wallet-gated.
 */
function stubClient(friendId: bigint): GameClient {
  return { mode: "preview", read: async () => ({ friendId, mode: "preview" }) } as unknown as GameClient;
}

const PLAYABLE = POOL.filter(f => f.generation >= 1)
  .toSorted((a, b) => CHARACTERS.indexOf(a.character) - CHARACTERS.indexOf(b.character) || Number(a.tokenId - b.tokenId));

function Sprite({ friend }: { friend: Friend }) {
  return <canvas width={16} height={16} aria-hidden="true" ref={c => {
    const ctx = c?.getContext("2d");
    if (!ctx) return;
    const bits = spriteBits(friend, "down", false, 0);
    ctx.clearRect(0, 0, 16, 16);
    for (let i = 0; i < 256; i++) if ((bits >> BigInt(i)) & 1n) ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
  }} />;
}

function Picker({ onPick }: { onPick: (friend: Friend) => void }) {
  return <section className="demo-picker">
    <h1>Choose a Friend</h1>
    <p>Pick any Friend from the recruit pool to play as. No wallet needed. Balances and outcomes are simulated, and
      progress resets when you reload.</p>
    <button type="button" className="demo-random"
      onClick={() => onPick(PLAYABLE[Math.floor(Math.random() * PLAYABLE.length)])}>Random Friend</button>
    <ul>
      {PLAYABLE.map(f => <li key={String(f.tokenId)}>
        <button type="button" onClick={() => onPick(f)}>
          <Sprite friend={f} />
          <span>{friendLabel(f)}</span>
          <small>Gen {f.generation} · {f.scenery}</small>
        </button>
      </li>)}
    </ul>
  </section>;
}

function Demo() {
  const [friend, setFriend] = useState<Friend | null>(() => {
    const id = new URLSearchParams(location.search).get("friend");
    return PLAYABLE.find(f => String(f.tokenId) === (id ?? "7730")) ?? PLAYABLE[0];
  });
  const pick = (f: Friend | null) => {
    const url = new URL(location.href);
    if (f) url.searchParams.set("friend", String(f.tokenId)); else url.searchParams.delete("friend");
    history.replaceState(null, "", url);
    setFriend(f);
  };
  const client = useMemo(() => friend ? stubClient(friend.tokenId) : null, [friend]);
  return <>
    <header className="demo-bar">
      <a className="demo-brand" href="./">RF<span>RARE FRIENDS PRESENTS</span></a>
      <nav aria-label="Demo navigation"><span className="demo-edition">TACTICAL ADVENTURE / VOL. 01</span>
      {friend && <button type="button" onClick={() => pick(null)}>Friend #{String(friend.tokenId)} ↗</button>}</nav>
    </header>
    <div className="demo-intro"><div><p className="demo-eyebrow">A LITTLE WORLD. A BETTER PLAN.</p><h1>The Lantern Road<span>Real Frenemies</span></h1></div><p>Three friends. Four chapters.<br />Bring the light back, one turn at a time.</p></div>
    <main className="demo-console">
    <div className="demo-screen-label"><span><i /> DOT MATRIX WITH FRIENDS</span><span>RF — 001</span></div>
    <div className="demo-frame">
      {friend
        ? <RealFrenemies key={String(friend.tokenId)} friendId={friend.tokenId} client={client!} paused={false} />
        : <Picker onPick={pick} />}
    </div>
    <div className="demo-console-foot"><strong>REAL FRIENDS<span> / POCKET TACTICS</span></strong><span className="demo-speaker" aria-hidden="true">▰ ▰ ▰ ▰ ▰</span></div>
    </main>
    <footer className="demo-footer"><p><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Select <span>·</span> <kbd>↑←↓→</kbd> Aim <span>·</span> <kbd>Enter</kbd> Confirm <span>·</span> <kbd>U</kbd> Undo <span>·</span> <kbd>H</kbd> Help</p><p>Free demo · No wallet needed · Progress resets on reload.<br />Original Rare Friends sprites. All territory balances are simulated. <a href="../">Wallet preview ↗</a></p></footer>
  </>;
}

createRoot(document.getElementById("root")!).render(<Demo />);
