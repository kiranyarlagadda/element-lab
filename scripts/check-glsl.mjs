// GLSL smoothstep(edge0, edge1, x) is UNDEFINED when edge0 >= edge1. Most
// drivers happen to evaluate the reversed ramp, so the bug hides until it does
// not -- it cost a whole debugging session once already. Write
// `1.0 - smoothstep(low, high, x)` instead.
//
// Run with `npm run check`. Exits non-zero if any reversed-edge call is found.

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = globSync('src/**/*.js', { cwd: root });

/** Find the index just past the matching ')' for the '(' at `open`. */
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

const findings = [];

for (const rel of files) {
  const source = readFileSync(join(root, rel), 'utf8');
  const re = /smoothstep\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(source, open);
    if (close < 0) continue;
    const args = source.slice(open + 1, close).split(',');
    if (args.length < 3) continue;
    const a = Number.parseFloat(args[0]);
    const b = Number.parseFloat(args[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue; // non-literal edges
    if (a >= b) {
      const line = source.slice(0, m.index).split('\n').length;
      findings.push(`${rel}:${line}  smoothstep(${args[0].trim()}, ${args[1].trim()}, ...) -- edge0 >= edge1`);
    }
  }
}

if (findings.length) {
  console.error(`GLSL check failed: ${findings.length} reversed-edge smoothstep call(s)\n`);
  findings.forEach((f) => console.error('  ' + f));
  console.error('\nRewrite as: 1.0 - smoothstep(low, high, x)');
  process.exit(1);
}

console.log(`GLSL check passed (${files.length} files, no reversed smoothstep edges).`);
