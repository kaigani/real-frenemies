# Adversarial design review — The Lantern Road, round 1

**Score: 7.2/10. Not yet at the requested 8/10 threshold.**

Reviewed as a four-mission cartridge-scale prototype, not a commercial-length game. The strongest improvement is the coherent visual identity and the compact, deterministic tactics system. Two concrete problems undermine the experience: one quarter of the campaign rewards passivity with a perfect result, and the portrait mobile interface is too small for comfortable play.

## Rubric

| Category | Weight | Score | Evidence |
|---|---:|---:|---|
| Handheld art direction and atmosphere | 25% | 8.5 | Consistent four-tone LCD palette, native bitmap type, readable terrain silhouettes, a composed title illustration, restrained cartridge shell. The battlefield is less expressive than the title but looks intentional. |
| Tactical decisions and encounter design | 30% | 6.5 | Locked enemy squares, shove into water, piercing versus movement, healing, forest armor and free turn reset form a credible tactics vocabulary. Chapter 3 fails the basic pressure test described below. |
| Information and onboarding | 20% | 7.5 | Exact outgoing damage, two-stage attack confirmation, clear objectives, guide and range outlines are good. Enemy resolution is largely a simultaneous state change plus a text log; observing who hit whom is less clear than planning your own attack. |
| Controls, accessibility and mobile | 15% | 5.5 | Desktop keyboard selection/movement/forecast worked independently. Mobile preserves the image but gives players 16px tiles, 13px-high action buttons and roughly 5px-high text. |
| Campaign arc and replay | 10% | 7.5 | Four different objectives, short briefs, medals and an ending give the prototype a complete arc. Replay exists after each mission, but there is no chapter selection or retained record after reload. That is disclosed, yet weakens medal chasing. |

Weighted total: **7.225, rounded to 7.2**.

## Changes required to clear 8

1. **Make Lantern Watch demand active defense.** Independently executing `createBattle(2)` followed by six `endTurn` calls wins with lantern 8/8, two allies alive and two medals. Guarding all three allies every turn, with zero moves and zero attacks, wins all three medals with all allies alive (Pip 3 HP, Rook 6, Moss 7), lantern still 8/8. This is not a clever positional solution: it is repeating one safe input without reading the map. Adjust enemy arrival positions/timing, lantern pressure, or the objective so a passive strategy fails while several active plans remain viable. Verify both a legal successful plan and these passive counterexamples. Adding HP alone would not fix the absence of urgency. The same all-guard strategy loses in Chapters 1, 2 and 4 within 15, 13 and 11 turns respectively; this demonstrated perfect-score exploit is specific to Chapter 3.

2. **Provide usable portrait touch controls and legible information.** At a 360×844 viewport, an independent browser measurement gives the canvas `{x:20,y:228,width:319,height:212}`. The screenshot is technically contained, but attacks require precise taps on tiny cells/buttons and the tactical text is miniature. Add a usable touch command/selection surface and a readable status/forecast surface, or a real enlarged mobile layout. Keep pixel art crisp. A no-horizontal-overflow assertion and coordinate-perfect Playwright taps do not demonstrate finger usability. Validate ordinary taps and all core actions without keyboard assistance.

## Further polish with high value

- Show the enemy phase as understandable individual events, or present a compact readable consequence summary identifying the attacker and victim. Currently the 750ms “enemy turn” wait happens before the whole resolution, and multiple events become a clipped bottom log.
- Add chapter selection with best medals retained, at least for the current session. A player reaching the ending should be able to improve an earlier chapter without replaying intervening content.
- Preserve the current strengths: deterministic forecasts, easy undo, clear role distinctions, and water shoves. These do more for the requested classic tactics feeling than extra decorative effects would.

## Evidence and limits

I read `game/src/tactics.ts`, `game/src/tactics-app.ts`, `game/src/ui.ts`, the browser playthrough and solver, and demo styling. I inspected supplied desktop/mobile title and battle images and independently used Playwright at `http://localhost:4174`: Enter opened/deployed, arrow/Enter moved Pip, S plus target confirmation produced the correct water-KO forecast. Independent screenshot: `artifacts/review-round1-mobile.png`. Passive-strategy results above came from direct calls to the production engine, not the solver. I did not independently hand-play all four missions to completion, verify every device/browser, or assess audio quality. Existing passing checks establish useful correctness coverage; they do not establish encounter pressure or touch comfort.

The prototype now has a recognizable and appealing identity. The score remains below 8 because the defensive mission and mobile interaction still fail substantive design checks, not because it lacks commercial-scale content.
