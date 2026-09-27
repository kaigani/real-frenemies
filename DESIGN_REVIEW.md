# Real Frenemies: adversarial game-design review

Reviewed 24 September 2026. Scope: the implementation in `real-frenemies`, its rules, existing screen captures, automated checks, and deterministic simulation probes. No live human playtest was conducted. Predictions about enjoyment and retention are design hypotheses; the simulation findings below are observations. All RF is simulated.

**Verdict: a promising tactical prototype, but not yet a months-long competitive game.** The strongest idea is using the same Friends to attack and defend: a good raid should create a difficult decision about what to leave behind. Terrain, role-specific powers, and persistent wounds offer useful tactical material. However, progression currently ends quickly, several incentives reward avoiding challenge, and the world eventually becomes predictable. Adding more levels or a calendar of bonuses would extend repetition without solving those problems.

The intended long-term experience should be: “I understand what beat me, I have another affordable plan to try, and my rival will have to respond.” The current system too often produces “I need the stronger trait,” “I should attack the same target again,” or “I can gain RF without winning.”

**Evidence and limits**

- All 12 existing unit tests passed. These check functionality, not competitive balance or fun.
- Ran the existing 13-day session bot, level-four/Gen-one duel matrix, and raid-economics sampler. Added [a reproducible review script](scripts/design-audit.ts) for specific incentive and rule probes and eight-round, 56-day bot runs.
- The extended bot uses the existing policy: expand to at most three owned regions, fill four pieces per held region, upgrade, and attack the difficulty selected by party level. It does not optimize formations or learn. Different player tokens also change the map, rivals, and available recruits; results cannot establish a class tier list.
- The existing raid-economics sampler uses defense multiplier 1 and excludes only the target's recruits, whereas a real Session applies territory defense bonuses and excludes all ghosts' recruits. Its output is a diagnostic, not a live-session win-rate estimate. Its 60 random parties per cell are also insufficient to certify balance.
- Reviewed existing desktop setup and interface code. This was not a fresh hands-on browser playtest or a mobile usability study.

| Player token | Raid wins / 56 days | Home resets | Latest completed round: player wins | Latest completed round: pot RF |
| --- | ---: | ---: | ---: | ---: |
| 3412 | 46 | 0 | 7 | 0 |
| 420 | 46 | 1 | 7 | 0 |
| 656 | 27 | 2 | 7 | 0 |
| 1305 | 55 | 0 | 7 | 500 |
| 4609 | 51 | 2 | 7 | 0 |
| 7730 | 42 | 1 | 7 | 0 |
| 19595 | 21 | 8 | 4 | 0 |
| 6025 | 1 | 3 | 0 | 0 |
| 20598 | 0 | 1 | 0 | 0 |

These are accelerated simulation days, not 56 days of observed player retention. The bot prints a fresh-round rank after payout; that all-zero ranking must not be mistaken for its placement in the completed round. In particular, token 20598 finished with 1,759.4 liquid RF after zero raid wins. Six runs scored seven wins in the final completed round. Eight final completed rounds had empty pots. This is evidence of stagnant incentives, not proof of one universally dominant build.

**1. Critical: progression is front-loaded, then runs out of decisions**

All recruits are immediately available at a uniform level-based stake. A level-four Core plus six level-four defenders costs **56 RF out of the starting 500**; the audit constructs this on day one. One expansion plus a maximum-level Core and two full maximum-level garrisons costs 354 RF, still leaving 146. Level-four powers are therefore an opening purchase, not a long-term progression track. Conversely, another expansion costs 250 and a claim 500: a large gap with little intermediate development.

The three ghosts restore fixed templates. They do not learn, acquire new tactical doctrines, or introduce a planned sequence of challenges. The seven-day round resets scores and pot, not accumulated combat advantages. Reloading discards the whole session. There is neither durable personal progress nor an evolving human rivalry in this build. [Rules](game/src/rules.ts:16), [rival templates](game/src/ghosts.ts:117), [round reset](game/src/session.ts:470).

