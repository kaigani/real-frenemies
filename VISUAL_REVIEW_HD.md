# Lantern Road visual review — 2026-09-29

Target: the supplied detailed monochrome tactics-map and creature-sheet references, retaining the game's four green LCD colors.

## Implemented

- 640 × 480 campaign canvas, detailed 40-pixel field sprites, 94-pixel dialogue portraits and 162-pixel briefing illustrations.
- Six imagegen characters and a 16-cell terrain atlas, with source images and prompts in `game/assets/lantern/`.
- Connected roads, riverbanks, bridges, forests, mountains, shrines and lantern towers; framed dialogue and chapter-specific speakers.
- Native-size sprite caches quantized to the exact existing palette. Embedded image data works inside the SDK sandbox; packed artwork is approximately 565 KiB.
- Campaign and legacy canvas sizes are independent. Phone command controls retain their 44-pixel minimum height.

## Iterations

1. Integrated generated art and rebuilt campaign presentation. Visual inspection found sparse terrain, undersized command labels and visible water-tile seams.
2. Added connected roads, larger headings/action labels, continuous riverbanks, texture-edge cropping and full-width briefing backdrops. Fixed SDK canvas taint by embedding palette-packed images, corrected the mobile status separator and kept road rendering behind shrines.
3. Final desktop/mobile screenshots and an independent adversarial visual review: **8.2/10**, meeting the requested 8/10 threshold. Reviewer inspected both references, final captures and the SDK screenshot, and independently exercised touch movement and water-KO confirmation at 360px/DPR2.

Reviewer strengths: detailed terrain, expressive silhouettes, larger portraits, framed dialogue and cohesive desktop composition.

Remaining limitations: narrow DPR1 screens lose strokes in the smallest canvas text (the HTML touch deck supplies readable status and controls); raider and archer share artwork with an A marker for archers; movement corner marks can blend into grass. The reviewer did not independently replay the whole campaign; the automated tests below cover it.

## Verification

- `npm test`: 32 passing tests.
- `npm run typecheck`, `npm run check`: pass.
- `npm run test:tactics` and `npm run test:tactics -- 360`: all four chapters completed through public controls; forecasts, undo, help, end-turn confirmation, exact four-color palette and 640 × 480 native dimensions verified.
- `npm run test:browser`: official SDK sandbox smoke test passes.
- `npm run test:play` and `npm run test:play -- 360`: territory regression playthroughs and integer-pixel checks pass.
- `npm run build` and `npm run build:demo`: production builds succeed.

Local captures (ignored by Git): `artifacts/hd-final/{1280,360}-{title,brief,battle}.png`, full campaign captures in `artifacts/tactics-{1280,360}/`, and reviewer's touch capture `artifacts/hd-review-mobile-dpr2.png`.

## Follow-up: battlefield icon correction

At the user's request, battlefield and briefing-map units now use the original chunky 16 × 16 Rare Friend icons at integer scale, with idle animation and a pale outline for terrain contrast. Detailed generated characters remain in selected-unit details, dialogue, and narrative illustrations. The selected Friend supplies Pip's field icon; raiders and archers again have different canonical silhouettes. The four-chapter browser playthrough, type check, and both production builds passed after this correction. Capture: `artifacts/chunky-battlefield.png`. The 8.2 review above predates this correction.
