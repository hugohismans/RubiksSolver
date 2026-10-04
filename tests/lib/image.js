// Utilitaires d'image pour les tests Node (décodage, redimensionnement, dessin).
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export function loadImage(path) {
  const buf = fs.readFileSync(path);
  if (path.endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  }
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function savePng(img, path) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  fs.writeFileSync(path, PNG.sync.write(png));
}

// Réduction par moyenne de zone (comme drawImage avec lissage).
export function resize(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.round(img.width * s), H = Math.round(img.height * s);
  const out = new Uint8ClampedArray(W * H * 4);
  const fx = img.width / W, fy = img.height / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const p = (yy * img.width + xx) * 4;
        r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; n++;
      }
      const q = (y * W + x) * 4;
      out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

export function clone(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function drawLine(img, x0, y0, x1, y1, col) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const p = (y * img.width + x) * 4;
    img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2];
  }
}

export function drawPoly(img, pts, col) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    drawLine(img, a[0], a[1], b[0], b[1], col);
  }
}

export function fillRect(img, x, y, w, h, col) {
  for (let yy = Math.max(0, y | 0); yy < Math.min(img.height, y + h); yy++)
    for (let xx = Math.max(0, x | 0); xx < Math.min(img.width, x + w); xx++) {
      const p = (yy * img.width + xx) * 4;
      img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2];
    }
}
