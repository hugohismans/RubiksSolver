// Rejoue le mode libre (détection + capture) sur les images d'une vidéo réelle.
// Usage : node tests/replay-free.js <dossier> [fps]
import fs from 'node:fs';
import { loadImage } from './lib/image.js';
import { detectMultiScale } from '../src/vision/multiscale.js';
import { FreeCapture } from '../src/scan/freecapture.js';
import { roughColor } from '../src/scan/model.js';
const dir = process.argv[2], fps = +(process.argv[3] || 8);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
const cap = new FreeCapture();
let roi = null;
files.forEach((f, k) => {
  const now = (k * 1000) / fps;
  const r = detectMultiScale(loadImage(`${dir}/${f}`), { hint: roi, trackOnly: !!roi && k % 4 !== 0 });
  roi = r.roi;
  const u = cap.update(r.faces, now);
  const desc = r.faces.map((fc) => `${roughColor(fc.cells[4].lab)}${fc.neighborOf ? '*' : ''}sq${fc.squareness.toFixed(2)}`).join(' ');
  const tr = u.tracking ? ` suivi ${u.tracking.guess} ${(u.tracking.progress * 100).toFixed(0)}%` : '';
  console.log(`${f} [${desc}]${tr}${u.seen.length ? ' déjà:' + u.seen.join('') : ''}${u.captured.map((c) => ' CAPTURE ' + c.color + ' ' + c.labs.map((l) => roughColor(l)).join('')).join('')}`);
});
console.log('capturées :', Object.keys(cap.captures).join(' '));
