// Builds single-file versions of the page from index.html + src/.
//   dist/two-phases-3d.html  standalone document, opens from disk (three.js still loads from jsDelivr)
//   dist/artifact.html       the same page without <!doctype>/<html>/<head>/<body>, for publishing as a claude.ai Artifact
// Usage: node scripts/build.mjs
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => readFileSync(join(root, p), 'utf8');

let html = rd('index.html');
const css = rd('src/style.css');
const sim = rd('src/sim.js').replace('export function createSim(', 'function createSim(');
const main = rd('src/main.js').replace(/^import \{createSim\} from '\.\/sim\.js';\n/m, '');
if (main.includes("from './sim.js'")) throw new Error('main.js: sim import not stripped');

const swap = (from, to) => {
  if (!html.includes(from)) throw new Error('build: marker not found: ' + from);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="src/style.css">', `<style>\n${css}</style>`);
swap('<script type="module" src="src/main.js"></script>', `<script type="module">\n${sim}\n${main}</script>`);

mkdirSync(join(root, 'dist'), {recursive: true});
writeFileSync(join(root, 'dist/two-phases-3d.html'), html);

// Artifact fragment: the publisher adds its own document skeleton, charset and viewport meta.
const frag = html
  .replace(/^<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*$/i, '')
  .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
writeFileSync(join(root, 'dist/artifact.html'), frag);
console.log('built dist/two-phases-3d.html (%d bytes), dist/artifact.html (%d bytes)', html.length, frag.length);

// Petri (petri/): the same two outputs, dist/petri.html and dist/petri-artifact.html. It has no imports to strip.
html = rd('petri/index.html');
swap('<link rel="stylesheet" href="petri.css">', `<style>\n${rd('petri/petri.css')}</style>`);
swap('<script type="module" src="petri.js"></script>', `<script type="module">\n${rd('petri/petri.js')}</script>`);
writeFileSync(join(root, 'dist/petri.html'), html);
const pfrag = html
  .replace(/^<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*$/i, '')
  .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
writeFileSync(join(root, 'dist/petri-artifact.html'), pfrag);
console.log('built dist/petri.html (%d bytes), dist/petri-artifact.html (%d bytes)', html.length, pfrag.length);
