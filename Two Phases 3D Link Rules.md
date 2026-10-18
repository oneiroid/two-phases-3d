# Two Phases 3D: Link Rules

Oct 18, 2026 · @Alexey Ogibin

Links form only during growth. They tighten as they age, yield instead of breaking while the structure grows, and break only in the fast phases, which follow different rules during collapse, dispersal and consolidation. All rules below are in `src/sim.js`. Distances use `SP = 100`, and node radius is `rad = 3.5 + 3.6·√m`.

## When a link can form

During growth, once the system has cooled (`heat < 0.35`), every pair of nodes is checked each step. A link between nodes *i* and *j* is created when all five conditions hold.

1. **Both nodes are free.** Neither is being absorbed, and neither is a fresh arrival still moving in from the container edge (the `arr` flag clears once the node is inside the sphere).
2. **Neither node is full.** Each has fewer than `MAXDEG = 6` links.
3. **The nodes are in contact.** Distance `d ≤ 1.35·gap`, where `gap = rad_i + rad_j + 0.38·SP`.
4. **The pair is not linked and not cooling down.** A pair whose link broke waits 4 s before it can link again.
5. **The path is clear** (`crossesAny`). The segment may not pass within `rad(k) + 0.1·SP` of any other node, and may not come within `0.16·SP` of an existing link that shares no endpoint with it.

A new link starts with these values:

| Property | Value | Note |
| --- | --- | --- |
| Rest length `L` | `max(0.97·d, gap)` | Close to the current length, so the link starts almost unloaded |
| Stiffness `k` | `K0 = 0.1` | Rises with age during growth |
| Strength `s` | `K0 · L · 0.22 · rand(0.6…1.4) · (1 + 0.06·(m_min − 1))` | Longer links and links between heavier nodes are stronger; ±40% random spread |

## Other ways links are created

- **Absorption.** When a heavy node absorbs a light one, the light node's links are removed. The absorber then links to those former neighbours that are within `2.2·SP`, have a clear path, and while the absorber has fewer than 8 links (`MAXDEG + 2`).
- **End of consolidation** (`linkHubs`). Each surviving hub links to up to 4 of its nearest hubs when the path is clear. These links are twice as strong. They grow in over 0.5 s, and their force is scaled by the growth factor `gr` during that time. This path has no per-node link limit.

## Spring model

Each link is a spring with tension `T = k·(d − L)·gr`, applied along the link to both ends. The load ratio `u = T / s` is positive under tension and negative under compression.

- Colour shows the smoothed `|u|`: grey-blue is safe, amber is loaded, red is close to breaking.
- Thickness shows the smoothed `|T|`.
- A link bows when it is compressed.

## Growth: links tighten

During growth, links become stiffer and shorter over time. This builds stress across the structure until it fails.

