# Two Phases 3D, notes for Claude Code

A 3D port of a 2D canvas piece ("Two Phases"). No framework and no build step for development. `index.html` loads `src/style.css` and `src/main.js` as an ES module. three.js 0.160.0 comes from jsDelivr through the import map.

## Layout

- `src/sim.js` contains the simulation only (`export function createSim(N, hooks, opt)`). It has no DOM and no three.js, so it runs in Node.
- `src/main.js` holds rendering (three.js), sound (Web Audio), controls, HUD and the frame loop. It reads the sim's typed arrays directly.
- `src/style.css` is the HUD overlay.
- `scripts/build.mjs` inlines everything into `dist/two-phases-3d.html` and `dist/artifact.html`, and builds `petri/` and `life/` the same way.
- `tools/headless-sim.mjs` runs the physics without rendering and logs phase transitions, with D at the end of each growth phase and the depth of each revolution.
- `tools/delay-sweep.mjs` is the Deus ex Futuro delay test (`npm run sweep`).
- `tools/screenshot.mjs` serves the repo, opens it in headless Chromium (SwiftShader WebGL) and steps the sim through `window.__tp3d.sim` to reach a phase, then saves screenshots.
- `Two Phases 3D Link Rules.md` documents every link and phase rule with its constants. Keep it in step with `src/sim.js`.

## Commands

- `npm run serve` serves the folder on port 8080.
- `npm run sim [-- N seconds gs maxdeg rs]` is the regression check for physics changes.
- `npm run sweep [-- runs seconds tau0,tau0,...]` repeats the Deus ex Futuro delay test (several minutes).
- `NODE_PATH=$(npm root -g) node tools/screenshot.mjs <out-prefix> until:0 warp:3 crawl:12 snap:growth until:1 wait:700 snap:collapse` checks the look of each phase (steps are listed at the top of the file; `VW`/`VH` set the viewport). Use it after any rendering change.
- `npm run build` must be run before publishing or sharing a single file. `dist/` is committed, so rebuild before committing a change to `index.html` or `src/`.

## Simulation

States (`view().state`): 0 growth, 1 collapse (fission chain), 2 dispersal, 3 consolidation.

