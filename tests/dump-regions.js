// node tests/dump-regions.js <seed|image> <T>  -> tests/out/regions.png (composantes colorées)
import fs from 'node:fs';
import { savePng, loadImage, resize } from './lib/image.js';
let src = fs.readFileSync('src/vision/detector.js', 'utf8').replace(/from '\.\//g, "from '../src/vision/");
src = src.replace('let cands = [];', 'globalThis.__G = G; let cands = [];');
fs.writeFileSync('tests/.dr.mjs', src);
const D = await import('./.dr.mjs');
fs.unlinkSync('tests/.dr.mjs');
const arg = process.argv[2], T = +process.argv[3];
const image = /^\d+$/.test(arg) ? (await import('./lib/synth.js')).generate(+arg).image : resize(loadImage(arg), 480);
D.detectFaces(image);
const G = globalThis.__G, W = image.width, H = image.height;
const lab = new Int32Array(W * H).fill(-1);
const out = new Uint8ClampedArray(W * H * 4);
let comp = 0;
for (let s = 0; s < W * H; s++) {
  if (lab[s] >= 0 || G[s] >= T) continue;
  const col = [Math.random() * 255, Math.random() * 255, Math.random() * 255];
  const st = [s]; lab[s] = comp;
  while (st.length) {
    const p = st.pop(); out.set([...col, 255], p * 4);
    const x = p % W;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) if (q >= 0 && q < W * H && lab[q] < 0 && G[q] < T) { lab[q] = comp; st.push(q); }
  }
  comp++;
}
for (let i = 0; i < W * H; i++) if (G[i] >= T) out.set([0, 0, 0, 255], i * 4);
savePng({ width: W, height: H, data: out }, 'tests/out/regions.png');
savePng(image, 'tests/out/regions-src.png');
