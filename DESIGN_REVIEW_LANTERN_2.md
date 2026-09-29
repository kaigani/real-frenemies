# Adversarial design review — The Lantern Road, round 2

**Score: 8.1/10. The requested 8/10 threshold is met for the four-mission prototype.**

The two major round-1 objections are addressed with substantive changes. Lantern Watch now punishes inaction, and mobile offers a complete, usable control path without requiring precise taps on 16px tiles. This is a strong compact tactics prototype with an appealing handheld identity. The score is not a claim that it is objectively the greatest Game Boy strategy game.

## Same weighted rubric

| Category | Weight | Score | Assessment |
|---|---:|---:|---|
| Handheld art direction and atmosphere | 25% | 8.5 | The four-tone palette, bitmap lettering, crisp terrain and composed title remain cohesive. The touch deck matches the palette while keeping practical controls outside the tiny board. |
| Tactical decisions and encounter design | 30% | 8.0 | Sappers create an actual defense priority distinct from fighting nearby enemies. Movement versus Pierce, shove placement, healing, locked attacks and signal occupation provide useful decisions across the four objectives. Passive defense no longer earns a victory. |
| Information and onboarding | 20% | 8.0 | Exact forecasts and confirmation remain reliable. The readable mobile status/coordinates and retrievable enemy report close substantial information gaps. Enemy resolution still lacks a strong visual sequence. |
| Controls, accessibility and mobile | 15% | 7.5 | All four chapters can be completed through actual touch-button taps alone. Large unit selectors, direction buttons, Select, Undo and action buttons eliminate mandatory tiny targets. The battlefield itself remains small, and the desktop-style guide text is still miniature on portrait phones. |
| Campaign arc and replay | 10% | 8.0 | Four objectives and an ending now connect to unlocked chapter selection and retained best medals for the current session. Replay is meaningfully easier. Reload still discards progress, as disclosed. |

Weighted total: **8.05, rounded to 8.1**. Same weights and prototype scope as round 1.

## Independent verification

- Re-ran the original exploit directly against the revised production engine. Both six-turn-pass and all-friends-guard policies now **lose on turn 4 with lantern 0/8 and no medals**. The new role targets the lantern, and the route field avoids the previous local movement trap.
- Ran a separate Playwright session at **360×844 with `hasTouch: true`**, using the touch deck's actual `.tap()` events for the entire campaign. **No canvas coordinate clicks and no physical keyboard input** were used. All four chapters completed. This is stronger input coverage than the existing test, which still uses canvas taps for most movement/targeting.
- Independently exercised Pip's first water shove: moved using direction buttons, selected Skill, obtained the exact water-KO forecast, confirmed with Select, then used Undo to restore the turn.
- Used Chapters after the first victory, selected the next unlocked chapter, and deployed it through the deck. After the ending, selected Chapter 3 again, deployed, ended a turn, opened Log and returned successfully.
- Reviewed revised production engine/app/adapter/style code and refreshed desktop/mobile screenshots. Independent touch-run screenshot: `artifacts/review-round2-dock-report.png`.

The campaign commands used the repository's deterministic solver to choose legal plans; this validates complete touch input and reachable victories, not human first-play difficulty. The exploit checks were separate from the solver.

## Remaining limits, none blocking 8

1. Enemy actions still resolve together after the phase banner. The report makes outcomes inspectable, but sequential strike flashes and clearer victim emphasis would make the battlefield easier to follow without opening it.
2. Portrait mobile now works, but the board and field guide remain physically small. A larger inspection/guide view would improve comfort, especially for players with reduced vision. The touch action row also remains generically labeled Skill rather than showing the selected character's ability.
3. Session-only records limit casual return visits. Saving unlocked chapters and best medals would improve the cartridge feel without requiring accounts or a server.
4. This review does not establish audio quality, broad device compatibility, long-term balance, or accessibility with a screen reader. It does not independently reproduce every legacy-mode check reported by the implementer.

No third design loop is required under the user's threshold rule. The biggest remaining gains are presentation and convenience refinements, rather than repairs to the core tactical loop.
