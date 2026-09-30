# Real Frenemies

The default game is now **The Lantern Road**, a four-chapter turn-based campaign. The selected Friend appears on the
squad banner and as Pip's battlefield icon; Pip, Rook and Moss have equal combat stats for all token identities. Campaign play uses no RF. Each friend moves once and
then attacks, uses its class skill, or guards. Enemy attacks lock onto visible squares; moving away avoids them,
killing the attacker cancels them, and a shoved enemy can take the hit. Attacks require forecast confirmation.
Undo resets the current player turn; Retry restarts the current mission. There are no random hit rolls.

Chapters: defeat the scouts; hold a signal for two consecutive nights; defend the lantern for six nights; defeat
the Hollow King and hold the final signal for one night. Keep the lantern and at least one friend alive. Warden
Shove deals 1 base damage and pushes one tile (water: KO, collision: +2); Ranger Pierce trades movement for +1
damage and ignores forest armor; Mender heals 3 HP at range 2. Forest costs 2 movement and reduces damage by 1;
Guard reduces damage by 2 until the next player turn; a shrine heals 1 HP per night. Damage always deals at least 1.
Cliffs block movement and shots; units and forest do not block shots. Allies block movement. Enemy damage can hit
either team. New reinforcements arrive on the warned tile or an adjacent free tile if it is occupied.

Controls: **1/2/3**, arrows, Enter; **A** attack, **S** skill, **G** guard, **E** end, **U** undo, **R** retry,
**H** help, **L** last enemy turn report, **M** mute. The ending and results offer chapter selection; best medals
are retained when replaying within the same session. Phones include 44-pixel command buttons, a direction pad,
and readable status/forecast text. Sappers in chapter three hunt the lantern directly with range-2 firebombs
for 4 damage; neither passing nor guarding can protect the objective. All primary controls also support pointer input. Tab traverses canvas controls without
trapping focus. Sound and reduced-motion controls have real button mirrors for assistive technology. Progress
resets on reload; medals last for the current run only.

The original simulation remains on the title screen's **Territory Mode** button. The following sections document
that mode. Its native 640 × 480 canvas shares the campaign's four-tone LCD palette (#182c24, #617b52, #a6ba76, #dbe7ad),
detailed terrain, illustrated commander callouts and bitmap letterforms.

FriendSDK **v0.1.2** game. Your selected Rare Friend is the Core of a pixel-art territory generated from its token.
You garrison it with recruited Friends, stake simulated RF on each piece, expand into new regions, raid rival
territories and defend against a nightly raid. Beat a rival and you can buy one of its flags and move in; every
expansion, claim and reclaim feeds a reward pot that a block-count round pays out to the top three raiders.
Every piece's powers come from its on-chain traits.

**All RF, raids and rivals are simulated.** The game never calls the SDK's buy, play, settle or redeem actions.
A connected wallet owning a hardwired Generations NFT (generation 1+) on Robinhood mainnet is still required to play.

## Controls

| Input | Action |
| --- | --- |
| Click / tap | Pick a Friend in the recruit pool, then a dotted tile to place it. Click pieces, the Core, map cells and buttons. |
| Tab / Shift+Tab | Move focus between on-canvas controls. Tabbing past the last control leaves the game. |
| Enter | Activate the focused control, or the tile under the board cursor. |
| Arrow keys | Move the board cursor or the recruit-pool pick when focused. Otherwise, move focus. |
| R / E / L / X | Raid, end the day, level up the selection, remove the selection (build screen). |
| [ / ] | Switch between the regions you hold. |
| T / O | Territory map; round and pot (leaderboard). |
| H / Esc / M | Help, back, sound on/off. |
| Playback | Space pause · ←/→ seek 2 s · F toggle 2× · Esc skip to results. |

The top bar has **SND** (mute, off by default) and **FX** (reduced motion) toggles. They're mirrored as real
buttons for assistive technology. Reduced motion follows `prefers-reduced-motion`, steps replays at 4 ticks per
second and turns off projectiles, power rings and screen shake.

## Day loop

1. **Build.** Each region you hold has **12 supply**; a piece costs its level (six level-2 pieces or three level-4s),
   up to 6 pieces, east of column 3. Move pieces for free; level them up. Expand from the territory map (T).
2. **Raid (optional, once a day).** Scout three AI rivals. Send up to 4 pieces down one of three lanes and choose the
   **route**: the order in which your party fights the rival's regions (default: expansions first, home last). The
   party carries its wounds from one region to the next. Clear every defender on every region and it's a **win**.
   Raiders' home tiles stay empty until the next day. A rival that is rebuilding can't be raided.
3. **Reclaim raid (optional, its own daily allowance).** Fight the resident on one of your own regions. Clearing
   them drops their flag; it scores no win.
4. **Night.** Tonight's raid is **fixed at dawn** from your threat level (1–8): Easy at 1–2, Medium at 3–5, Hard at
   6+, with 2–4 raiders counter-picked against your whole territory. It doesn't react to where you put pieces or who
   you send out during the day; knocking its planned raiders out in your own raid keeps them home. Hold and the
   threat rises by one; lose and it falls by one. Each ghost then takes **one** action: raid you (if it's tonight's
   raider), evict a resident from its own land, or raid another ghost that isn't rebuilding.
