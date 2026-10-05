// node tests/debug-frame.js <image> : détection multi-échelle annotée.
import path from 'node:path';
import { loadImage, resize, clone, drawPoly, fillRect, savePng } from './lib/image.js';
import { detectMultiScale } from '../src/vision/multiscale.js';
const full = loadImage(process.argv[2]);
const r = detectMultiScale(full);
const small = resize(full, 400), dbg = clone(small);
for (const f of r.faces) { drawPoly(dbg, f.corners, f.neighborOf ? [0, 255, 255] : [255, 255, 0]); f.cells.forEach((c) => fillRect(dbg, c.x - 2, c.y - 2, 5, 5, c.rgb)); }
console.log(r.faces.map((f) => `m${f.members} sq${f.squareness.toFixed(2)} solid=${f.solid} uniform=${f.uniform}`).join(' | '));
savePng(dbg, 'tests/out/frame-' + path.basename(process.argv[2]).replace(/\.\w+$/, '.png'));
