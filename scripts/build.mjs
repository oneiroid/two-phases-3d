// Builds single-file versions of the page from index.html + src/, and of the stand-alone pieces in petri/ and life/.
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

// The stand-alone pieces, each with the same two outputs: dist/<name>.html and dist/<name>-artifact.html. They have no imports to strip.
for (const name of ['petri', 'life']) {
  html = rd(`${name}/index.html`);
  swap(`<link rel="stylesheet" href="${name}.css">`, `<style>\n${rd(`${name}/${name}.css`)}</style>`);
  swap(`<script type="module" src="${name}.js"></script>`, `<script type="module">\n${rd(`${name}/${name}.js`)}</script>`);
  writeFileSync(join(root, `dist/${name}.html`), html);
  const part = html
    .replace(/^<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*$/i, '')
    .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  writeFileSync(join(root, `dist/${name}-artifact.html`), part);
  console.log('built dist/%s.html (%d bytes), dist/%s-artifact.html (%d bytes)', name, html.length, name, part.length);
}
