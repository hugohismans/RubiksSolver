import { loadImage, savePng } from './lib/image.js';
const [, , src, dst, x, y, w, h] = process.argv;
const img = loadImage(src);
const out = new Uint8ClampedArray(w * h * 4);
for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
  const p = ((+y + yy) * img.width + (+x + xx)) * 4, q = (yy * w + xx) * 4;
  out.set(img.data.subarray(p, p + 4), q);
}
savePng({ width: +w, height: +h, data: out }, dst);