**Change:** separate learning progression, seasonal strategic progression, and permanent identity. Teach mechanics through increasingly demanding situations; use a fixed competitive deployment budget; retain mastery records, cosmetics, saved plans, and replays permanently. Keep competitive tools accessible early enough that a late joiner can respond to established strategies. If unit upgrades remain, make them mutually exclusive specializations within that budget, rather than a mandatory march to the same maximum.

Do not solve this by multiplying prices or adding another 20 levels. That would lengthen acquisition without increasing the number of interesting choices.

**2. Critical: the AI punishes visible home strength and can be manipulated**

Incoming opponent selection looks at the average level and count of the **present home garrison**, but the attacker must fight the entire territory. In a matched probe with token 7730 and one expansion, six level-four units at home invite three Hard raiders at levels 4/4/3. Put those same six units in the expansion and leave home empty: one level-two Easy raider attacks instead. The stronger outer defense has effectively disappeared from difficulty assessment.

Sending home defenders on a raid also reduces the count used to size the incoming force. That partially undermines the central promise that raiding exposes the player to more danger. Increasing a home unit's level can switch the chosen rival, creating a difficulty discontinuity unrelated to a new lesson. [Incoming raid selection](game/src/session.ts:330).

**Change:** precommit incoming threats before the player allocates the army. In PvE, base encounter tiers on explicit campaign progress or recent performance with a gentle, visible adjustment. Count the full relevant territory. In PvP, match using persistent skill estimates and a locked deployment budget, not a manipulable current defense. Verify that relocating identical strength cannot downgrade the encounter.

**3. Critical: incentives reward safe farming, partial plunder, and avoiding reclamation**

Easy and Hard clears both score one win. Captured RF breaks ties. Once a reliable target is found, the leaderboard offers no direct credit for taking on a harder opponent. On the other hand, expensive outer defenders can make failed raids profitable: capture payments do not require a campaign win, and attacking casualties do not permanently lose their stakes. Those are potentially valid objectives, but the game calls them failures while financially rewarding them.

Reclaiming consumes the player's single daily raid, gives no win, and still requires another 250 RF afterward. A player behind in the standings is asked to surrender scoring opportunity to repair a loss. Ghosts operate under different constraints: a rival can raid the player and another ghost in the same night, and attempt evictions too. They have no finite wallet enforcing their purchases. [Raid settlement and scoring](game/src/session.ts:260), [ghost turns](game/src/session.ts:400).

**Change:** offer explicit raid contracts, such as breach, plunder, and hold, with distinct completion conditions and bounded rewards. Let players select from similarly challenging matched targets; use a strength-aware rating for competition rather than raw total wins. Limit repeated ranked farming of the same opponent. Give reclaim its own recovery allowance or equivalent objective credit. Apply equal action budgets to competitors in a shared leaderboard.

Make the intended tradeoff legible: a plunder run may sacrifice rating opportunity for resources, but must not be the universal best way to advance both. Free practice should remain available after ranked attempts are spent.

**4. Critical: territory creates a compound advantage and eventual stagnation**

An expansion adds a full defensive board, six more possible garrison slots, and a global 15% raid-damage/defense-HP bonus, capped at 60%. A fully developed five-region territory can field 30 defenders plus the Core against four raiders who carry wounds. Players who win flags also weaken opponents' bonuses and can skip their own outposts when attacking that territory. Several benefits reinforce the same leader.

The map currently determines expansion adjacency and scenery, but raid traversal follows a fixed sorted region order. It does not offer route selection, supply-line attacks, or a choice of strategic objectives. Empty regions provide their bonus immediately. Claims cost twice an expansion, yet can attract multiple attacks through the owner's war and eviction turns. Their strategic value needs a clearer explanation than another multiplier. [Territory bonuses and order](game/src/territory.ts:76), [campaign traversal](game/src/campaign.ts:45).

**Change:** for ranked play, replace wealth-derived combat multipliers with equal supply budgets. Give territory owners choices—reconnaissance, an alternate route, an optional defensive doctrine—rather than stacking raw stats. Require occupation or supply to provide territorial benefits. Start with raids against one contested region and an optional second objective; preserve full-territory attrition as a PvE expedition format. Introduce map-route play only when it creates decisions beyond selecting the numerically weakest board.

