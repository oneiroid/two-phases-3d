// Runs the simulation without rendering and logs phase transitions.
// Use it to check that a physics change keeps the cycle alive (growth -> collapse or consolidation -> growth).
// Usage: node tools/headless-sim.mjs [nodes=80] [seconds=480] [gravityScale=0.42] [maxDegree=6] [containerScale=0.8]
import {createSim} from '../src/sim.js';

const [N = 80, SECS = 480, gs = .42, maxdeg = 6, rs = .8] = process.argv.slice(2).map(Number);
const S = createSim(N, {}, {gs, maxdeg, rs});
const NAMES = ['growth', 'collapse', 'dispersal', 'consolidation'];
let prev = -1;
const count = {collapse: 0, consolidation: 0};
const t0 = Date.now();
for (let f = 0; f < 60 * SECS; f++) {
  S.step(1 / 60);
  const v = S.view();
  if (v.state !== prev) {
    if (v.state === 1) count.collapse++;
    if (v.state === 3) count.consolidation++;
    let mx = 0, ext = 0, deg = 0;
    for (const i of v.A) {
      mx = Math.max(mx, S.m[i]);
      deg += S.nb[i];
      if (S.nb[i]) ext = Math.max(ext, Math.hypot(S.px[i] - v.bcx, S.py[i] - v.bcy, S.pz[i] - v.bcz));
    }
    console.log(`${v.T.toFixed(1).padStart(6)}s  ${NAMES[v.state].padEnd(13)} level ${v.level}  nodes ${v.A.length}  links ${v.bonds.length}` +
      `  mean degree ${(deg / Math.max(1, v.A.length)).toFixed(2)}  max mass ${mx.toFixed(1)}/${v.Mth.toFixed(1)}  extent ${ext.toFixed(0)}`);
    prev = v.state;
  }
}
console.log(`container radius ${S.R.toFixed(0)} · collapses ${count.collapse} · consolidations ${count.consolidation} · ${((Date.now() - t0) / (60 * SECS)).toFixed(2)} ms per step`);