5. **Morning.** Raiders come home; ghosts re-stake their losses from their wallets; the block clock advances a day.

Every result shows objective progress (regions cleared, defenders knocked out) and up to three causal highlights
drawn from the logs: HP carried into each region, flyers your melee couldn't hit, pieces that never landed a hit,
the enemy that did the most damage, timeouts. **Practice** re-fights any raid or reclaim raid against the snapshot
of the target as it stood before, with any party, lane or route: no RF, no stakes, no score.

Battles resolve instantly with `simulate(board, party, seed) → eventLog`, a deterministic pure function
(xorshift32 PRNG, no `Math.random`). The replay reads the log only, which gives rewind, 2× and skip.
Ticks run at 10 per second and a battle is capped at 200 ticks.

## Territory, flags and the pot

| Rule | Value |
| --- | --- |
| Expand | 250 RF into a region orthogonally adjacent to one you own, on a 3 × 3 map (home + up to 4 expansions). Its Scenery is fixed by your token and the offset. Each region has its own 12 supply. |
| Territory bonus | Each extra region you hold (owned or as resident) **with at least 2 of your pieces in it** adds +15% attack on raids and +15% HP on defense, up to 4 (×1.60). Empty land and fresh claims give nothing until garrisoned. |
| Win | Every defender on every region of the target's territory knocked out. Regions you already hold and empty regions need no battle. |
| Rebuild cooldown | Whoever is beaten (a full clear) or loses their Core can't be raided for the next 2 nights. Raiding someone else ends your own cooldown early. This applies to ghosts too, so no one can farm the same beaten opponent. |
| Claim a flag | After beating a rival that day: 500 RF for **one** of its expanded regions. You become resident and garrison it. A ghost that beats you may do the same (50% chance, if its wallet can pay). |
| Reclaim | Evict the resident with a reclaim raid (no win scored), then pay 250 RF to raise your flag. While the flag is down the region is empty and gives no bonus. |
| Reward pot | Every expansion, claim and reclaim payment (yours and the ghosts') goes into the round's pot. At each round end the treasury (80% of winning raids' fees) seeds the next pot. |
| Round | 7 days of blocks: 6,048,000 blocks at ~0.1 s per block on Robinhood mainnet (864,000 a day). The session clock starts at the **first block of the live round** (read from the chain on load), so every first round is a full seven days; each simulated day advances it one day of blocks. Round index = ⌊block ÷ 6,048,000⌋. |
| Leaderboard | Wins this round, ties broken by RF captured. When the round ends the pot pays 50% / 25% / 25% to the top three. |

The starting balance is **500 simulated RF**: one expansion plus a garrison, or save for a flag. The three ghosts
start with 500 RF each and pay for fees, flags, reclaims and every morning's re-stake from those wallets. **Simulated
RF is conserved**: every flow moves between a wallet, a stake, the pot, the treasury or the burn (unit-tested over
a two-week session). The only exception is the explicit RESTART SIM button when you are broke.

## RF rules (simulated, exact)

| Rule | Value |
| --- | --- |
| Place a piece (level 1) | Stake 1 RF |
| Level up to 2 / 3 / 4 | Top up 1 / 2 / 4 RF (cumulative stake 2 / 4 / 8 RF) |
| Remove a piece | Its full stake returns |
| Raid fee | 2 RF + 1 RF per attacker (3 to 6 RF), one fee for the whole territory |
| Fee burn | 20% of every raid fee |
| Capture | Every defender knocked out pays its stake to the raider; 10% of it is burned |
| Core down | The raider also takes the Core's stake; that home region resets (its survivors' stakes return) and the owner starts a 2-night rebuild cooldown |
| Failed raid | The remaining 80% of the fee goes to whoever held the region where the raid was stopped (owner or resident) |
| Winning raid | The remaining 80% of the fee goes to the treasury |
| Haggle | A Market piece on a Market region (with a Scenery slot) pays only half its stake; the rest returns to whoever held it |
| Knocked-out raiders | Not captured: they sit out until morning, still staked |

RF uses 18-decimal bigint base units internally; the HUD shows one decimal. A reload starts a new session
(the sandbox has no storage). `game.json` holds a one-outcome chance-game definition only because the runtime
requires one. It is **not** a game mechanic; the game never buys, plays, settles or redeems it.

## Exact rules

- **Library tiles:** a unit standing on one can't use its D, R or 4 powers or its Scenery affinity (including Tide,
  Ambush, Crystallize, Overwatch's extra range, Rooftop/Orbital range and armor). Class traits still work: flight,
  Family's three bodies, Hollow's half damage from melee, ranged double damage against flyers. So do Floor movement
  and quirks, basic attacks and Active regeneration.
- **Turn order each tick:** start-of-tick effects, then defenders in placement order, then the Core, then raiders
  in party order.
- **Regions are separate battles:** once-per-battle effects (Reassemble, Reunion, Phase-step, Dive, Ambush,
  first-hit bonuses) reset for each region; HP carries over.
- Tide (Coastal affinity) has its own cooldown, separate from the class power.
- Raiders head for the Core while it stands, then hunt the nearest defender they can hit. Melee and flying defenders
  leave their post by up to 2 tiles to intercept.

## Traits are powers

| Trait | Effect |
| --- | --- |
| Character (9) | Unit class: stats, movement speed, an always-on trait, and three powers (defense, raid, max level). See the in-game KITS page. Family's defense power is Brood: minis next to a sibling take 1 less damage; its three bodies are its trait. |
| Generation | Stat budget and power slots. HP/DMG: Gen 1 12/4, Gen 2 11/3, Gen 3 10/3, Gen 4 8/2, Gen 5 7/2, Gen 6 6/1. Gen 1–2: Character + Scenery + Floor; Gen 3–4: Character + Scenery; Gen 5–6: Character only. Gen 0 can't be placed. |
| Scenery (8) | The Core's Scenery sets the home terrain; expansions have their own. A piece with a Scenery slot on its own Scenery gets an affinity bonus. |
| Floor (4) | Movement pattern for everyone; the quirk needs a Floor slot. |
| Activation tier | +1 HP per tier; tier 4 unlocks the max-level power at level 3. |
| State | Active pieces regenerate 1 HP every 10 ticks. |

Level 2 / 3 / 4: ×1.25 / ×1.5 / ×2 HP and +1 / +2 / +3 damage. Level 3 also cuts power cooldowns by 1 tick,
and level 4 adds the upgrade power. The Core has 1.5× HP. Melee can't hit flyers; ranged attacks hit flyers
for double. Melee and flying defenders leave their post by up to 2 tiles to intercept. Raiders head for the Core
while it stands, then hunt the nearest defender.

## Rivals

Three AI ghosts persist for the whole session: Easy (2 regions), Medium (2) and Hard (3), with garrisons built to a
supply budget (Easy 5 / 3, Medium 9 / 5, Hard 12 / 7 per home / expansion). They have the same constraints as you:
a finite 500 RF wallet and one raid per night. They raid you, raid each other, buy flags when they win and can
afford it, evict residents and reclaim their own flags, all from seeded rolls, so a session replays identically.
Each morning they re-stake lost pieces from their wallets while they can. Their names are the token
of their Core Friend (`GHOST #14885`).

## Recruit pool

FriendSDK v0.1.2 gives game code only the selected Friend's ID, and its rules forbid NFT discovery in game code.
So garrisons are filled from a **fixed public pool of 72 real hardwired Generations Friends** (8 per Character,
all 8 Sceneries and 4 Floors), minus the ones the ghosts field. Traits and canonical sprites were read from
Robinhood mainnet by `scripts/build-pool.mjs`, at the block recorded in `src/data/pool.json`.

Your own Friend is read live: `tokenURI` for traits and the SDK sprite registry for its canonical 16 × 16 frames.
If it is in the pool snapshot (as the SDK test fixture #7730 is), the snapshot is used and labelled SNAPSHOT.

## Rendering

The campaign uses a **640 × 480** native canvas, **40 × 40** battlefield tiles, **94-pixel dialogue portraits** and
**162-pixel briefing illustrations**. Battlefield units use the original **16 × 16** Rare Friend icons at integer 2× scale,
including their idle animation; detailed character artwork is reserved for portraits and narrative presentation.
Generated character and terrain atlases are palette-locked and embedded as
data URLs so they remain readable inside the SDK's opaque-origin sandbox. Native sprite caches are sampled once,
quantized, then drawn without smoothing; CSS uses `image-rendering: pixelated` to fit desktop and phone displays.
The four original colors remain light #dbe7ad, mid #a6ba76, shade #617b52 and dark #182c24.
See [asset prompts](assets/lantern/PROMPTS.md) for source provenance and repacking instructions.

Versus territory mode also renders at **640 × 480**, with **40 × 40** terrain tiles across all eight scenery types.
Canonical **16 × 16** Friend sprites are drawn at 2×; enemies use pale fills and dark outlines. Scouting maps reuse
the detailed terrain. Both modes use the same **5 × 7 font** and shared campaign frame drawing. Versus has an
illustrated title scene, a 480 × 320 battlefield, a narrow inspector, a paginated single-row recruit tray, and
the campaign's **94-pixel portrait** dialogue panel with contextual commands below the battlefield.
Both modes reserve extra height on narrow screens for readable status text and a **44-pixel touch command deck**.
The shared font is drawn without stretching or changing its glyph grid. Both modes enlarge at whole device-pixel
multiples with pixel-aligned canvas placement. Low-DPI phones that cannot fit the native display retain a scaled
overview and readable HTML touch commands. `npm run test:pixels` (with the demo running) checks exact campaign glyphs,
displayed pixel sizes and the compact phone fallback at eight viewport/DPI combinations.