- Node arrays are preallocated with `NM = 3N` slots. `act[i]` marks live slots, `abs[i] >= 0` marks a node being absorbed by node `abs[i]`.
- Links are objects in `bonds` with `u = tension / strength` as the load ratio. The load limits are `u > 1` (tension) and `u < -1.4` (compression). In growth an overloaded link yields (its rest length gives way, the load holds at the limit) and never breaks. Collapse starts when at least 10% of links have yielded within 0.5 s and one of them touches a hub. Links break only in collapse and dispersal.
- The drive `D` (the structure's might) grows superlinearly during growth and is capped at `3 + 0.3·level`. A growth phase that has not ended after 80 s collapses at its heaviest node (`gT` marks its start). This is only a safety net and does not fire in normal runs.
- Self-regulation (from the Deus ex Futuro two-phase law): the brake acts on the 97th-percentile link load as it was `tauD` seconds ago. `tauD` grows with total link stiffness and shrinks by `1 + 0.4·level`. `Dk = kG·tauD` (`view().Dk`) is the indicator, with π/2 as the stability limit. `brake` scales contraction by `1 − 2·brake` and gravity through `Deff = D·(1 − brake)`. The percentile matters: with the 85th, collapses start at hotspots around heavy hubs that the signal misses, and the collapse share no longer depends on the delay.
- Collapse: the crack runs into loaded links (chance `0.04 + 0.9·min(1, 1.2·su²)`), the intact part stays bound, and `depth` (share of heavy mass split) decides how many levels a revolution loses.
- In 2D, new links could not cross existing ones (a planar graph). In 3D, `crossesAny(i, j)` rejects a link that passes within `rad(k) + 0.1·SP` of another node, or within `0.16·SP` of an existing link (segment–segment distance). `MAXDEG` (default 6) caps links per node.
- The container is a sphere of radius `R = cbrt(N·SP³·3/4π)·rs`, with `SP = 100`. During collapse and dispersal the walls switch off ("leak") and nodes beyond `R + 50` are removed.
- Gravity is scaled by `gs = 0.42` against the 2D constants, because a 3D neighbourhood within the same cutoff holds about 3× more nodes.
- Sound and visual events go out through `hooks` (`pluck`, `tick`, `glide`, `pop`, `bif`, `hubs`, `creak`), so the sim stays silent in Node.

Reference run (`npm run sim`, N = 80, 480 s): cycles of about 6 to 35 s (median about 17 s), mean degree 4 to 6, a mix of collapses and consolidations (typically about 7 and 13). `npm run sweep` runs the delay experiment: the share of phases that end in collapse against the base delay `tau0`. The original 2D version had mean degree about 3 and similar cycle lengths. After any physics change, check that both outcomes still occur and that growth restarts.

## Rendering

- Every custom shader writes linear colour, and `OutputPass` converts to sRGB once at the end. Convert sRGB constants with `lin()` before passing them in.
- The renderer clear colour is 0 on purpose. Through the composer, three 0.160 encodes the clear colour twice (`#04060b` came out as `#222a3b`). The dark backdrop is the `sky` sphere instead.
- Ribbons (links, snapped halves, fragment tracks, motion streaks) are one instanced quadratic-Bézier strip, expanded toward the camera in the vertex shader. The material needs `side: DoubleSide`, because the strip's winding depends on view direction. Thin ribbons keep a 1.4 px minimum width and fade their alpha instead.
- Billboards (halos, flashes, level rings, link growth tips, and the rings for reach, fission shock fronts and the inward load-signal pulses) use additive `One/One` blending with premultiplied output. A sphere seen from outside is a circle, so those three are camera-facing rings, not sphere meshes, which washed the frame out when several overlapped.
- Motion: a new collapse plays in bullet time (`cine`, about 2.6 s, rate down to ×0.2) with the view leaning toward the hub that split; during consolidation the view leans toward the heaviest node. Both are off under `prefers-reduced-motion`.
- Pass order is RenderPass → AfterimagePass (trails, stronger in slow motion, cut while the view turns fast) → UnrealBloomPass → OutputPass.

## Controls and camera

- The camera orientation is the quaternion `camQ`. Drags rotate it about the camera's own axes through `turn(pitch, yaw, roll)`, so there is no fixed up direction and no pole. After 4 s without input the view tumbles slowly about a drifting axis (disabled under `prefers-reduced-motion`).
- Mouse input: left rotates, right or Shift + left rolls, middle held gives slow motion. Touch input: one finger rotates, two fingers pinch and twist.
- Time rate: `ts` eases toward `tsT`. `tsT = base`, or `base · SLOW · 2^(dy/70)` while slow motion is held, and at most `base · 0.2` at the start of bullet time. `base` is the slider value (log scale ×0.05 to ×1.5, default 1). Slow-motion visuals (letterbox, vignette, streaks, longer trails) follow `ts` through `es`.

## Publishing as a claude.ai Artifact

`dist/artifact.html` is the page without a document skeleton, which the Artifact publisher adds. External scripts may only come from cdnjs, jsDelivr `/npm/`, unpkg and a few others, pinned to exact versions. Fonts come from Google Fonts.

The live page is https://claude.ai/artifact/LroFEqexzxDVSuBSZ1v8ut. Republish `dist/artifact.html` there (same URL) after a change.

## Related documents

These are Claude Docs docs, edited through the Claude Docs connector, not by publishing files.

- Two Phases 3D: Link Rules, https://claude.ai/artifact/VHHuAyxi5KFVopZnsiLSe6. The published copy of the rules file. It points to the Deus ex Futuro doc for the delay-test results instead of repeating the table.
- Deus ex Futuro: Core Beliefs and the Dynamics of Transition, https://claude.ai/code/artifact/bc68a28d-1108-4411-bb46-ff3c73e643ee. This is the source of the two-phase law the sim follows. Section 9 holds the delay-test chart.

## Petri (`petri/`)

A separate piece: an evolving Gray-Scott automaton in raw WebGL 2, with no three.js and no shared code with `src/`. `petri/index.html` loads `petri.css` and `petri.js`. `npm run build` also writes `dist/petri.html` and `dist/petri-artifact.html`.

- State is two RGBA32F textures, stepped by one fragment shader into two render targets. A holds `U` food, `V` life, `S` soil, `T` trail. B holds the lineage gene (a hue, circular), the greed gene, and `own`, a vector on the hue circle that records which lineage spent the soil.
- The feed rate is not a gene. It comes from `rain(u)`, a drifting map (`P.year` steps per turn). The kill rate is `kMid(f) + (greed − 0.5)·KW`, which follows the patterned band of Gray-Scott. An earlier version made feed and kill the genes: the strain that survives on the least food (lowest feed + kill) always swept the dish, and below f ≈ 0.024 the travelling-wave strains overran everything. Do not move form back into the genes without a mechanism that counters this.
- Inheritance is particulate: each step a cell takes the genes of one source of its `V`, chosen in proportion to the matter received, with the resident weighted fourfold. Blending genes instead dilutes every mutant.
- Diversity is kept by soil sickness: on spent soil (`1 − S` past 0.25) the kill rate of the lineage that spent it rises by up to `kP`, falling off with hue distance (`kin`). Without it one lineage sweeps within a few thousand steps.
- The display blends strain colours, never gene values, because averaging hues invents colours that are not there.
- `tools/petri-shot.mjs` (`npm run petri`) is the regression check: it steps the dish headless, prints life, soil and the number of lineages, and saves screenshots. After a change to the sim, run 30 000 steps at the default 256 and check that `kinds` stays above about 10 and life stays between 20% and 60%.
- The live page is https://claude.ai/artifact/6arLMAg2mTku3WRzQHjjZr. Republish `dist/petri-artifact.html` there after a change.

## Life Rules (`life/`)

A third piece, on the branch `claude/life-rules`: the Game of Life and its family (outer-totalistic rules on eight neighbours), in raw WebGL 2. It shares no code with `src/` or `petri/`. It was written because Petri had too many rules to read as a cellular automaton, so keep it to the one rule.

- The rule is two bit masks over the neighbour count, `born` and `surv`. Birth on zero neighbours is disabled, because it makes the whole grid flash every generation.
- State is one RGBA8 texture: `r` alive, `g` generations in the current state (capped at 255), `b` lineage hue. Age and hue never feed back into the rule. A newborn takes the hue of one live neighbour at random.
- `noise` (random flips) is the only departure from the exact rule, and it is zero by default.
- One shader does both a generation (`run` 1) and a brush stroke (`run` 0), so drawing while paused does not advance time. Stamps are written with `texSubImage2D`.
- The page counts on generations that are multiples of six, so blinkers and pulsars give the same numbers every time. "settled" means population and change held steady for eight counts.
- `tools/life-shot.mjs` (`npm run life`) is the regression check. After a change to the step shader: an r-pentomino on an empty 512 grid must have exactly 116 cells at generation 1103, and a glider must keep 5.
- The live page is https://claude.ai/artifact/EzDio9Bk2dEDBgn9UR6BWc. Republish `dist/life-artifact.html` there after a change.
- It has only been seen in headless SwiftShader, where a 512 grid runs at about 40 generations a second. Rules other than Life were checked by eye for a few hundred generations.

## Known gaps

- Visual checks so far have been headless SwiftShader screenshots only, not a real GPU.
- The force loop is O(n²) per substep, with up to 24 substeps at high time rates. It runs at about 1 ms per step for N = 80 in Node.
- The on-screen hint names mouse controls on touch screens too.
- Petri has only been seen in headless SwiftShader, and its long-run behaviour is checked to 30 000 steps on a 256 dish. The greed gene drifts slowly toward greedy; what happens far beyond that is not tested.