Cap how many ranked losses a defense can suffer in a period and provide a protected rebuild. A weaker player must have a credible action that improves their position without first beating the entire stronger empire.

**5. High: traits mostly create quality tiers, not interesting alternatives**

Gen one has base HP/damage 12/4 and three power slots; Gen six has 6/1 and one slot. Both cost the same RF at the same level and occupy one piece slot. Higher activation tier and Active regeneration add benefits without an equivalent cost. Within otherwise comparable kits, the lower-quality option frequently lacks a competitive reason to exist. The shared pool softens ownership advantage, but the selected NFT still fixes the Core and territory, and the strongest recruit candidates can be removed by the token-seeded ghost roster. [Stat budgets](game/src/rules.ts:23).

**Change:** normalize generation, activation, and state in the main ranked format, preserving visual identity and class/scenery/floor identity. Alternatively, price total power through a tested supply system, but recognize that a difficult valuation problem remains. Collection-powered exhibition leagues can be separate. Challenge loan rosters should be available equally to participants.

The class graph needs composition tests. Melee cannot hit flyers, while ranged deals double to them; this risks highly binary matchups. Family gains three acting bodies per slot, rounded-up half damage per body, and Reunion at maximum level. Cellular support cannot be judged from a duel table. High-level Sparkling adds self-damage, so upgrading is not guaranteed to improve every defense. Validate teams and counterplay before assigning nerfs from one-on-one results.

**6. High: complexity currently exceeds the player's ability to explain results**

Nine classes, three role-dependent powers, eight affinities, four movement patterns, generation slots, activation, state, terrain, territory multipliers, and hidden action-order effects create many interactions. They do not automatically create strategic depth. There must be a reliable route from seeing an outcome to forming a better plan.

The implementation includes an undocumented Hollow melee-damage reduction. “No powers trigger” on Reading tiles is not applied consistently: several strike and knockout effects bypass suppression. Non-Core defenders act before the Core and then attackers; placement order therefore matters. A shared cooldown can make a class power compete with Coastal Tide. “Once” effects reinitialize for each region even though wounds carry. Some may be intentional, but players need exact, consistent rules. [Damage and powers](game/src/sim.ts:219), [tick order](game/src/sim.ts:520).

**Change:** give every result two or three causal highlights: “Your front line blocked your ranged unit for 12 ticks”; “This target was airborne”; “Your second region began at 38% party HP.” Add range, targeting, path, and support overlays before deployment, with drill-down rules available. Show partial objective progress even on losses. Teach one interaction at a time and let players retry a loss freely against a snapshot.

Keep quick replay, rewind, and skip. The endgame should be planning and reading opponents, not repeatedly sitting through a known outcome. Expand the raid selector beyond its current first 24 pieces before a player can field 30 or more. [Raid selector](game/src/app.ts:904).

**7. High: the economy and seasonal pot have no durable steady state**

The opening pot includes 1,000 RF attributed to ghost expansions. Further ghost claims/reclaims add pot money without a finite ghost ledger. Defeated ghost garrisons regenerate each morning without paying their stakes. Meanwhile, player fees and captures burn RF. This is a useful preview simulation, but it cannot establish that a multiplayer economy is sustainable.

When territorial purchasing stops, so does pot funding. Eight of nine last completed rounds in the 56-day runs had zero pot. When purchases do happen, the strongest competitors are positioned to receive funds paid by everyone else. Top-three-only distribution in a four-actor prototype also says little about how the bottom 80% of a real population would feel. [Initial pot](game/src/session.ts:66), [payout](game/src/session.ts:470).

**Change:** specify a separate seasonal reward budget and guaranteed participation/mastery milestones. Make prestige the primary reason to climb. Ensure baseline play and rebuilding remain viable without a jackpot. Track resource creation, transfers, destruction, and locked stakes for every actor. Seasonal progress should not rely on constant territory churn or losses funding leaders.

**Rule defects to fix before balance tuning**

