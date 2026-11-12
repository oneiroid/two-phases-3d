// Headless check of Petri (software WebGL): steps the dish, prints the census and saves screenshots.
// Usage: NODE_PATH=$(npm root -g) node tools/petri-shot.mjs <out-prefix> [step ...]
//   n:<size>       world size for the run (default 256; must come first)
//   set:<k>=<v>    set a sim parameter in window.__petri.P (mu, sig, rS, cS, kin, kP, year, KW)
//   run:<steps>    step the sim, printing the census every 2000 steps
//   view:<0|1|2>   life, genes, land
//   live:<ms>      unpause and let the page run its own loop in real time, then pause again
//   snap:<name>    screenshot to <out-prefix>-<name>.png
// Viewport: VW and VH environment variables (default 1280×800).
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'};
const server = createServer(async (req, res) => {
  try {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root + sep)) throw 0;
    res.writeHead(200, {'content-type': types[extname(p)] || 'application/octet-stream'});
    res.end(await readFile(p));
  } catch { res.writeHead(404);res.end() }
}).listen(0);

let [out = 'petri', ...plan] = process.argv.slice(2);
let n = 256;
if (plan[0]?.startsWith('n:')) n = +plan.shift().slice(2);
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: +(process.env.VW || 1280), height: +(process.env.VH || 800)}});
const logs = [];
page.on('console', m => {if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text())});
page.on('pageerror', e => logs.push('error: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/petri/index.html?n=${n}`);
await page.waitForFunction(() => window.__petri, null, {timeout: 20000}).catch(() => {});
if (!(await page.evaluate(() => !!window.__petri))) {console.log(logs.join('\n'));await browser.close();server.close();process.exit(1)}
await page.evaluate(() => window.__petri.pause(true));
// census summary: life, soil, and the mean and spread of both genes over living samples
const census = () => page.evaluate(() => {
  const p = window.__petri;p.count();
  const c = p.census;let m = 0, sf = 0, sk = 0, qf = 0, qk = 0;
  for (let i = 0; i < c.length; i += 4) if (c[i + 2] > 50) {const f = c[i] / 255, k = c[i + 1] / 255;m++;sf += f;sk += k;qf += f * f;qk += k * k}
  const s = p.stats(), r = v => +v.toFixed(3);
  return {t: s.frame, life: r(s.life), soil: r(s.soil), kinds: s.kinds, f: r(sf / m), k: r(sk / m), sdf: r(Math.sqrt(Math.max(0, qf / m - (sf / m) ** 2))), sdk: r(Math.sqrt(Math.max(0, qk / m - (sk / m) ** 2)))};
});
for (const it of plan.length ? plan : ['run:2000', 'snap:start']) {
  const at = it.indexOf(':'), k = it.slice(0, at), v = it.slice(at + 1);
  if (k === 'run') for (let left = +v; left > 0; left -= 2000) {
    await page.evaluate(s => {for (let i = 0; i < s; i += 50) window.__petri.step(50)}, Math.min(2000, left));
    console.log(JSON.stringify(await census()));
  }
  else if (k === 'set') {const [a, b] = v.split('=');await page.evaluate(([a, b]) => {window.__petri.P[a] = b}, [a, +b])}
  else if (k === 'live') {await page.evaluate(() => window.__petri.pause(false));await page.waitForTimeout(+v);await page.evaluate(() => window.__petri.pause(true));console.log(JSON.stringify(await census()))}
  else if (k === 'view') await page.evaluate(m => window.__petri.view(m), +v);
  else if (k === 'snap') {await page.waitForTimeout(400);await page.screenshot({path: `${out}-${v}.png`})}
  else throw new Error('unknown step ' + it);
}
if (logs.length) console.log(logs.join('\n'));
await browser.close();
server.close();
