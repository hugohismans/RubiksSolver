// Évalue le détecteur sur des images synthétiques.
// Usage : node tests/eval-synth.js [n] [seed0] [--save] [--style=black|stickerless]
import fs from 'node:fs';
import { generate, COLORS } from './lib/synth.js';
import { detectFaces } from '../src/vision/detector.js';
import { rgbToLab, labDist } from '../src/vision/color.js';
import { savePng, clone, drawPoly, fillRect } from './lib/image.js';
import zlib from 'node:zlib';

// Cache disque des images générées (la génération est la partie lente).
function cached(seed, opts) {
  const key = `${seed}-${JSON.stringify(opts)}`.replace(/[^\w-]/g, '_');
  const file = `tests/out/cache/${key}.gz`;
  if (fs.existsSync(file)) {
    const { w, h, gt, data } = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
    return { image: { width: w, height: h, data: new Uint8ClampedArray(Buffer.from(data, 'base64')) }, gt };
  }
  const r = generate(seed, opts);
  fs.mkdirSync('tests/out/cache', { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ w: r.image.width, h: r.image.height, gt: r.gt, data: Buffer.from(r.image.data).toString('base64') })));
  return r;
}

const args = process.argv.slice(2);
const n = +(args.find((a) => /^\d+$/.test(a)) || 100);
const seed0 = +(args.filter((a) => /^\d+$/.test(a))[1] || 1);
const save = args.includes('--save');
const styleArg = (args.find((a) => a.startsWith('--style=')) || '').split('=')[1];
const extra = {};
for (const a of args) { const m = a.match(/^--(\w+)=(.+)$/); if (m && m[1] !== 'style') extra[m[1]] = isNaN(+m[2]) ? (m[2] === 'true' ? true : m[2] === 'false' ? false : m[2]) : +m[2]; }

const conf = {};
let fpSolid = 0, fp = 0, fpImgs = 0, found = 0, top = 0, cellsOk = 0, cellsTot = 0, time = 0;
const failures = {};
fs.mkdirSync('tests/out/synth', { recursive: true });
for (let s = seed0; s < seed0 + n; s++) {
  const { image, gt } = cached(s, { style: styleArg, ...extra });
  const t0 = performance.now();
  const res = detectFaces(image, { n: extra.n || 3 });
  time += performance.now() - t0;
  const cell = Math.hypot(gt.centers[0][0] - gt.centers[1][0], gt.centers[0][1] - gt.centers[1][1]);
  const match = res.faces.findIndex((f) => f.cells.every((c, k) => Math.hypot(c.x - gt.centers[k][0], c.y - gt.centers[k][1]) < 0.3 * cell));
  const mask = Buffer.from(gt.mask, 'base64');
  const fps = res.faces.filter((f) => !mask[Math.round(f.center[1]) * image.width + Math.round(f.center[0])]);
  const nfp = fps.length; fpSolid += fps.filter((f) => f.solid).length;
  fp += nfp; if (nfp) fpImgs++;
  const key = `${gt.style}${gt.solvedFace ? '-solved' : ''}`;
  failures[key] = failures[key] || { n: 0, miss: 0 };
  failures[key].n++;
  let wrong = [];
  if (match >= 0) {
    found++;
    if (match === 0) top++;
    const f = res.faces[match];
    const refs = COLORS.map((c) => rgbToLab(...gt.palette[c]));
    f.cells.forEach((c, k) => {
      // classification naïve au plus proche de la palette (pour tester l'échantillonnage)
      let best = 0, bd = 1e9;
      refs.forEach((r, i) => { const d = labDist(c.lab, r); if (d < bd) { bd = d; best = i; } });
      cellsTot++;
      if (COLORS[best] === gt.colors[k]) cellsOk++; else { wrong.push(k); const kk = gt.colors[k] + '>' + COLORS[best] + (k === 4 ? '(centre)' : ''); conf[kk] = (conf[kk] || 0) + 1; }
    });
  } else failures[key].miss++;
  if (save && (match < 0 || wrong.length || nfp || match > 0)) {
    const dbg = clone(image);
    for (const c of res.candidates) drawPoly(dbg, c.quad, [255, 0, 255]);
    for (const f of res.faces) { drawPoly(dbg, f.corners, [255, 255, 0]); f.cells.forEach((c) => fillRect(dbg, c.x - 2, c.y - 2, 5, 5, c.rgb)); }
    savePng(dbg, `tests/out/synth/${s}-${key}${match < 0 ? "-miss" : nfp ? "-fp" : match > 0 ? "-rank" : "-col"}.png`);
  }
}
console.log(`faux positifs: ${fp} (${fpImgs} images, ${fpSolid} unies), détectée: ${found}/${n} (${(100 * found / n).toFixed(1)}%), en tête: ${top}/${n}, cases correctes: ${cellsOk}/${cellsTot} (${(100 * cellsOk / Math.max(1, cellsTot)).toFixed(1)}%), ${(time / n).toFixed(0)} ms/image`);
for (const [k, v] of Object.entries(failures)) console.log(`  ${k}: ratés ${v.miss}/${v.n}`);
console.log('  confusions', JSON.stringify(conf));