These affect what a player experiences and therefore contaminate balance conclusions. The first four have executable probes in the review script; the remaining items are code-review findings requiring focused regression coverage.

| Finding | Evidence / consequence |
| --- | --- |
| Promised post-reset shield expires immediately | A real empty-home loss for token 3412 leaves day two with Core level zero, `shield=false`, and another incoming raid available. `applyBattles` sets the shield during the night; `endDay` clears it that same night. |
| Duplicate attacker IDs pass validation | `raidError([key,key,key,key])` returns no error. The UI avoids this, but the Session boundary does not enforce unique deployed units. |
| Reclaim fee credited to the wrong actor | In an empty enemy-held reclaim fixture, the player pays a three-RF fee and receives its own 2.4-RF defender share. Settlement uses territory owner rather than resident holder. |
| Multiple flags purchasable after one win | A fixture with a Hard win and sufficient RF buys both expansions; the stated rule says one flag. The daily eligibility is not consumed. |
| Outpost settlement is not consistently holder-aware | Personal loss/refund accounting is gated on the target territory owner being YOU, so an outpost inside another territory needs separate settlement validation. |
| Round scheduling is session-local | End Day advances 864,000 blocks instantly. Live starting height can produce a one-day first round. This is not a shared real-time season. |
| Rules and simulation disagree | Reading suppression, Hollow resistance, and the scope of per-battle resets need one documented contract. |

Do not mistake server authority for a cosmetic production detail: durable PvP requires validated commands, locked defense snapshots, a shared clock and ledger, and versioned deterministic replays. Public deterministic seeds plus a fully visible board also allow external search for winning parties and ordering. Choose deliberately whether a format is an open puzzle or a limited-information competition. More arbitrary randomness is not a substitute for that decision.

**A progression curve worth testing**

| Stage | New skill or decision | Content/reward |
| --- | --- | --- |
| First 20 minutes | Placement, one lane, tank/ranged counter, reading a replay | Three short guided encounters with fixed equal rosters and safe retries |
| Sessions 2–5 | Terrain, support spacing, balancing raiders against defense | Small territory; introduce one new mechanic per encounter; unlock saved loadout slots |
| Weeks 1–2 | Scouting, predicting counters, choosing objectives | Matched asynchronous opponents; full competitive roster access; rival/revenge histories |
| Weeks 3–4 | Drafting, adapting a known formation, route or doctrine tradeoffs | Optional limited-roster cups and rotating objective boards |
| Months 2+ | Opponent adaptation and collective strategy | Stable ranked ladder, seasonal strategic map, team objectives, mastery records and cosmetics |

This is a learning sequence, not a compulsory time gate. Experienced players should be able to demonstrate mastery and move ahead. A returning player should find an understandable format and a functional roster, not a permanent power deficit.

Start with three team approaches that have demonstrable strengths and answers: siege/breach, mobile objective capture, and support attrition. Each should beat one setup and lose to another at equal budget. Add one configurable doctrine per army—such as target priority or engagement posture—before adding more classes. A doctrine must have an explicit downside; otherwise it is simply another required upgrade. Prototype whether reading a rival's previous doctrine and responding produces enjoyable rematches.

**Administrator challenges and seasons**

Maintain a stable core ranked queue. Put experimental rules into named side events with an advance explanation and separate scores. Changing only HP, damage, or payouts is weak variety; change what the player must solve. Do not require rare owned traits to participate.

