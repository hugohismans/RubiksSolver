// Rejoue la détection sur des images extraites d'une vidéo réelle.
// Usage : node tests/replay-detect.js <dossier> [pas]
import fs from 'node:fs';
import { loadImage } from './lib/image.js';
import { detectMultiScale } from '../src/vision/multiscale.js';
import { roughColor } from '../src/scan/model.js';
const dir = process.argv[2], step = +(process.argv[3] || 1);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
let roi = null, k = 0;
for (const f of files.filter((_, i) => i % step === 0)) {
  const img = loadImage(`${dir}/${f}`);
  const t = performance.now();
  const r = detectMultiScale(img, { hint: roi, trackOnly: !!roi && k++ % 4 !== 0 });
  roi = r.roi;
  console.log(f, `${(performance.now() - t).toFixed(0)}ms`, r.faces.map((fc) => `${roughColor(fc.cells[4].lab)}${fc.neighborOf ? '*' : ''}(m${fc.members} sq${fc.squareness.toFixed(2)}) ${fc.cells.map((c) => roughColor(c.lab)).join('')}`).join(' | '));
}
