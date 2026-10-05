// Détection en deux temps : une passe rapide sur l'image réduite pour trouver
// le cube, puis une passe sur un zoom autour du cube, à partir de l'image en
// pleine résolution. Le cube, souvent petit dans le champ (tenu à bout de
// bras), est ainsi analysé avec assez de pixels pour lire 2 ou 3 faces.

import { detectFaces } from './detector.js';

// Réduction / recadrage par moyenne de zone. src : {width, height, data}.
export function cropResize(src, x0, y0, w, h, outW, outH) {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const fx = w / outW, fy = h / outH;
  const sd = src.data, SW = src.width;
  for (let y = 0; y < outH; y++) {
    const ya = Math.floor(y0 + y * fy), yb = Math.max(ya + 1, Math.floor(y0 + (y + 1) * fy));
    for (let x = 0; x < outW; x++) {
      const xa = Math.floor(x0 + x * fx), xb = Math.max(xa + 1, Math.floor(x0 + (x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = ya; yy < yb; yy++) {
        let p = (yy * SW + xa) * 4;
        for (let xx = xa; xx < xb; xx++, p += 4) { r += sd[p]; g += sd[p + 1]; b += sd[p + 2]; n++; }
      }
      const q = (y * outW + x) * 4;
      out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
    }
  }
  return { width: outW, height: outH, data: out };
}

// Applique mapFace à une liste en conservant les liens entre faces.
function mapFaces(list, sx, sy, ox, oy) {
  const out = list.map((f) => mapFace(f, sx, sy, ox, oy));
  out.forEach((f, k) => { if (list[k].neighborOf) f.neighborOf = out[list.indexOf(list[k].neighborOf)]; });
  return out;
}

// Transforme les coordonnées d'une face (repère du zoom) vers le repère de
// l'image réduite.
function mapFace(f, sx, sy, ox, oy) {
  const m = ([x, y]) => [ox + x * sx, oy + y * sy];
  return {
    ...f,
    corners: f.corners.map(m),
    center: m(f.center),
    area: f.area * sx * sy,
    cells: f.cells.map((c) => { const [x, y] = m([c.x, c.y]); return { ...c, x, y }; }),
  };
}

// full : image pleine résolution. Renvoie les faces dans le repère de l'image
// réduite (côté max = base) et la taille de celle-ci.
// hint : zone du cube à l'image précédente (repère réduit). Avec trackOnly,
// on n'analyse que cette zone (rapide) ; si le cube n'y est plus, on repasse
// à l'image entière.
export function detectMultiScale(full, { base = 400, zoom = 420, hint = null, trackOnly = false, n = 3 } = {}) {
  const s = Math.min(1, base / Math.max(full.width, full.height));
  const W = Math.round(full.width * s), H = Math.round(full.height * s);
  if (trackOnly && hint) {
    const r = zoomPass(full, s, W, H, hint, zoom, 1.25, n);
    if (r && r.faces.length) return { faces: r.faces, width: W, height: H, roi: boxOf(r.faces), candidates: [] };
  }
  const small = s < 1 ? cropResize(full, 0, 0, full.width, full.height, W, H) : full;
  const first = detectFaces(small, { n });
  let faces = first.faces;
  // Zone d'intérêt : autour des faces trouvées, sinon celle de l'image précédente.
  let box = null;
  if (faces.length) {
    const xs = faces.flatMap((f) => f.corners.map((p) => p[0])), ys = faces.flatMap((f) => f.corners.map((p) => p[1]));
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  } else if (hint) {
    box = hint;
  }
  let roi = null;
  if (box) {
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    // Marge autour des faces vues (le reste du cube dépasse un peu).
    const side = Math.max(box[2] - box[0], box[3] - box[1]) * 1.6;
    const half = Math.max(side, Math.min(W, H) * 0.25) / 2;
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const x1 = Math.min(W, cx + half), y1 = Math.min(H, cy + half);
    // Zoom utile seulement si la zone est nettement plus petite que l'image.
    if ((x1 - x0) * (y1 - y0) < W * H * 0.6) {
      const k = 1 / s; // réduit -> pleine résolution
      const fw = (x1 - x0) * k, fh = (y1 - y0) * k;
      const zs = Math.min(1, zoom / Math.max(fw, fh));
      const zw = Math.round(fw * zs), zh = Math.round(fh * zs);
      if (zw > 40 && zh > 40) {
        const crop = cropResize(full, x0 * k, y0 * k, fw, fh, zw, zh);
        const second = detectFaces(crop, { n });
        const mapped = mapFaces(second.faces, (x1 - x0) / zw, (y1 - y0) / zh, x0, y0);
        roi = [x0, y0, x1, y1];
        // On garde la passe qui voit le plus de faces (à égalité : le zoom).
        if (mapped.length >= faces.length) faces = mapped;
      }
    }
  }
  return { faces, width: W, height: H, roi: faces.length ? boxOf(faces) : null, candidates: first.candidates };
}

function boxOf(faces) {
  const xs = faces.flatMap((f) => f.corners.map((p) => p[0])), ys = faces.flatMap((f) => f.corners.map((p) => p[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Analyse d'une zone (repère réduit) agrandie d'un facteur `grow`.
function zoomPass(full, s, W, H, box, zoom, grow, n = 3) {
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const half = Math.max(Math.max(box[2] - box[0], box[3] - box[1]) * grow, Math.min(W, H) * 0.25) / 2;
  const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
  const x1 = Math.min(W, cx + half), y1 = Math.min(H, cy + half);
  const k = 1 / s, fw = (x1 - x0) * k, fh = (y1 - y0) * k;
  const zs = Math.min(1, zoom / Math.max(fw, fh));
  const zw = Math.round(fw * zs), zh = Math.round(fh * zs);
  if (zw < 40 || zh < 40) return null;
  const crop = cropResize(full, x0 * k, y0 * k, fw, fh, zw, zh);
  const faces = mapFaces(detectFaces(crop, { n }).faces, (x1 - x0) / zw, (y1 - y0) / zh, x0, y0);
  return { faces };
}