| Format | Concrete rules and scoring | Skill tested / implementation scope |
| --- | --- | --- |
| Weekly siege puzzle | Same three seeded bases and loan roster for everyone. Three medals for objectives completed; then surviving HP and simulated ticks break ties. Unlimited practice; best result counts. | Team and lane planning; closest to the current campaign system. Treat shared solutions as acceptable puzzle culture, not ranked skill proof. |
| Quartermaster Cup | Fixed normalized loan pool and 24 provisional supply points; max four raiders. Score matched wins with equal match counts. Draft each unit once. | Spending tradeoffs and underused combinations; requires calibrated supply costs and draft UI. |
| Hold the Crossroads | Capture a marked central tile and control it for a stated number of ticks; Core destruction is optional. Score objective completion before damage. | Mobility, displacement, support spacing; requires a new objective and objective-aware unit behavior. |
| Siege Relay | Three boards, persistent wounds, choose one of two routes after board one; one repair token for the expedition. Score checkpoints, then HP remaining. | Attrition and route selection; extends existing wound carryover. Lock the rules for whether revive charges reset. |
| Architect's Trial | Submit one equal-budget defense before a deadline. Test against the same unpublished seeded attack suite and lane distribution. Score median objective denial with a minimum sample count. | Robust defense across opponents; requires submission locking and authoritative evaluation. No reward for friend-fed attacks. |
| Rival Rematch | Two asynchronous legs with normalized rosters and reciprocal attacking roles. Reveal leg one; allow one declared roster substitution for leg two. | Adapting to an opponent; requires PvP snapshots and pairing. Rotate pairings to prevent repeat farming. |
| Community Front | Choose from three eligible contracts, such as breach, escort, or defend. Cap each player's contribution; shared milestone unlocks a cosmetic/map story result. | Collective goals without endless grinding; needs new contract types and shared persistence. |

All numbers above are prototype settings, not certified balance values. In particular, a 24-point cap is meaningless until costs and team outcomes are tested. Avoid stacking multiple untested modifiers in the same event.

**Suggested cadence:** one daily optional puzzle, one weekly competitive side event, and a four-week season. Bank up to three daily challenges; use best results rather than total attempts. Let players select among several mastery contracts, and avoid mandatory streak rewards. A player with three sessions in a week should be able to complete the main seasonal track.

Example four-week season, “Border Disputes”: week one establishes the normal rules with siege puzzles; week two adds a Quartermaster side cup; week three features the objective-control event; week four runs Rival Rematch finals and a community milestone. The ranked rules stay stable throughout. A second season can feature route/attrition play; a third can emphasize defense construction. Carry identity, mastered skills, and cosmetics forward. Reset the competitive map/budget where relevant, and use a soft skill-rating reset that preserves useful matching information.

**Administrator controls needed:** a versioned event definition with eligibility, loan roster, map/seed set, allowed doctrines, supply budget, objective, score/tie rules, attempt policy, UTC opening/closing times, rewards, and rules version. Preview the complete event in a sandbox, run a curated team suite, then schedule it. Lock scored submissions to that version. Use a small library of tested modifiers and rejection rules for invalid combinations; do not require bespoke code every week. Emergency pauses need a published score-preservation or refund policy. This can begin as configuration files plus a validation command before an admin dashboard exists.

**Order of work and acceptance criteria**

1. **Restore trust in rules.** Fix shield lifetime, holder settlement, command validation, claim limits, and power text/behavior. Exercise ledger conservation and full day loops with occupied outposts. Persist sessions before asking people to invest weeks.
2. **Make the base game support rematches.** Remove the home-count exploit; normalize ranked power; test equal-budget compositions, objective choices, recovery, and rating-aware pairings. Keep one clear competitive format initially.
3. **Prove learning and adaptation.** Run repeated-opponent human sessions, not only first impressions. Ask players to explain losses and predict improvements. Observe whether changing a plan improves results and whether opponents can counter-adapt.
4. **Add one repeatable event format.** Ship the fixed-roster weekly puzzle first. Add drafts, objectives, and seasonal territorial competition after their decisions are demonstrably enjoyable.

For simulations, evaluate identical parties across levels, traits, terrain seeds, lanes, defender placement orders, and target strategies. Include adversaries that repeatedly hit the easiest base, farm partial captures, strip home before night, stall to timeout, mass one class, and optimize publicly known seeds. Test late joiners and recovery after consecutive losses. Shared scoring must also withstand friendly loss trading and repeated targeting.

Suggested release gates, to be calibrated rather than treated as universal truths: at least three distinct viable team archetypes with accessible counters; no consistent rank gain from making the measured defense artificially weaker; no long-run strategy that advances every reward track by avoiding objectives; and a usable recovery plan after consecutive losses. Track win rate by skill and matchup rather than targeting 50% in every counter matchup.

