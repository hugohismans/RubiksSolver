// Statistiques des raisons de rejet des régions : node tests/trace-reject.js <seed>
import fs from 'node:fs';
let src = fs.readFileSync('src/vision/detector.js', 'utf8');
src = src.replace(/from '\.\//g, "from '../src/vision/");
let n = 0;
src = src.replace(/if \(([^\n]*?)\) continue;/g, (m, cond) => {
  if (!/fill|quadFit|aspect|cosang|okAngles|std|np \/ \(bw/.test(cond)) return m;
  return `if (${cond}) { globalThis.__rej && globalThis.__rej(${JSON.stringify(cond)}, sx/np, sy/np, np); continue; }`;
});
fs.writeFileSync('tests/.tr.mjs', src);
const rej = {};
globalThis.__rej = (c, x, y, np) => { (rej[c] = rej[c] || []).push(`${x.toFixed(0)},${y.toFixed(0)}:${np}`); };
const D = await import('./.tr.mjs');
const { generate } = await import('./lib/synth.js');
const { image } = generate(+process.argv[2]);
const r = D.detectFaces(image);
for (const [k, v] of Object.entries(rej)) console.log(k, v.length, v.filter((s) => +s.split(':')[1] > 300).slice(0, 15).join(' '));
fs.unlinkSync('tests/.tr.mjs');
