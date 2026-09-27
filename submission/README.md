# Real Frenemies

Garrison a pixel-art territory with Rare Friends, stake simulated RF on every piece, raid your frenemies, buy their
flags, and race a block-count leaderboard for the reward pot.

**Builder:** TODO name · TODO contact · **Category:** Economy Potential (also relevant: Token Activity, Character Spotlight) · **SDK:** FriendSDK v0.1.2

Your selected Generations NFT is the Core of a territory generated from its token. Every piece's powers come from its
on-chain traits: Character is the unit class, Scenery the terrain affinity, Floor the movement, and Generation,
Activation tier and State the stat budget. Each piece is backed by RF stake, every raid burns RF, and every
expansion, flag claim and reclaim pays into a pot that the round's top raiders split.
[Source code](TODO repo URL) · [Full rules](TODO repo URL/blob/main/game/README.md)

## Play it

**Preview:** TODO GitHub Pages URL. Needs a browser wallet on Robinhood mainnet (4663) holding a hardwired
Generations NFT (generation 1+). The SDK verifies ownership before play. No RF, signature or transaction is needed.

To run locally with Node.js 22.18+ (Linux, WSL or native Windows):

```sh
git clone TODO repo URL
cd real-frenemies
npm ci
npm run dev
```

Open the printed URL (normally `http://localhost:4173`), connect your wallet and select your Friend.

## How to play

Click or tap a Friend in the recruit pool, then a dotted tile to place it (1 RF stake). Each region has 12 supply
and a piece uses its level, so you choose between many small pieces and a few strong ones. Then **Raid**: scout three
AI rivals, pick up to 4 attackers, a lane and a route (which region to fight first). Your party fights every region
in that order, carrying its wounds; clear every defender on every region and it's a win. Battles are replayed in
pixel art with pause, rewind, 2× and skip. Every result says why: regions and defenders cleared, HP carried in,
flyers your melee couldn't touch, who did the damage. **Practice** re-fights any raid for free against the target
as it stood.

Tonight's raid on you is fixed at dawn from your threat level (up when you hold, down when you lose), so moving or
sending out your pieces can't game it; knocking its raiders out in your own raid keeps them home. Whoever is beaten
or loses their Core gets **2 protected nights** to rebuild; raiding someone else ends that early.

From the **territory map** (T) expand for 250 RF into an adjacent region: once it holds 2+ of your pieces it gives
+15% attack and +15% defense, and raiders must clear all of it to beat you. After a win, buy **one** of the loser's
flags for 500 RF and move in as resident. If a rival does that to you, evict them with a reclaim raid (its own daily
allowance; no win scored) and pay 250 RF to raise your flag again. All those payments feed the **reward pot**; a
round is 7 days of blocks (6,048,000 at ~0.1 s each, aligned to the live chain's round boundary) and pays the top
three by wins 50 / 25 / 25%. Winning raids' fees fill a treasury that seeds the next round's pot.

Keyboard: Tab / Enter / arrows everywhere; R raid, E end day, L level up, X remove, [ ] switch region, T territory,
O round, H help, M sound; Space, ←/→ and F in replays. Mute and reduced-motion toggles are in the top bar.
Everything stays inside the SDK container.

## RF costs and outcomes

**All RF is simulated and labelled SIM RF in the HUD.** You start with 500 simulated RF.

| Action | RF |
| --- | --- |
| Place a piece / level 2 / level 3 / level 4 | stake 1 / +1 / +2 / +4 (8 RF at max) |
| Raid fee | 2 + 1 per attacker (3–6 RF), one fee per territory; 20% burned |
| Each defender knocked out | pays its stake to the raider; 10% burned |
| Core knocked out | raider also takes the Core's stake; that home resets (survivors refunded); 2 protected nights |
| Raid fails / wins | 80% of the fee to whoever held the region that stopped it / to the treasury (seeds the next pot) |
| Expand | 250 RF → pot |
| Claim a beaten rival's flag | 500 RF → pot |
| Reclaim your own flag after evicting the resident | 250 RF → pot |
| Round payout | pot × 50% / 25% / 25% to the top three by wins (ties by RF captured) |

The three AI rivals play by the same money rules: 500 RF wallets, one raid a night, and every fee, flag and
morning re-stake paid from their wallet. Simulated RF is conserved across all four actors (unit-tested).

Battles are deterministic: `simulate(board, party, seed) → eventLog` with a seeded xorshift32 PRNG, so win rates come
from play, not a published outcome table. Balance runs over 60 random parties per row against each rival's whole
territory (`node scripts/raid-ev.ts`, two rival seeds): a random level-1 party of four beats Easy 10–15% of the time
and Medium never; a level-4 party of four beats Easy 65–68%, Medium 50–87% and Hard 12–23%, or 32–67% with the full
territory bonus (`node scripts/raid-ev.ts 1.45`). Hard pays 14–24 RF net per raid even when it doesn't fall. There are no
consumables and no chance-game outcomes; `game.json` exists only because the runtime requires a definition.

## Checks

All pass:

- `npm test`: 23 unit tests, including RF conservation across all four actors over two weeks, and a regression for
  each rule defect found in [the design review](TODO repo URL/blob/main/DESIGN_REVIEW.md): rebuild-cooldown lifetime, duplicate raiders,
  one flag per win, reclaim and outpost settlement, relocation-proof incoming raids and Library suppression
- `npm run typecheck`
- `npm run check` (friendsdk check)
- `npm run test:browser` (friendsdk test)
- `npm run test:play` at 960 px and 360 px: build → raid → route-reordered practice rematch → night → morning → expand →
  build the new region → round screen, by pointer and keyboard, plus the brief's pixel test. At 3× every canvas pixel is a solid 3 × 3 block.

Browser checks use the SDK's mock wallet and RPC. TODO: real-wallet playthrough.

## Known limitations and future integration

- **Recruit pool:** the SDK gives game code only the selected Friend, so garrisons use a fixed public pool of 72 real
  Generations Friends (traits and sprites snapshotted from mainnet). The design intends each player to field their
  own Generations; that needs an SDK API exposing a player's other eligible Friends.
- **Rivals are AI ghosts** that persist for the session and fight each other. Real cross-player territories,
  residents, the leaderboard and the pot need a persistence/save API; the round clock already keys off the live
  block height so a shared round boundary is the same for everyone.
- **On-chain:** stakes in escrow, expansion/claim/reclaim payments into a pot contract, commit-reveal raids (seed
  from a block hash after commit), sim settlement with the burn, and a payout at the round's block boundary. The
  deterministic sim is built for this.
- A design review ([DESIGN_REVIEW.md](TODO repo URL/blob/main/DESIGN_REVIEW.md)) lists longer-term work this preview doesn't attempt:
  real PvP with locked defense snapshots, a guided learning campaign, seasonal event formats and admin tooling.
- Sessions reset on reload (no sandbox storage). Phones render at 1×, so text is small; tablets and desktop render
  at 2–3×.
- If your Friend is in the recruit-pool snapshot, its traits come from the snapshot, not a live read.

## Credits

Character sprites are the canonical on-chain Generations frames (SDK sprite registry). Sound cues come from the
FriendSDK sound kit. The font, terrain tiles, effects and UI are original pixel art drawn in code. No third-party
assets.
