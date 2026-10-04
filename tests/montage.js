// node tests/montage.js out.png a.png b.png c.png d.png  (grille 2 colonnes)
import fs from 'node:fs';
import { PNG } from 'pngjs';
const [out, ...files] = process.argv.slice(2);
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
const W = Math.max(...imgs.map((i) => i.width)), H = Math.max(...imgs.map((i) => i.height));
const cols = 2, rows = Math.ceil(imgs.length / cols);
const o = new PNG({ width: W * cols, height: H * rows });
imgs.forEach((im, k) => {
  const ox = (k % cols) * W, oy = Math.floor(k / cols) * H;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const p = (y * im.width + x) * 4, q = ((y + oy) * W * cols + x + ox) * 4;
    for (let c = 0; c < 4; c++) o.data[q + c] = im.data[p + c];
  }
});
fs.writeFileSync(out, PNG.sync.write(o));
