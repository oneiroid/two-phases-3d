// Headless check of Life Rules (software WebGL): steps the grid, prints the census and saves screenshots.
// Usage: NODE_PATH=$(npm root -g) node tools/life-shot.mjs <out-prefix> [step ...]
//   n:<size>            grid size for the run (default 256; must come first)
//   rule:<B3/S23>       set the rule
//   fill:<density>      restart with random cells (0 gives a single cell, -n a random n by n block, 'none' an empty grid)
//   stamp:<name>,<x>,<y>[,<turns>]   place a pattern (glider, spaceship, r-pentomino, acorn, glider gun, pulsar)
//   run:<gens>          step, printing the census every 2000 generations
//   view:<0|1>          colour by lineage, or by age
//   cam:<x>,<y>,<zoom>  centre the view on a cell, at zoom CSS pixels per cell
//   live:<ms>           unpause and let the page run its own loop in real time, then pause again
//   snap:<name>         screenshot to <out-prefix>-<name>.png
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

let [out = 'life', ...plan] = process.argv.slice(2);
let n = 256;
if (plan[0]?.startsWith('n:')) n = +plan.shift().slice(2);
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: +(process.env.VW || 1280), height: +(process.env.VH || 800)}});
const logs = [];
page.on('console', m => {if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) logs.push(m.type() + ': ' + m.text())});
page.on('pageerror', e => logs.push('error: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/life/index.html?n=${n}`);
await page.waitForFunction(() => window.__life, null, {timeout: 20000}).catch(() => {});
if (!(await page.evaluate(() => !!window.__life))) {console.log(logs.join('\n'));await browser.close();server.close();process.exit(1)}
await page.evaluate(() => window.__life.pause(true));
const census = () => page.evaluate(() => {const p = window.__life;p.count();const s = p.stats();s.alive = +s.alive.toFixed(4);return s});
for (const it of plan.length ? plan : ['run:2000', 'snap:start']) {
  const at = it.indexOf(':'), k = it.slice(0, at), v = it.slice(at + 1);
  if (k === 'run') for (let left = +v; left > 0; left -= 2000) {
    await page.evaluate(s => {for (let i = 0; i < s; i += 50) window.__life.step(Math.min(50, s - i))}, Math.min(2000, left));
    console.log(JSON.stringify(await census()));
  }
  else if (k === 'rule') await page.evaluate(r => window.__life.setRule(r), v);
  else if (k === 'fill') await page.evaluate(d => window.__life.reset(d), v === 'none' ? null : +v);
  else if (k === 'stamp') {const [name, x, y, t = 0] = v.split(',');await page.evaluate(a => window.__life.stamp(...a), [name, +x, +y, +t])}
  else if (k === 'live') {await page.evaluate(() => window.__life.pause(false));await page.waitForTimeout(+v);await page.evaluate(() => window.__life.pause(true));console.log(JSON.stringify(await census()))}
  else if (k === 'view') await page.evaluate(m => window.__life.view(m), +v);
  else if (k === 'cam') await page.evaluate(a => window.__life.cam(...a), v.split(',').map(Number));
  else if (k === 'snap') {await page.waitForTimeout(400);await page.screenshot({path: `${out}-${v}.png`})}
  else throw new Error('unknown step ' + it);
}
if (logs.length) console.log(logs.join('\n'));
await browser.close();
server.close();
