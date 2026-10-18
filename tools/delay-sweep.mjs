// The Deus ex Futuro test: does the outcome of a slow phase depend on the regulator's delay?
// For each base delay tau0 it runs the physics headless and counts how slow phases end (collapse or consolidation),
// with D = k·tauD (regulator rate × delay) as it stood when growth ended. Regulation should hold below D ≈ π/2.
// Usage: node tools/delay-sweep.mjs [runs=3] [seconds=600] [tau0 list, comma separated]
import {createSim} from '../src/sim.js';

const [runs = 3, SECS = 600] = process.argv.slice(2, 4).map(Number);
const taus = (process.argv[4] || '0,0.05,0.2,0.45,1,2').split(',').map(Number);
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '-';
console.log('tau0   (kg=0 means no regulation)   collapses  consolidations  P(collapse)  mean D at end: collapse / consolidation');
for (const tau0 of taus) {
  const opt = tau0 ? {tau0} : {kg: 0};
  let c = 0, b = 0;const dc = [], db = [];
  for (let r = 0; r < runs; r++) {
    const S = createSim(80, {}, opt);let lastEv = null, Dk = 0;
    for (let f = 0; f < 60 * SECS; f++) {
      S.step(1 / 60);const v = S.view();
      if (v.state === 0) Dk = v.Dk;
      if (v.ev && v.ev !== lastEv) {lastEv = v.ev;if (v.ev.k === 'collapse') {c++;dc.push(Dk)} else if (v.ev.k === 'bifurcate') {b++;db.push(Dk)}}
    }
  }
  console.log(`${(tau0 ? 'tau0 ' + tau0 : 'kg=0').padEnd(36)} ${String(c).padStart(9)}  ${String(b).padStart(14)}  ${(c / Math.max(1, c + b)).toFixed(2).padStart(11)}  ${avg(dc)} / ${avg(db)}`);
}
