// Usage : node tests/debug-image.js <image> [maxSide]
// Lance le détecteur et écrit une image annotée dans tests/out/.
import fs from 'node:fs';
import path from 'node:path';
import { loadImage, resize, clone, drawPoly, fillRect, savePng } from './lib/image.js';
import { detectFaces } from '../src/vision/detector.js';

const file = process.argv[2];
const maxSide = +(process.argv[3] || 480);
const img = resize(loadImage(file), maxSide);
const t = performance.now();
const res = detectFaces(img);
console.log(`${img.width}x${img.height} en ${(performance.now() - t).toFixed(1)} ms, ${res.candidates.length} candidats, ${res.faces.length} faces`);
const dbg = clone(img);
for (const c of res.candidates) drawPoly(dbg, c.quad, [255, 0, 255]);
for (const f of res.faces) {
  drawPoly(dbg, f.corners, [255, 255, 0]);
  for (const m of f.memberCands) drawPoly(dbg, m.quad, [0, 255, 255]);
  f.cells.forEach((c) => fillRect(dbg, c.x - 3, c.y - 3, 7, 7, c.rgb));
  console.log(`face score=${f.score.toFixed(2)} membres=${f.members} résidu=${f.residual.toFixed(3)} roll=${f.roll.toFixed(0)}`);
  for (let r = 0; r < 3; r++) console.log('  ' + f.cells.slice(r * 3, r * 3 + 3).map((c) => c.lab.map((v) => v.toFixed(0).padStart(4)).join(',')).join(' | '));
}
fs.mkdirSync('tests/out', { recursive: true });
const out = path.join('tests/out', path.basename(file).replace(/\.\w+$/, '') + `-${maxSide}.png`);
savePng(dbg, out);
console.log('->', out);
