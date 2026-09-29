# Lantern Road HD art prompts

Generated with the built-in image_gen tool on 2026-09-29. The supplied game and character comps were style references. Selected source atlases are saved beside this document; discarded variants are not game assets.

## Character atlas

Use case: stylized-concept. Asset type: production pixel-art character atlas for The Lantern Road, a turn-based strategy game.
The two provided images are STYLE REFERENCES, not edit targets. Match their carefully drawn monochrome pixel character charm, distinct silhouettes, confident dark outlines, stepped pixel edges and restrained checkerboard dithering. Keep our green LCD colors only: darkest #182c24, shadow #617b52, mid #a6ba76, light #dbe7ad. No black or white outside this palette. Transparent background, actual alpha.
Create ONE atlas, 1536x1024, EXACTLY 3 equal columns and 2 equal rows (512x512 cells), no gutters, no frames, no labels, no text. Center one complete character in each cell with at least 40 pixels transparent margin. All characters share the same rendering resolution: hand-drawn 96x96 logical pixel sprites enlarged with nearest-neighbor-like hard pixel steps. They must be expressive enough for large dialogue portraits, not simplistic icons. Visible dithered shadows, armor, fabric folds, ears, faces; no gradients, no vector curves, no painterly blur. Three-quarter front view with clear silhouettes.
Top left: PIP, a small determined horned woodland warden, cream face, huge curved horns, chunky leaf-shaped shoulder armor, dark tunic, gauntlets, sturdy little boots; reference 02's appealing proportions, original costume.
Top center: ROOK, a nimble long-eared fox ranger, enormous expressive pointed ears, pale face, dark eyes, leaf scarf, short travel cloak, small quiver and bow, confident adventurous stance.
Top right: MOSS, a gentle round forest spirit healer, big soft round body, tiny arms and feet, two vertical dark eyes, sprouting leaf tuft and small satchel with herbal sprigs, calm friendly expression.
Bottom left: BRAMBLE, a small masked forest bandit in a pointed thorn hood and ragged cloak, holding a short crooked bow, menacing but cute.
Bottom center: CINDER, a squat imp sapper with long drooping ears, protective goggles, little metal furnace backpack and a round glowing lantern-bomb in hand.
Bottom right: HOLLOW KING, a dark masked woodland monarch with tall branching antlers, pale blank face with two eyes, layered flowing cloak with dithered inner shadow, a gnarled staff, regal and ominous.
Characters must remain separated in their own cells. The result is an actual usable pixel sprite atlas, not a photograph of an atlas or a mockup of a game screen.

## Final background correction

Edit the FIRST image (six-character sheet). The SECOND image is only a background color/style reference.
Replace the dark background in the FIRST image with a completely flat PALE LIGHT GREEN #dbe7ad, matching the empty background around the trees in the SECOND image. The background must be light, NOT dark. Remove all vignette, fog and glow. Keep all six characters unchanged in their current positions and sizes. Keep the same 3 columns and2 rows. Retain the dark outlines and crisp pixel art. No text. This specific change from DARK background to LIGHT pale-green background is the entire edit.

## Terrain atlas

Production pixel-art terrain atlas for a retro green monochrome tactics game, inspired by the attached strategy-game screenshot. This reference defines the style, not the exact map.
Create a 1024x1024 sheet: exactly FOUR columns by FOUR rows, each cell 256x256. Every cell holds ONE isolated terrain sprite or square texture. Consistent overhead/three-quarter map view, no isometric diamond bases. Fine hand-placed-looking square pixels, dark outline, patterned checkerboard shadows, strong readable silhouettes and tiny crafted details. All artwork only in four green colors: #182c24, #617b52, #a6ba76, #dbe7ad. Empty background a uniform solid #dbe7ad pale green; no gradients or glow. NO letters, numbers, labels, grid lines, frames, legend, character units or UI.
Row1 left to right: a cluster of three detailed conifer trees; a single tall broadleaf tree; a craggy layered mountain with pale peak; a cozy steep-roof village cottage with chimney and lit windows.
Row2: tall crenellated stone lantern tower with arched door and bright top window; a small ornate stone healing shrine with carved leaf symbol and flowering vines; a bramble thicket with tangled branches; a fluttering small pennant flag on a stone base.
Row3: patch of meadow flowers and grass tufts; a horizontal wooden bridge with rails and planks viewed from above; cluster of layered boulders; old broken stone arch covered with ivy.
Row4: seamless square meadow texture with widely spaced small grass marks; seamless square dark river-water texture with pale broken ripple dashes; seamless square irregular cobblestone road texture; seamless wooden decking with fine plank lines.
The first12 objects centered within their cells, complete silhouettes with 16px margins; the final4 texture tiles fill their entire cells. Logical native pixel density about64x64 per object. Match the reference's terrain richness and dithered handcrafted style, with our olive LCD palette.

## Integration

`npm run art:pack` palette-locks the sources and writes the committed `packed.ts` data URLs. This avoids cross-origin canvas taint inside the SDK sandbox and reduces the embedded artwork to roughly 565 KiB. It uses Playwright Chromium as an offline canvas packer; no generation API is involved in this step.

The renderer slices the packed atlases, snaps every sampled color to the existing four-color palette, and removes only edge-connected pale background from isolated sprites. Character portraits and field sprites use separate native-size caches. The generated source files remain untouched.