For human tests, measure tutorial completion, time to the first understood loss, voluntary rematches, team/plan changes after losses, match outcomes after those changes, and return play after a loss or missed week. For live seasons, inspect days 1/7/30 return rates by newcomer/veteran cohorts, roster diversity adjusted for availability, repeat-target concentration, reward distribution, comeback rate, and net currency flows. Track these alongside interviews: retention driven only by rewards or obligation is not sufficient evidence that combat is fun.

**Design recommendation:** preserve the shared attack/defense roster, distinct terrain, and short readable battles. Build lasting play around equal-budget opponent adaptation, several legitimate objectives, and recovery after defeat. Use seasons to change the problems players solve while preserving what they have learned.

---

## Response and changes (25 September 2026)

Every rule defect above is fixed and covered by a regression test (`npm test`, 23 tests). The review's probe script
(`scripts/design-audit.ts`, adapted to the supply cap) now reports: duplicate raiders rejected; protected with no raid
after a Core loss; reclaim fee to the treasury, not the raider; the second flag purchase refused; identical strength
at home or in an expansion draws the same incoming raid. Decisions marked **owner** were made by the project owner
where the review's advice conflicted with the specified design.

| Finding | Change made |
| --- | --- |
| Rule defects | Rebuild cooldown lasts two nights and is block-based; unique, present raiders enforced; settlement pays the actual holder of each region (resident or owner), so reclaims and outposts settle correctly; one flag per win; Library suppression applied to every D/R/4 power and affinity, with class traits (flight, Family bodies, Hollow's melee resistance, ranged vs flyers) documented and exempt; Tide has its own cooldown; action order and per-region resets documented in the game's EXACT RULES page and README. Family's always-on split became its trait; its defense power is now Brood. |
| 1. Front-loaded progression | **Owner: supply cap.** Each region supports 12 supply and a piece costs its level, so levels trade against numbers and expansions add army size. A full level-4 home is now three pieces. Mastery records, saved plans and permanent identity need persistence (deferred). |
| 2. AI punishes visible home strength | Tonight's raid is fixed at dawn from an explicit, visible threat level (up after a hold, down after a loss) and counter-picks the whole territory, so relocating or sending out pieces can't change it. Knocking its planned raiders out in your own raid keeps them home: a legible new decision. |
| 3. Farming, plunder, reclaim cost | **Owner: every full clear stays one win, plus rebuild cooldowns.** Anyone beaten or losing their Core can't be raided for two nights, and raiding someone else ends it, which stops repeat farming of one opponent. Plunder is labelled "NO WIN: PLUNDER ONLY". Reclaim raids have their own daily allowance. Ghosts now have finite wallets and one raid per night, matching the player. |
| 4. Territory compound advantage | **Owner: keep +15% per region, garrison required.** A region counts only while it holds 2+ of its holder's pieces. Attackers now choose the route through a territory. Equal-supply ranked play and single-region objectives are not adopted. |
| 5. Traits as quality tiers | **Owner: keep trait power tiers** (the Character Spotlight pitch; recruits come from a shared pool). |
| 6. Explainability | Every result shows objective progress and up to three causal highlights from the logs. Free practice rematches against a snapshot, with any party, lane or route. Range overlays when a piece is selected or inspected. The raid and recruit selectors page past their first screen. |
| 7. Economy steady state | The pot is no longer seeded with RF from nowhere; the treasury (80% of winning fees) seeds each next round. Ghosts pay fees, flags, reclaims and morning re-stakes from wallets. RF conservation across all four actors is unit-tested over two weeks of play. The session clock starts at the live round's first block, so every first round is a full seven days. |

**Not attempted in this preview** (needs a server, persistence or new content, beyond the Vibeathon deadline): durable
PvP with locked defense snapshots and a shared clock and ledger; skill ratings; a guided learning campaign; objective
contracts (breach, plunder, hold); the seasonal event formats and administrator tooling; human playtests. Public
deterministic seeds remain an open-puzzle format by choice.
