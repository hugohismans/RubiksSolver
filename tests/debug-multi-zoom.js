// Comme debug-multi, mais dessine sur un zoom pleine résolution de la zone du cube.
import path from 'node:path';
import { loadImage, resize, drawPoly, fillRect, savePng } from './lib/image.js';
import { detectMultiScale, cropResize } from '../src/vision/multiscale.js';
import { roughColor } from '../src/scan/model.js';
const full = resize(loadImage(process.argv[2]), 1280);
const r = detectMultiScale(full);
const k = full.width / r.width;
const xs = r.faces.flatMap((f) => f.corners.map((p) => p[0])), ys = r.faces.flatMap((f) => f.corners.map((p) => p[1]));
const x0 = Math.max(0, Math.min(...xs) - 10), y0 = Math.max(0, Math.min(...ys) - 10), x1 = Math.max(...xs) + 10, y1 = Math.max(...ys) + 10;
const Z = 500, zs = Z / Math.max(x1 - x0, y1 - y0);
const img = cropResize(full, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, Math.round((x1 - x0) * zs), Math.round((y1 - y0) * zs));
const m = ([x, y]) => [(x - x0) * zs, (y - y0) * zs];
for (const f of r.faces) {
  drawPoly(img, f.corners.map(m), [255, 255, 0]);
  f.cells.forEach((c) => { const [x, y] = m([c.x, c.y]); fillRect(img, x - 6, y - 6, 13, 13, [0, 0, 0]); fillRect(img, x - 4, y - 4, 9, 9, c.rgb); });
  console.log(f.predicted ? 'complétée' : 'détectée ', [0, 1, 2].map((rr) => f.cells.slice(rr * 3, rr * 3 + 3).map((c) => roughColor(c.lab)).join('')).join(' / '));
}
savePng(img, 'tests/out/zoom-' + path.basename(process.argv[2]).replace(/\.\w+$/, '.png'));
