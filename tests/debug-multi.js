// node tests/debug-multi.js <photo> : détection en deux temps, image annotée.
import path from 'node:path';
import { loadImage, resize, clone, drawPoly, fillRect, savePng } from './lib/image.js';
import { detectMultiScale } from '../src/vision/multiscale.js';
const full = resize(loadImage(process.argv[2]), 1280);
const t = performance.now();
const r = detectMultiScale(full);
console.log(`${(performance.now() - t).toFixed(0)} ms, ${r.faces.length} faces`, r.faces.map((f) => `m=${f.members}${f.solid ? ' unie' : ''}`).join(' '));
const small = resize(full, 400), dbg = clone(small);
if (r.roi) drawPoly(dbg, [[r.roi[0], r.roi[1]], [r.roi[2], r.roi[1]], [r.roi[2], r.roi[3]], [r.roi[0], r.roi[3]]], [0, 200, 255]);
for (const f of r.faces) { drawPoly(dbg, f.corners, [255, 255, 0]); f.cells.forEach((c) => fillRect(dbg, c.x - 2, c.y - 2, 5, 5, c.rgb)); }
savePng(dbg, 'tests/out/multi-' + path.basename(process.argv[2]).replace(/\.\w+$/, '.png'));