- **Stiffness rises with age.** `k = K0·(1 + min(1.4, age/12))`, so a link is 2.4× stiffer after about 17 s.
- **Rest length shrinks** toward `0.75·gap` at a rate of `0.18·D·(1 − 2·brake)` per second. The drive `D` (the structure's might) grows superlinearly, `dD/dt = 0.083·(1 + 0.4·level)·(0.35 + D)^1.5`, and the brake comes from self-regulation (next section). When `brake > 0.5` the rate is negative and links loosen back toward their length at birth. Pulling nodes closer than contact distance is what eventually overloads the structure.
- **Gravity** between nodes scales with `2 + 70·Deff²`, where `Deff = D·(1 − brake)`.
- **Absorption along links.** If one end is more than 1.8× heavier than the other, the heavy end can absorb the light one. The chance per second is `0.1 + 0.8·su²`, where `su` is the link's smoothed load, so loaded links cause more absorption. At most one absorption starts every 0.25 s across the whole system.
- **Links push nodes aside.** A node that comes within `rad + 0.16·SP` of a link's segment is pushed off it, and the link's two ends receive the opposite force.

## Self-regulation with a delayed signal

This section follows the two-phase law of *Deus ex Futuro: Core Beliefs and the Dynamics of Transition* (§3, §4, §8). The structure brakes its own contraction from its load, but it sees that load late.

- **Signal.** The 97th percentile of the smoothed link load `su`, so the regulator watches the most stressed links.
- **Delay.** The brake reads the signal as it was `tauD` seconds ago: `tauD = 0.45 · (Σk / (2·K0·N))^1.3 / (1 + 0.4·level)`. Total link stiffness stands for complexity: links multiply and harden with age, so the delay grows through a phase. A new level runs faster and regulates with a proportionally shorter delay.
- **Brake.** `d(brake)/dt = k · (signal(t − tauD) − 0.5) / 0.5`, clamped to `[0, 1]`. The regulator's rate `k = 15 · (dD/dt) / (0.35 + D)` keeps pace with the relative growth rate of the drive.
- **Indicator.** `D_reg = k · tauD`. For the simplest delayed negative feedback, regulation is stable only while `D_reg < π/2` (Hayes). The HUD shows `D_reg` against that limit, with a 20 s trace of the load and of the delayed load the brake acts on.

In practice the regulator holds the load early in a phase. As `D_reg` rises, the brake swings between off and full on with growing amplitude, and the overshoots cause the yields that trigger a collapse.

## Overload and breaking

The load limits are `u > 1` (tension) and `u < −1.4` (compression), so a link carries 40% more force in compression than in tension.

**In growth, links never break.** An overloaded link yields: its rest length gives way just enough to hold the load at the limit, so the link stays red and keeps its stress. The stress is released all at once in the collapse.

- **Collapse trigger.** During growth, once `D > 0.45`, if at least `max(3, 10% of links)` links have yielded within the last 0.5 s and one of them touches a hub, that hub undergoes fission and the collapse phase starts. A hub is a node in about the top 8% by mass with mass of at least 3.5. Without a hub under overload, growth goes on until the overload reaches one, or a node grows heavy enough to start consolidation.

A break, which happens only in collapse and dispersal, has these effects:

- **Recoil.** Both ends get an impulse along the link of `(0.4 + min(2, |u|)) · kick`, divided by √mass. A link that breaks under tension makes its ends fly apart. `kick` is 2.4 for links of a splitting hub and for links the crack reaches, 1.5 for links that fail on their own in collapse, and 1 in dispersal.
- **Fatigue.** Both endpoints gain `fat += 0.3`, which decays with a time constant of about 0.7 s, and they flash.

## Collapse, dispersal and consolidation

| Phase | Breaking rule | Other behaviour |
| --- | --- | --- |
| Collapse | A link fails on its own when its effective load `u / max(0.15, 1 − 0.45·fatigue)` passes 1.12 (or −1.55), so a link that only yielded waits for the crack | The crack: each break schedules each link attached to either endpoint to break 0.1 to 0.28 s later with probability `0.04 + 0.9·min(1, 1.2·su²)`, so it runs through loaded links and stops in relaxed ones. Gravity keeps binding the intact part in proportion to the share of links still unbroken. A fragment that touches a heavy node splits it with probability `0.04 + 0.9·sig²` (one try per pair) |
| Dispersal | Breaks at the load limits, plus a 1.5% chance of breaking per 1/60 s | Strength decays as `s·e^(−0.5t)`, so the remaining links fall apart within a few seconds |
| Consolidation | Links never break | Rest length follows the current distance, clamped to `[0.9·gap, 1.6·SP + radii]`; age resets and stiffness returns to `K0`, so the next level starts with relaxed links |

Every step, a link is removed if either endpoint has been removed or is being absorbed, and duplicate links are dropped.

**Depth of a revolution.** When the collapse ends, its depth is the share of heavy mass (nodes of mass ≥ 2.5) that was split. A shallow revolution (depth ≤ 0.45) falls back to the start of its own slow phase and keeps its level. A depth up to 0.75 loses one level, and a deeper one returns to level 0.

## Differences from the 2D version

- **Path clearance.** The 2D version forbids crossing links, which keeps the graph planar. In 3D, lines almost never intersect, so the rule is replaced by the minimum distance from other nodes and links described above.
- **Link limit.** `MAXDEG = 6` is new in 3D. A planar graph averages about 3 links per node, so the 2D version did not need a limit. Without it, the 3D structure would be much denser and stiffer.
