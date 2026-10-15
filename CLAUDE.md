# Two Phases 3D, notes for Claude Code

A 3D port of a 2D canvas piece ("Two Phases"). No framework and no build step for development. `index.html` loads `src/style.css` and `src/main.js` as an ES module. three.js 0.160.0 comes from jsDelivr through the import map.

## Layout

- `src/sim.js` contains the simulation only (`export function createSim(N, hooks, opt)`). It has no DOM and no three.js, so it runs in Node.
- `src/main.js` holds rendering (three.js), sound (Web Audio), controls, HUD and the frame loop. It reads the sim's typed arrays directly.
- `src/style.css` is the HUD overlay.
- `scripts/build.mjs` inlines everything into `dist/two-phases-3d.html` and `dist/artifact.html`.
- `tools/headless-sim.mjs` runs the physics without rendering and logs phase transitions.

## Commands

- `npm run serve` serves the folder on port 8080.
- `npm run sim [-- N seconds gs maxdeg rs]` is the regression check for physics changes.
- `npm run build` must be run before publishing or sharing a single file.

## Simulation

States (`view().state`): 0 growth, 1 collapse (fission chain), 2 dispersal, 3 consolidation.

- Node arrays are preallocated with `NM = 3N` slots. `act[i]` marks live slots, `abs[i] >= 0` marks a node being absorbed by node `abs[i]`.
- Links are objects in `bonds` with `u = tension / strength` as the load ratio. The load limits are `u > 1` (tension) and `u < -1.4` (compression). In growth an overloaded link yields (its rest length gives way, the load holds at the limit) and never breaks. Collapse starts when at least 10% of links have yielded within 0.5 s and one of them touches a hub. Links break only in collapse and dispersal.
- In 2D, new links could not cross existing ones (a planar graph). In 3D, `crossesAny(i, j)` rejects a link that passes within `rad(k) + 0.1·SP` of another node, or within `0.16·SP` of an existing link (segment–segment distance). `MAXDEG` (default 6) caps links per node.
- The container is a sphere of radius `R = cbrt(N·SP³·3/4π)·rs`, with `SP = 100`. During collapse and dispersal the walls switch off ("leak") and nodes beyond `R + 50` are removed.
- Gravity is scaled by `gs = 0.42` against the 2D constants, because a 3D neighbourhood within the same cutoff holds about 3× more nodes.
- Sound and visual events go out through `hooks` (`pluck`, `tick`, `glide`, `pop`, `bif`, `hubs`, `creak`), so the sim stays silent in Node.

Reference run (`npm run sim`, N = 80, 480 s): cycles of about 15 to 35 s, mean degree 4 to 6, a mix of collapses and consolidations (for example 9 and 12). The original 2D version had mean degree about 3 and similar cycle lengths. After any physics change, check that both outcomes still occur and that growth restarts.

## Rendering

- Every custom shader writes linear colour, and `OutputPass` converts to sRGB once at the end. Convert sRGB constants with `lin()` before passing them in.
- The renderer clear colour is 0 on purpose. Through the composer, three 0.160 encodes the clear colour twice (`#04060b` came out as `#222a3b`). The dark backdrop is the `sky` sphere instead.
- Ribbons (links, snapped halves, fragment tracks, motion streaks) are one instanced quadratic-Bézier strip, expanded toward the camera in the vertex shader. The material needs `side: DoubleSide`, because the strip's winding depends on view direction. Thin ribbons keep a 1.4 px minimum width and fade their alpha instead.
- Billboards (halos, flashes, level rings, link growth tips) and shells (reach spheres, fission shock fronts) use additive `One/One` blending with premultiplied output.
- Pass order is RenderPass → AfterimagePass (trails, stronger in slow motion, cut while the view turns fast) → UnrealBloomPass → OutputPass.

## Controls and camera

- The camera orientation is the quaternion `camQ`. Drags rotate it about the camera's own axes through `turn(pitch, yaw, roll)`, so there is no fixed up direction and no pole. After 4 s without input the view tumbles slowly about a drifting axis (disabled under `prefers-reduced-motion`).
- Mouse input: left rotates, right or Shift + left rolls, middle held gives slow motion. Touch input: one finger rotates, two fingers pinch and twist.
- Time rate: `ts` eases toward `tsT`. `tsT = base`, or `base · SLOW · 2^(dy/70)` while slow motion is held. `base` is the slider value (log scale ×0.05 to ×1.5, default 1). Slow-motion visuals (letterbox, vignette, streaks, longer trails) follow `ts` through `es`.

## Publishing as a claude.ai Artifact

`dist/artifact.html` is the page without a document skeleton, which the Artifact publisher adds. External scripts may only come from cdnjs, jsDelivr `/npm/`, unpkg and a few others, pinned to exact versions. Fonts come from Google Fonts.

## Known gaps

- The collapse phase has not been checked visually after the last tuning pass. Growth, slow motion and consolidation were checked.
- The force loop is O(n²) per substep, with up to 24 substeps at high time rates. It runs at about 1 ms per step for N = 80 in Node.
