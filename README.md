# Real Frenemies

A tower-defense-meets-raid game for the [Rare Friends Vibeathon](https://github.com/spokesz/rarefriends-vibeathon),
built on [FriendSDK v0.1.2](https://github.com/spokesz/friendsdk). Your Rare Friend is the Core of a territory
generated from its token; recruited Friends garrison it, you expand into new regions, raid rival territories, buy
their flags, and race a block-count leaderboard for a reward pot, all with simulated RF at stake.
Controls, rules and exact RF terms are in [game/README.md](game/README.md).

## Requirements

- Node.js 22.18 or newer, npm and Git. Tested natively on Windows 11 (Git Bash) with Node 22.23. Linux and WSL
  work the same way.
- To play (including previews): a browser wallet on Robinhood mainnet (chain 4663) holding a hardwired Rare Friends
  Generations NFT (generation 1+). No RF, signatures or transactions are needed; the economy is simulated.

## Run

```sh
npm ci
npm run dev          # http://localhost:4173 — connect your wallet, pick your Friend
```

`npm ci` installs the SDK from the release archive in `vendor/`
([v0.1.2 release](https://github.com/spokesz/friendsdk/releases/tag/v0.1.2)).

### Wallet-free demo

```sh
npm run demo         # http://localhost:4174 — pick any recruit-pool Friend, no wallet
```

An unofficial demo for people without an eligible Friend. It mounts the same game component outside the SDK
runtime, so it skips the ownership check and lets you play as any Friend in the recruit-pool snapshot. Everything
is simulated as usual and resets on reload. The official preview keeps the wallet gate.

## Build and host

```sh
npm run build        # static site in game/.friendsdk/
```

Upload the **contents** of `game/.friendsdk/` to any HTTPS static host, such as the root of a `gh-pages` branch
with an empty `.nojekyll`. Keep relative paths and the sandbox document's CSP.

`npm run build:demo` (after `npm run build`) adds the wallet-free demo in `game/.friendsdk/demo/`.
`.github/workflows/pages.yml` builds both on every push to `main` and publishes them to GitHub Pages:
[official preview](https://kaigani.github.io/real-frenemies/) (wallet required) and
[demo](https://kaigani.github.io/real-frenemies/demo/) (no wallet).

## Checks

```sh
npm test                               # unit tests: sim determinism, bases, stats, settlement, session day loop
npm run typecheck
npm run check                          # friendsdk check: definition, imports, sandbox boundary
npx playwright install chromium        # once
npm run test:browser                   # friendsdk test: SDK smoke test with mock wallet/RPC
npm run test:play                      # full day loop by pointer + keyboard, pixel test at 3x (960 px)
npm run test:play -- 360               # same on a phone-width frame
```

Balance tools: `node scripts/balance.ts [level] [gen]` (one-on-one duel matrix), `node scripts/raid-ev.ts [atkMul]`
(territory raid win rates and expected RF, optionally with a territory bonus), `node scripts/session-bot.ts`
(13-day bot sessions with expansion, claims and round payouts).
`node scripts/live-read.ts <tokenId>` exercises the in-game live trait read against mainnet.
Art review: `node scripts/art-sheet.mjs` renders one board per Scenery to `artifacts/art-sheet.png`, and
`node tests/browser/fx-shots.mjs` captures a raid mid-battle with motion effects on (`artifacts/fx/`).
`npm run pool` rebuilds the recruit pool from mainnet.

## Layout

| Path | What it is |
| --- | --- |
| `game/index.tsx` | React adapter: sizing, input, sound kit, accessible mirrors |
| `game/src/app.ts` | Canvas app: screens, widgets, playback |
| `game/src/sim.ts`, `path.ts`, `rng.ts` | Deterministic battle sim, A*, xorshift32 |
| `game/src/rules.ts`, `terrain.ts` | Kits, stat tables and territory constants; base and region generation |
| `game/src/territory.ts`, `campaign.ts`, `ghosts.ts` | Regions, flags and holders; multi-region raids; persistent AI rivals |
| `game/src/economy.ts`, `session.ts` | Simulated RF ledger, settlement, pot, round clock and leaderboard, day loop |
| `game/src/friends.ts`, `onchain.ts`, `data/pool.json` | Traits, live chain reads, recruit-pool snapshot |
| `game/src/render/` | Pixel painter, 3 × 5 font, terrain tiles |
| `demo/` | Wallet-free demo page: Friend picker plus a stub action client (built by `scripts/build-demo.mjs`) |

## Assets

All artwork is drawn in code at runtime. Character sprites are the canonical on-chain Generations frames, via the
SDK sprite registry and the pool snapshot; the SDK's artwork notice covers them. The font, tiles and effects are
original to this project. Sound cues are the SDK's procedural sound kit. No third-party assets.

## License

Code: Apache-2.0, matching FriendSDK.
