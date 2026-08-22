// Builds the demo into a single self-contained HTML file at dist/element-lab.html.
//
// Useful for handing someone a working copy with no server, no install and no
// network: open the file and it runs. Also what to publish when the demo needs
// to live somewhere that blocks external requests.
//
// Run with `npm run build:single`.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-standalone');
const assets = join(dist, 'assets');

const files = readdirSync(assets);
// Take the largest .js: with inlineDynamicImports there should only be one, and
// picking `files.find(...)` grabbed a stray scene chunk alphabetically once.
const jsFile = files
  .filter((f) => f.endsWith('.js'))
  .sort((a, b) => statSync(join(assets, b)).size - statSync(join(assets, a)).size)[0];
const cssFile = files.find((f) => f.endsWith('.css'));
if (!jsFile) throw new Error(`no .js bundle in ${assets} -- run \`npm run build:single\` first`);
if (files.filter((f) => f.endsWith('.js')).length > 1) {
  throw new Error('expected a single JS chunk; is inlineDynamicImports on?');
}

const js = readFileSync(join(assets, jsFile), 'utf8');
const css = cssFile ? readFileSync(join(assets, cssFile), 'utf8') : '';

// "</script" cannot legally appear outside a string or comment in JS, so this
// substitution is safe and stops the inlined bundle from closing its own tag.
const escaped = js.replaceAll('</script', '<\\/script');

// Emit pure ASCII rather than betting on the host declaring a charset -- a wrong
// guess turns every em dash and curly quote into mojibake. \uXXXX is valid JS
// everywhere a non-ASCII character can legally appear.
const NON_ASCII = /[\u0080-\uFFFF]/g;
const toAscii = (text) =>
  text.replace(NON_ASCII, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const html = readFileSync(join(dist, 'index.html'), 'utf8')
  // Drop the external references; their contents are inlined below instead.
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace('</head>', `<style>${toAscii(css)}</style>\n</head>`)
  .replace('</body>', `<script type="module">\n${toAscii(escaped)}\n</script>\n</body>`);

// The inlined script and style are already ASCII, so anything left is markup
// (figure captions, prose) where numeric entities are safe and charset-proof.
const asciiHtml = html.replace(NON_ASCII, (c) => '&#' + c.charCodeAt(0) + ';');

const leftover = asciiHtml.match(NON_ASCII);
if (leftover) throw new Error(`output is not pure ASCII: ${[...new Set(leftover)].join(' ')}`);

const out = join(dist, 'element-lab.html');
writeFileSync(out, asciiHtml, 'utf8');
console.log(`wrote ${out} (${(Buffer.byteLength(asciiHtml) / 1024).toFixed(0)} KB, ascii-clean)`);
