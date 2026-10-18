# Two Phases 3D

A 3D simulation of a network under load. Nodes link when they touch, links carry force, and the structure alternates between two outcomes:

- **Collapse.** A heavy hub tears, splits into fragments (fission), and a crack runs through the loaded links while the fragments split other heavy nodes. The structure disperses. A shallow collapse keeps its level, and a deep one falls back by one level or to level 0.
- **Consolidation.** A node passes the mass threshold, heavy nodes absorb the light nodes within their reach, the surviving hubs link to each other, and their masses are rescaled. The hubs become the units of the next level.

While it grows, the structure regulates its own contraction from its load, which it sees with a delay that lengthens as it grows. The readout under the phase name shows D = k·τ against the π/2 stability limit and a 20 s trace of the load next to the delayed load. This follows the two-phase law in *Deus ex Futuro*.

Colour shows how close a part is to failing: grey-blue is safe, amber is loaded, red is about to break. Link thickness shows the force a link carries. A bowed link is compressed and a sagging one is slack.

## Run

ES modules do not load from `file://`, so serve the folder:

```
npm run serve        # http://localhost:8080
```

Any static server works (`python -m http.server 8080` too). three.js 0.160.0 loads from jsDelivr through the import map in `index.html`, so there is nothing to install.

## Controls

| Input | Action |
|---|---|
| Left drag | rotate the view (free 3D trackball) |
| Right drag, or Shift + left drag | roll around the view axis |
| Wheel, pinch | zoom |
| Middle button held, or Space held | slow motion (×1/3 of the base rate); drag up or down while holding to change it |
| Time slider | base time rate, ×0.05 to ×1.5, default ×1 |
| `1×` button | reset the base rate |
| Arrow keys, Q / E | rotate, roll |
| R | reset the view |
| M | mute |

On touch screens, one finger rotates and two fingers zoom and twist (roll). Slow motion on touch is set with the slider.

## Scripts

```
npm run build        # dist/two-phases-3d.html (single file) and dist/artifact.html (Artifact fragment)
npm run sim          # headless physics run that logs phase transitions
npm run sweep        # delay experiment: share of phases ending in collapse against the regulator's delay
```

`npm run sim -- 80 480 0.42 6 0.8` takes nodes, seconds, gravity scale, max link degree and container scale.
