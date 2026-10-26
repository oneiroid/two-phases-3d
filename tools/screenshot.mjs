// Screenshots of the page in headless Chromium (software WebGL), for checking visual changes without a GPU.
// It serves the repo itself and drives the sim through window.__tp3d.sim, so a phase can be reached in seconds.
// Usage: node tools/screenshot.mjs <out-prefix> [step ...]
//   until:<state>  step the sim until view().state equals it (0 growth, 1 collapse, 2 dispersal, 3 consolidation)
//   warp:<s>       step the sim <s> seconds at once (the HUD trace sees none of it)
//   crawl:<s>      step the sim <s> seconds in small slices with frames between, so the HUD trace fills
//   wait:<ms>      let the page run in real time
//   snap:<name>    full-page screenshot to <out-prefix>-<name>.png
//   hud:<name>     the HUD corner only
// Example: node tools/screenshot.mjs /tmp/tp until:0 warp:3 crawl:12 snap:growth until:1 wait:700 snap:collapse
// Viewport: VW and VH environment variables (default 1280×800). Playwright is resolved through NODE_PATH, so with a global
// install run it as NODE_PATH=$(npm root -g) node tools/screenshot.mjs ...
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
    const body = await readFile(p);
    res.writeHead(200, {'content-type': types[extname(p)] || 'application/octet-stream'});
    res.end(body);
  } catch { res.writeHead(404);res.end() }
}).listen(0);
const port = server.address().port;

const [out = 'shot', ...plan] = process.argv.slice(2);
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: +(process.env.VW || 1280), height: +(process.env.VH || 800)}});
const logs = [];
page.on('console', m => {if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text())});
page.on('pageerror', e => logs.push('error: ' + e.message));
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => window.__tp3d && window.__tp3d.sim, null, {timeout: 20000});
const steps = s => page.evaluate(n => {const S = window.__tp3d.sim;for (let i = 0; i < n; i++) S.step(1 / 60)}, s);
for (const it of plan.length ? plan : ['wait:1500', 'snap:start']) {
  const at = it.indexOf(':'), k = it.slice(0, at), v = it.slice(at + 1);
  if (k === 'warp') await steps(Math.round(+v * 60));
  else if (k === 'crawl') for (let i = 0; i < +v * 4; i++) {await steps(15);await page.waitForTimeout(40)}
  else if (k === 'until') await page.evaluate(st => {const S = window.__tp3d.sim;for (let i = 0; i < 60 * 240 && S.view().state !== st; i++) S.step(1 / 60)}, +v);
  else if (k === 'wait') await page.waitForTimeout(+v);
  else if (k === 'snap') await page.screenshot({path: `${out}-${v}.png`});
  else if (k === 'hud') await page.screenshot({path: `${out}-${v}.png`, clip: {x: 0, y: 0, width: 260, height: 230}});
  else throw new Error('unknown step ' + it);
}
if (logs.length) console.log(logs.join('\n'));
await browser.close();
server.close();
