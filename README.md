# Real Frenemies

**The Lantern Road** is now the default: a four-chapter, directly controlled turn-based tactics campaign in a
four-tone handheld palette. Command a Warden, Ranger and Mender; dodge locked enemy attacks, shove foes into water,
protect the lantern and reclaim the signal. Your selected Rare Friend appears on the squad banner and leads the battlefield as Pip.
Battlefield units use chunky canonical Rare Friend icons; detailed illustrated characters appear in the portraits and narrative callouts.
The campaign renders at 640 × 480 with detailed 40-pixel terrain, six illustrated characters, and large narrative portraits.
The versus territory simulation is available from **Territory Mode** on the title screen. It shares the 640 × 480
display, 40-pixel terrain across all eight scenery types, 94-pixel commander callouts, and chunky Friend icons.
Campaign mode defines both modes' typography, frames, title scenes and command panels through shared rendering code.
Rivals use pale sprites with dark outlines; phones have a dedicated versus command deck.

Run `npm run demo` and open **http://localhost:4174/** to play without a wallet. The demo starts with Friend #7730;
use the header's Friend button to choose another. Campaign stats are equal across Friends. Progress is session-only.

Campaign controls: click a friend and a dotted tile to move; **A** attack, **S** skill, **G** guard; select a target
twice to review and confirm the forecast. **1/2/3** select squad members, arrows + Enter target a tile, **E** ends the
turn, **U** resets the current turn, **R** retries a mission, **H** opens the guide, **L** reviews the last enemy turn
and **M** toggles sound. Phones have large touch commands and a directional pad. Attacking
ends that friend's movement. Ranger Pierce requires standing still. Each mission awards victory, no-loss and par
medals, with chapter selection and best medals retained within the session. `npm run test:tactics` (with the demo running) plays all four chapters through public browser controls;
append `-- 360` for a phone-width pass. `npm test` also proves legal, no-loss solutions for every chapter.

The territory-mode documentation below describes the separate original simulation.

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

The wallet game has a themed Connect → Choose → Play setup, canonical Friend cards, network switching,
loading progress, and a verified Friend-number recovery option. The trusted host queries owner-filtered
transfer history in five-million-block windows, respecting the public RPC's range limit. It preserves the SDK's
balance/history checks and freshly verifies ownership before launching the sandbox. It never scans all tokens.
After editing the wallet host or game, run `npm run build` and refresh the running dev server.

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
npm run test:setup                     # after npm run build: wallet setup, RPC paging, recovery and sandbox at desktop/phone sizes
npm run check                          # friendsdk check: definition, imports, sandbox boundary
npx playwright install chromium        # once
npm run test:browser                   # friendsdk test: SDK smoke test with mock wallet/RPC
npm run test:play                      # full day loop by pointer + keyboard, native palette/resolution check
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
| `game/src/render/` | Pixel painters, bitmap fonts, shared art atlas and detailed versus terrain |
| `demo/` | Wallet-free demo page: Friend picker plus a stub action client (built by `scripts/build-demo.mjs`) |
| `host/` | Trusted wallet setup, canonical Friend cards and bounded owner-history discovery; uses the SDK eligibility gate and sandbox |

## Assets

Campaign characters and terrain were created with the built-in imagegen tool, then packed into the original four-color
LCD palette. Source atlases and the full prompt set are in [game/assets/lantern](game/assets/lantern/PROMPTS.md).
Run `npm run art:pack` after changing the source atlases (requires Playwright Chromium). The committed data-URL pack
works inside the SDK sandbox without image network requests or cross-origin canvas access.
The battlefield icons, squad banner and territory mode use canonical on-chain Generations sprites through the SDK registry and pool
snapshot; the SDK's artwork notice covers those sprites. Bitmap fonts, UI, territory tiles and effects are drawn in code.
Sound cues use the SDK's procedural sound kit.

## License

Code: Apache-2.0, matching FriendSDK.
