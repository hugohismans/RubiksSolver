// Détection des faces d'un Rubik's cube dans une image.
//
// Principe (ne dépend PAS des bords noirs) :
//  1. Image -> Lab, léger lissage, carte de gradient couleur.
//  2. Segmentation en régions homogènes, pour plusieurs seuils de gradient.
//  3. Chaque région « carrée » (vue en perspective) devient un candidat sticker.
//  4. Les candidats voisins (même taille, même orientation, à un pas de réseau)
//     sont reliés en graphe ; on leur attribue des coordonnées entières (i, j).
//  5. Une homographie (réseau -> image) est ajustée par face : elle tolère la
//     perspective, permet de retrouver les stickers manquants (logo, reflet,
//     centre rond) et rejette les quadrillages trop grands (carrelage, etc.).
//  6. Les 9 couleurs sont échantillonnées de façon robuste dans chaque case.

import { imageToLab, labToRgb, labDist } from './color.js';
import { convexHull, polygonArea, fitQuad, fitHomography, invert3, applyH, solveLinear } from './geometry.js';

const DEFAULTS = {
  thresholds: [3.5, 6, 10],
  minSide: 7, // côté minimal d'un sticker (px, dans l'image analysée)
  maxSideFrac: 0.3, // côté maximal relatif à la plus petite dimension
  minMembers: 5,
};

function boxBlur(src, W, H) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    tmp[o] = (src[o] * 2 + src[o + 1]) / 3;
    for (let x = 1; x < W - 1; x++) tmp[o + x] = (src[o + x - 1] + src[o + x] + src[o + x + 1]) / 3;
    tmp[o + W - 1] = (src[o + W - 1] * 2 + src[o + W - 2]) / 3;
  }
  for (let x = 0; x < W; x++) {
    out[x] = (tmp[x] * 2 + tmp[x + W]) / 3;
    for (let y = 1; y < H - 1; y++) out[y * W + x] = (tmp[(y - 1) * W + x] + tmp[y * W + x] + tmp[(y + 1) * W + x]) / 3;
    out[(H - 1) * W + x] = (tmp[(H - 1) * W + x] * 2 + tmp[(H - 2) * W + x]) / 3;
  }
  return out;
}

function gradient(L, A, B, W, H) {
  const G = new Float32Array(W * H);
  const wc = 1.4; // la chrominance pèse un peu plus que la luminance
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let s = 0;
      for (let c = 0; c < 3; c++) {
        const P = c === 0 ? L : c === 1 ? A : B;
        const gx = P[i - W + 1] + 2 * P[i + 1] + P[i + W + 1] - P[i - W - 1] - 2 * P[i - 1] - P[i + W - 1];
        const gy = P[i + W - 1] + 2 * P[i + W] + P[i + W + 1] - P[i - W - 1] - 2 * P[i - W] - P[i - W + 1];
        const w = c === 0 ? 1 : wc;
        s += w * w * (gx * gx + gy * gy);
      }
      G[i] = Math.sqrt(s) / 4;
    }
  }
  // Rainures sombres : sur un cube sans stickers, deux pièces de même couleur
  // ne sont séparées que par une fine ligne d'ombre. On la détecte comme un
  // « creux » de luminance (plus sombre que ses deux voisins à distance d).
  for (const d of [2, 3]) {
    const dirs = [d, d * W, d * (W + 1), d * (W - 1)];
    for (let y = d; y < H - d; y++) {
      for (let x = d; x < W - d; x++) {
        const i = y * W + x, l = L[i];
        let v = 0;
        for (const o of dirs) {
          const a = L[i - o], b = L[i + o];
          const m = Math.min(a, b) - l; // creux des deux côtés
          if (m > v) v = m;
        }
        const s = v * 1.6;
        if (s > G[i]) G[i] = s;
      }
    }
  }
  // Les bords de l'image sont des frontières.
  for (let x = 0; x < W; x++) { G[x] = 1e9; G[(H - 1) * W + x] = 1e9; }
  for (let y = 0; y < H; y++) { G[y * W] = 1e9; G[y * W + W - 1] = 1e9; }
  return G;
}

// Segmente les pixels de faible gradient en composantes connexes et
// renvoie les régions qui ressemblent à des stickers.
function extractCandidates(G, lab, W, H, T, cfg, out) {
  const N = W * H;
  const label = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const minArea = cfg.minSide * cfg.minSide;
  const maxSide = Math.min(W, H) * cfg.maxSideFrac;
  const maxArea = maxSide * maxSide * 1.3;
  // Une face entière unie (cube sans stickers) forme une seule grande région.
  const bigSide = Math.min(W, H) * 0.95;
  const pix = new Int32Array(N);
  let comp = 0;
  for (let s = 0; s < N; s++) {
    if (label[s] !== -1 || G[s] >= T) continue;
    // Flood fill
    let sp = 0, np = 0;
    stack[sp++] = s;
    label[s] = comp;
    while (sp > 0) {
      const p = stack[--sp];
      pix[np++] = p;
      const x = p % W;
      if (x > 0 && label[p - 1] === -1 && G[p - 1] < T) { label[p - 1] = comp; stack[sp++] = p - 1; }
      if (x < W - 1 && label[p + 1] === -1 && G[p + 1] < T) { label[p + 1] = comp; stack[sp++] = p + 1; }
      if (p >= W && label[p - W] === -1 && G[p - W] < T) { label[p - W] = comp; stack[sp++] = p - W; }
      if (p < N - W && label[p + W] === -1 && G[p + W] < T) { label[p + W] = comp; stack[sp++] = p + W; }
    }
    comp++;
    if (np < minArea || np > bigSide * bigSide) continue;
    const big = np > maxArea;
    // Statistiques de la région.
    let minx = W, maxx = 0, miny = H, maxy = 0, sx = 0, sy = 0;
    for (let k = 0; k < np; k++) {
      const p = pix[k], x = p % W, y = (p / W) | 0;
      sx += x; sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (bw < cfg.minSide * 0.6 || bh < cfg.minSide * 0.6) continue;
    if (!big && (bw > maxSide * 1.6 || bh > maxSide * 1.6)) continue;
    // Remplissage de la boîte englobante : élimine vite les formes filiformes.
    if (np / (bw * bh) < 0.35) continue;
    const rowMin = new Int32Array(bh).fill(W), rowMax = new Int32Array(bh).fill(-1);
    let sL = 0, sA = 0, sB = 0, sL2 = 0, sA2 = 0, sB2 = 0;
    for (let k = 0; k < np; k++) {
      const p = pix[k], x = p % W, r = ((p / W) | 0) - miny;
      if (x < rowMin[r]) rowMin[r] = x;
      if (x > rowMax[r]) rowMax[r] = x;
      const l = lab.L[p], a = lab.A[p], b = lab.B[p];
      sL += l; sA += a; sB += b;
      sL2 += l * l; sA2 += a * a; sB2 += b * b;
    }
    const pts = [];
    for (let r = 0; r < bh; r++) {
      if (rowMax[r] < 0) continue;
      pts.push([rowMin[r] - 0.5, miny + r - 0.5], [rowMax[r] + 0.5, miny + r - 0.5]);
      pts.push([rowMin[r] - 0.5, miny + r + 0.5], [rowMax[r] + 0.5, miny + r + 0.5]);
    }
    const hull = convexHull(pts);
    const hullArea = polygonArea(hull);
    const fill = np / hullArea;
    if (fill < 0.72) continue;
    const cx = sx / np + 0.0, cy = sy / np + 0.0;
    const quad = fitQuad(hull, cx, cy);
    if (!quad) continue;
    const quadArea = polygonArea(quad);
    const quadFit = quadArea / hullArea;
    if (quadFit < 0.78) continue;
    const [qa, qb, qc, qd] = quad;
    const u = [((qb[0] - qa[0]) + (qc[0] - qd[0])) / 2, ((qb[1] - qa[1]) + (qc[1] - qd[1])) / 2];
    const v = [((qd[0] - qa[0]) + (qc[0] - qb[0])) / 2, ((qd[1] - qa[1]) + (qc[1] - qb[1])) / 2];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 1 || lv < 1) continue;
    const aspect = lu / lv;
    if (aspect < 0.3 || aspect > 3.3) continue;
    // Angle entre les axes (un carré en perspective reste « raisonnable »).
    const cosang = Math.abs((u[0] * v[0] + u[1] * v[1]) / (lu * lv));
    if (cosang > 0.72) continue;
    // Angles intérieurs du quadrilatère.
    let okAngles = true;
    for (let k = 0; k < 4; k++) {
      const p0 = quad[(k + 3) % 4], p1 = quad[k], p2 = quad[(k + 1) % 4];
      const e1 = [p0[0] - p1[0], p0[1] - p1[1]], e2 = [p2[0] - p1[0], p2[1] - p1[1]];
      const c = (e1[0] * e2[0] + e1[1] * e2[1]) / (Math.hypot(...e1) * Math.hypot(...e2) + 1e-9);
      if (c > 0.75 || c < -0.75) { okAngles = false; break; }
    }
    if (!okAngles) continue;
    const mL = sL / np, mA = sA / np, mB = sB / np;
    const std = Math.sqrt(Math.max(0, sL2 / np - mL * mL) * 0.25 + Math.max(0, sA2 / np - mA * mA) + Math.max(0, sB2 / np - mB * mB));
    if (std > 18) continue;
    out.push({
      cx, cy, area: np, hullArea, quad, u, v, lab: [mL, mA, mB], std,
      quality: fill * quadFit, T, big,
    });
  }
}

function dedupe(cands) {
  // Une même région peut apparaître à plusieurs seuils : on garde la meilleure.
  cands.sort((a, b) => b.quality - a.quality);
  const kept = [];
  for (const c of cands) {
    const r = Math.sqrt(c.area) * 0.35;
    let dup = false;
    for (const k of kept) {
      if (Math.abs(k.cx - c.cx) < r && Math.abs(k.cy - c.cy) < r) {
        const ratio = k.area / c.area;
        if (ratio > 0.5 && ratio < 2) { dup = true; break; }
      }
    }
    if (!dup) kept.push(c);
  }
  return kept;
}

// Exprime d dans la base (u, v).
function inBasis(u, v, d) {
  const det = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(det) < 1e-9) return null;
  return [(d[0] * v[1] - d[1] * v[0]) / det, (u[0] * d[1] - u[1] * d[0]) / det];
}

function buildGraph(cands) {
  const n = cands.length;
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const ci = cands[i];
    const reach = Math.sqrt(ci.area) * 4.2;
    for (let j = i + 1; j < n; j++) {
      const cj = cands[j];
      const dx = cj.cx - ci.cx, dy = cj.cy - ci.cy;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const ratio = ci.area / cj.area;
      if (ratio < 0.4 || ratio > 2.5) continue;
      const ab = inBasis(ci.u, ci.v, [dx, dy]);
      const ba = inBasis(cj.u, cj.v, [-dx, -dy]);
      if (!ab || !ba) continue;
      const step = classifyStep(ab);
      const stepBack = classifyStep(ba);
      if (!step || !stepBack) continue;
      if (Math.abs(step[0]) + Math.abs(step[1]) !== Math.abs(stepBack[0]) + Math.abs(stepBack[1])) continue;
      // Les orientations des deux quadrilatères doivent être compatibles.
      if (!axesCompatible(ci, cj)) continue;
      const w = Math.abs(step[0]) + Math.abs(step[1]) === 1 ? 1 : 0.5;
      adj[i].push({ j, d: [dx, dy], w });
      adj[j].push({ j: i, d: [-dx, -dy], w });
    }
  }
  return adj;
}

// Décide si un déplacement (exprimé en tailles de sticker) correspond à un pas
// de réseau (1 ou 2 cases dans une direction, ou une diagonale).
function classifyStep([a, b]) {
  const A = Math.abs(a), B = Math.abs(b);
  const one = (t) => t > 0.92 && t < 1.8;
  const two = (t) => t > 1.95 && t < 3.5;
  const zero = (t, other) => t < 0.28 * Math.max(1, other);
  if (one(A) && zero(B, A)) return [Math.sign(a), 0];
  if (one(B) && zero(A, B)) return [0, Math.sign(b)];
  if (two(A) && zero(B, A)) return [2 * Math.sign(a), 0];
  if (two(B) && zero(A, B)) return [0, 2 * Math.sign(b)];
  if (one(A) && one(B) && Math.abs(A - B) < 0.35 * Math.max(A, B)) return [Math.sign(a), Math.sign(b)];
  return null;
}

function axesCompatible(ci, cj) {
  const dirs = [ci.u, ci.v];
  for (const w of [cj.u, cj.v]) {
    let best = 0;
    for (const d of dirs) {
      const c = Math.abs(d[0] * w[0] + d[1] * w[1]) / (Math.hypot(...d) * Math.hypot(...w));
      if (c > best) best = c;
    }
    if (best < 0.85) return false;
  }
  return true;
}

function latticeResiduals(H, members, cands) {
  const Hi = invert3(H);
  if (!Hi) return null;
  return members.map((m) => {
    const c = cands[m.idx];
    const [x, y] = applyH(Hi, c.cx, c.cy);
    return Math.hypot(x - m.i, y - m.j);
  });
}

// Transformation affine (moindres carrés) sous forme de matrice 3x3.
function fitAffine(src, dst) {
  const n = src.length;
  if (n < 3) return null;
  const AtA = Array.from({ length: 3 }, () => [0, 0, 0]);
  const bx = [0, 0, 0], by = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const r = [src[k][0], src[k][1], 1];
    for (let i = 0; i < 3; i++) {
      bx[i] += r[i] * dst[k][0];
      by[i] += r[i] * dst[k][1];
      for (let j = 0; j < 3; j++) AtA[i][j] += r[i] * r[j];
    }
  }
  const px = solveLinear(AtA, bx), py = solveLinear(AtA, by);
  if (!px || !py) return null;
  return [px[0], px[1], px[2], py[0], py[1], py[2], 0, 0, 1];
}

function fitLattice(members, cands, tol = 0.22) {
  let cur = members.slice();
  for (let iter = 0; iter < 8 && cur.length >= 3; iter++) {
    const src = cur.map((m) => [m.i, m.j]), dst = cur.map((m) => [cands[m.idx].cx, cands[m.idx].cy]);
    const H = cur.length >= 5 ? fitHomography(src, dst) : fitAffine(src, dst);
    if (!H) return null;
    const res = latticeResiduals(H, cur, cands);
    if (!res) return null;
    let worst = -1, wv = 0;
    res.forEach((r, k) => { if (r > wv) { wv = r; worst = k; } });
    if (wv < tol) return { H, members: cur, residual: res.reduce((s, r) => s + r, 0) / res.length };
    cur.splice(worst, 1);
  }
  return null;
}

// Graine + ses voisins directs (pas unitaires et diagonales) dans son repère.
function localStar(cands, adj, seed) {
  const c = cands[seed];
  const members = [{ idx: seed, i: 0, j: 0 }];
  const taken = new Set(['0,0']);
  for (const e of adj[seed]) {
    const ab = inBasis(c.u, c.v, e.d);
    const st = ab && classifyStep(ab);
    if (!st || Math.abs(st[0]) > 1 || Math.abs(st[1]) > 1) continue;
    const key = `${st[0]},${st[1]}`;
    if (taken.has(key)) continue;
    taken.add(key);
    members.push({ idx: e.j, i: st[0], j: st[1] });
  }
  return members;
}

// Fait croître un réseau à partir d'une étoile locale : on prédit chaque nœud
// voisin avec le modèle courant et on y rattache le candidat compatible.
function growLattice(cands, star) {
  if (star.length < 3) return null;
  const is0 = new Set(star.map((m) => m.i)), js0 = new Set(star.map((m) => m.j));
  if (is0.size < 2 || js0.size < 2) return null;
  let fit = fitLattice(star, cands, 0.3);
  if (!fit || fit.members.length < 3) return null;
  for (let iter = 0; iter < 6; iter++) {
    const Hi = invert3(fit.H);
    if (!Hi) return null;
    const fillRatio = median(fit.members.map((m) => cands[m.idx].area / cellArea(fit.H, m.i, m.j)));
    const shapes = fit.members.map((m) => cellShapeRatio(cands[m.idx], fit.H, m.i, m.j) || [1, 1]);
    const sideU = median(shapes.map((r) => r[0])), sideV = median(shapes.map((r) => r[1]));
    const mi = fit.members.map((m) => m.i), mj = fit.members.map((m) => m.j);
    const bi0 = Math.min(...mi) - 1, bi1 = Math.max(...mi) + 1, bj0 = Math.min(...mj) - 1, bj1 = Math.max(...mj) + 1;
    const tol = fit.members.length >= 5 ? 0.22 : 0.3;
    const byNode = new Map();
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k];
      const [x, y] = applyH(Hi, c.cx, c.cy);
      const i = Math.round(x), j = Math.round(y);
      if (i < bi0 || i > bi1 || j < bj0 || j > bj1) continue;
      const err = Math.hypot(x - i, y - j);
      if (err > tol) continue;
      const r = c.area / cellArea(fit.H, i, j) / fillRatio;
      if (!(r > 0.5 && r < 2)) continue;
      // Orientation et taille du quadrilatère cohérentes avec la case prédite.
      const sr = cellShapeRatio(c, fit.H, i, j);
      if (!sr || sr[0] / sideU < 0.75 || sr[0] / sideU > 1.33 || sr[1] / sideV < 0.75 || sr[1] / sideV > 1.33) continue;
      const key = `${i},${j}`;
      const prev = byNode.get(key);
      if (!prev || err < prev.err) byNode.set(key, { idx: k, i, j, err });
    }
    const members = [...byNode.values()];
    const same = members.length === fit.members.length && members.every((m) => fit.members.some((n) => n.idx === m.idx && n.i === m.i && n.j === m.j));
    if (same) break;
    const nf = fitLattice(members, cands, tol);
    if (!nf) break;
    fit = nf;
    // Réseau plus grand qu'un cube : c'est un quadrillage (carrelage, clavier…).
    const span = (a) => Math.max(...a) - Math.min(...a) + 1;
    if (span(fit.members.map((m) => m.i)) > 4 || span(fit.members.map((m) => m.j)) > 4) {
      return { members: fit.members, grid: true };
    }
  }
  return { members: fit.members, H: fit.H, grid: false };
}

// Vérifie que l'homographie est « saine » (pas de retournement, cellules
// de taille comparable, pas de dégénérescence).
function sane(H, W, Hh) {
  const pts = [];
  for (const [i, j] of [[-0.5, -0.5], [2.5, -0.5], [2.5, 2.5], [-0.5, 2.5]]) {
    const w = H[6] * i + H[7] * j + H[8];
    if (w <= 0) return false;
    pts.push(applyH(H, i, j));
  }
  // Convexité et orientation constante.
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a = pts[k], b = pts[(k + 1) % 4], c = pts[(k + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const s = Math.sign(cr);
    if (s === 0 || (sign !== 0 && s !== sign)) return false;
    sign = s;
  }
  // Rapport de longueur des côtés opposés (perspective modérée).
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const r1 = len(pts[0], pts[1]) / len(pts[3], pts[2]);
  const r2 = len(pts[0], pts[3]) / len(pts[1], pts[2]);
  if (r1 < 0.45 || r1 > 2.2 || r2 < 0.45 || r2 > 2.2) return false;
  const area = polygonArea(pts);
  if (area > W * Hh * 0.95) return false;
  return true;
}

function sampleLab(lab, W, H, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
  const i = yi * W + xi;
  return [lab.L[i], lab.A[i], lab.B[i]];
}

function robustColor(samples) {
  if (samples.length === 0) return { lab: [0, 0, 0], conf: 0 };
  // Reflet : la lumière spéculaire ajoute du blanc (L monte, chroma baisse).
  // Si une part notable de la case est franchement colorée, on lui fait
  // confiance plutôt qu'à la zone brillante.
  const chromatic = samples.filter((s) => Math.hypot(s[1], s[2]) > 28);
  if (chromatic.length >= samples.length * 0.3 && chromatic.length < samples.length * 0.75) {
    const r = robustColor(chromatic);
    return { lab: r.lab, conf: r.conf * (chromatic.length / samples.length) + 0.25 };
  }
  const med = [0, 1, 2].map((c) => {
    const v = samples.map((s) => s[c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const dist = (s) => Math.hypot((s[0] - med[0]) * 0.5, s[1] - med[1], s[2] - med[2]);
  const inl = samples.filter((s) => dist(s) < 12);
  const use = inl.length >= 3 ? inl : samples;
  const mean = [0, 1, 2].map((c) => use.reduce((t, s) => t + s[c], 0) / use.length);
  return { lab: mean, conf: inl.length / samples.length };
}

// Ordres de lecture possibles (8 symétries du carré) : (c, r) -> (i, j).
const DIHEDRAL = [
  (c, r) => [c, r], (c, r) => [2 - c, r], (c, r) => [c, 2 - r], (c, r) => [2 - c, 2 - r],
  (c, r) => [r, c], (c, r) => [2 - r, c], (c, r) => [r, 2 - c], (c, r) => [2 - r, 2 - c],
];

function orientFace(H) {
  let best = null;
  for (const T of DIHEDRAL) {
    const P = (c, r) => applyH(H, ...T(c, r));
    const a = P(0, 1), b = P(2, 1), c = P(1, 0), d = P(1, 2);
    const col = [b[0] - a[0], b[1] - a[1]], row = [d[0] - c[0], d[1] - c[1]];
    const score = col[0] / Math.hypot(...col) + row[1] / Math.hypot(...row);
    if (!best || score > best.score) best = { T, score, col, row };
  }
  best.roll = (Math.atan2(best.col[1], best.col[0]) * 180) / Math.PI;
  return best;
}

export function detectFaces(image, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const { width: W, height: Hh, data } = image;
  const raw = imageToLab(data, W * Hh);
  const lab = { L: boxBlur(raw.L, W, Hh), A: boxBlur(raw.A, W, Hh), B: boxBlur(raw.B, W, Hh) };
  const G = gradient(lab.L, lab.A, lab.B, W, Hh);

  let cands = [];
  for (const T of cfg.thresholds) extractCandidates(G, lab, W, Hh, T, cfg, cands);
  cands = dedupe(cands);
  // Grandes régions : hypothèses « face entière » ; petites : stickers.
  const blobs = cands.filter((c) => c.big || c.area > 900);
  cands = cands.filter((c) => !c.big);

  const adj = buildGraph(cands);
  const done = new Uint8Array(cands.length);
  // Graines : les candidats les plus connectés d'abord.
  const order = cands.map((_, i) => i).sort((a, b) => adj[b].length - adj[a].length);
  const faces = [];
  for (const seed of order) {
    if (done[seed] || adj[seed].length < 2) continue;
    const res = growLattice(cands, localStar(cands, adj, seed));
    if (!res) continue;
    const face = buildFace(res, cands, lab, W, Hh, cfg);
    if (face) faces.push(face);
    if (face || res.grid) for (const m of res.members) done[m.idx] = 1;
  }
  // Faces unies (cube sans stickers) : une grande région en forme de
  // quadrilatère, validée par les creux sombres aux jonctions des pièces.
  for (const b of blobs) {
    if (faces.some((f) => pointInQuad(f.corners, b.cx, b.cy))) continue;
    const face = solidFace(b, lab, G, W, Hh, cands);
    if (face) faces.push(face);
  }
  faces.sort((a, b) => b.score - a.score);
  return { faces, candidates: cands, width: W, height: Hh };
}

function buildFace(res, cands, lab, W, Hh, cfg) {
  if (res.grid) return null;
  const members = res.members;
  let fit;
  // Choix de la fenêtre 3x3.
  const is = members.map((m) => m.i), js = members.map((m) => m.j);
  const i0 = Math.min(...is), i1 = Math.max(...is), j0 = Math.min(...js), j1 = Math.max(...js);
  if (i1 - i0 < 2 || j1 - j0 < 2) return null; // pas assez étendu pour fixer la fenêtre
  let best = null;
  for (let a = i0; a <= i1 - 2; a++) {
    for (let b = j0; b <= j1 - 2; b++) {
      const inside = members.filter((m) => m.i >= a && m.i <= a + 2 && m.j >= b && m.j <= b + 2);
      if (!best || inside.length > best.inside.length) best = { a, b, inside };
    }
  }
  const outside = members.length - best.inside.length;
  // Quelques intrus alignés par hasard sont tolérés ; au-delà, c'est un quadrillage.
  if (outside >= 4) return null;
  const inside = best.inside.map((m) => ({ idx: m.idx, i: m.i - best.a, j: m.j - best.b }));
  if (inside.length < cfg.minMembers) return null;
  const rows = new Set(inside.map((m) => m.j)), cols = new Set(inside.map((m) => m.i));
  if (rows.size < 3 || cols.size < 3) return null;
  fit = fitLattice(inside, cands);
  if (!fit || fit.members.length < cfg.minMembers) return null;
  return finishFace(fit.H, lab, W, Hh, {
    allCands: cands,
    members: fit.members.length, residual: fit.residual, memberCands: fit.members.map((m) => cands[m.idx]),
  });
}

// À partir de l'homographie réseau -> image : échantillonne les 9 cases,
// rejette les motifs répétitifs et calcule un score.
function finishFace(H, lab, W, Hh, info) {
  if (!sane(H, W, Hh)) return null;
  // La face doit être entièrement visible.
  for (const [i, j] of [[-0.5, -0.5], [2.5, -0.5], [2.5, 2.5], [-0.5, 2.5]]) {
    const [x, y] = applyH(H, i, j);
    if (x < -0.03 * W || x > 1.03 * W || y < -0.03 * Hh || y > 1.03 * Hh) return null;
  }
  const Hinv = invert3(H);
  // Un « jumeau » : une région de même forme et taille, alignée sur le réseau.
  const hasTwin = (oi, oj) => info.allCands.some((c) => {
    const [x, y] = applyH(Hinv, c.cx, c.cy);
    if (Math.hypot(x - oi, y - oj) > 0.25) return false;
    const ar = c.area / cellArea(H, oi, oj);
    if (ar < 0.35 || ar > 1.3) return false;
    const sr = cellShapeRatio(c, H, oi, oj);
    return sr && sr[0] > 0.55 && sr[0] < 1.2 && sr[1] > 0.55 && sr[1] < 1.2;
  });
  const orient = orientFace(H);
  const fit = { members: { length: info.members }, residual: info.residual };

  // Échantillonnage des 9 cases.
  const cellColor = (i, j, ring) => {
    const samples = [];
    for (let sy = -3; sy <= 3; sy++) {
      for (let sx = -3; sx <= 3; sx++) {
        const ox = sx * 0.1, oy = sy * 0.1;
        // Centre : on évite le milieu (logo, capuchon) et on lit l'anneau.
        if (ring && Math.max(Math.abs(ox), Math.abs(oy)) < 0.17) continue;
        const [x, y] = applyH(H, i + ox, j + oy);
        const s = sampleLab(lab, W, Hh, x, y);
        if (s) samples.push(s);
      }
    }
    return samples.length >= 10 ? robustColor(samples) : null;
  };
  const grid = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) grid.push(cellColor(i, j, i === 1 && j === 1));
  if (grid.some((g) => !g)) return null;
  // Motif répétitif (carrelage, tissu…) : les cases extérieures voisines
  // ressemblent aux cases du bord. Sur un vrai cube, elles appartiennent à une
  // autre face ou au décor.
  let ringTot = 0, ringSame = 0, ringTwins = 0;
  for (let k = 0; k < 3; k++) {
    for (const [oi, oj, ii, jj] of [[k, -1, k, 0], [k, 3, k, 2], [-1, k, 0, k], [3, k, 2, k]]) {
      const out = cellColor(oi, oj, false);
      if (!out || out.conf < 0.6) continue;
      ringTot++;
      if (labDist(out.lab, grid[jj * 3 + ii].lab) < 10) {
        ringSame++;
        if (hasTwin(oi, oj)) ringTwins++;
      }
    }
  }
  if (ringTwins >= 3 || (ringTwins >= 1 && ringTot >= 6 && ringSame >= Math.max(6, ringTot * 0.6))) return null;
  // Face unie : il faut en plus que l'extérieur soit différent (sinon c'est
  // probablement un morceau de sol ou de mur).
  if (info.solid && ringTot >= 4 && ringSame >= ringTot * 0.5) return null;
  let spread = 0;
  for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) spread = Math.max(spread, labDist(grid[a].lab, grid[b].lab));
  if (spread < 12 && ringTot >= 6 && ringSame >= Math.max(6, ringTot * 0.6)) return null;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const [i, j] = orient.T(c, r);
      const col = grid[j * 3 + i];
      const center = applyH(H, i, j);
      cells.push({ lab: col.lab, rgb: labToRgb(...col.lab), conf: col.conf, x: center[0], y: center[1] });
    }
  }
  // Coins en ordre de lecture : haut-gauche, haut-droite, bas-droite, bas-gauche.
  const corners = [[-0.5, -0.5], [2.5, -0.5], [2.5, 2.5], [-0.5, 2.5]].map(([c, r]) => applyH(H, ...orient.T(c, r)));
  const area = polygonArea(corners);
  const cx = corners.reduce((s, p) => s + p[0], 0) / 4, cy = corners.reduce((s, p) => s + p[1], 0) / 4;
  const centrality = 1 - Math.hypot((cx - W / 2) / W, (cy - Hh / 2) / Hh);
  const meanConf = cells.reduce((s, c) => s + c.conf, 0) / 9;
  // Une face vue de face est un carré : on préfère la face la moins inclinée.
  const sides = corners.map((p, k) => Math.hypot(p[0] - corners[(k + 1) % 4][0], p[1] - corners[(k + 1) % 4][1]));
  const squareness = Math.min(...sides) / Math.max(...sides);
  // Face uniforme et grise : suspecte (carrelage, mur…), on la pénalise.
  let maxPair = 0;
  for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) maxPair = Math.max(maxPair, labDist(cells[a].lab, cells[b].lab));
  const uniform = maxPair < 12;
  const gray = uniform && Math.hypot(cells[4].lab[1], cells[4].lab[2]) < 12;
  const score = 3 * (fit.members.length / 9) + 2 * meanConf + 2 * centrality + 6 * Math.sqrt(area / (W * Hh)) +
    4 * squareness - 5 * fit.residual - (gray ? 4 : 0);
  return {
    H, cells, corners, area, roll: orient.roll, center: [cx, cy], squareness, uniform,
    members: info.members, residual: info.residual, score, memberCands: info.memberCands, solid: !!info.solid,
  };
}

// Compare les axes du quadrilatère d'un candidat à ceux de la case (i, j)
// prédite par H. Renvoie le rapport de taille moyen, ou null si les
// directions ne concordent pas.
function pointInQuad(q, x, y) {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    const cr = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
    if (cr === 0) continue;
    if (sign && cr !== sign) return false;
    sign = cr;
  }
  return true;
}

// Hypothèse « face entière unie » : la région est la face, subdivisée en 3x3.
// Validation : aux 4 jonctions intérieures, les coins arrondis des pièces
// laissent un petit creux sombre (ou une ligne d'ombre) que l'on mesure.
function solidFace(b, lab, G, W, Hh, cands) {
  // Les coins du quadrilatère sont un peu à l'intérieur de la face réelle
  // (bande de gradient exclue) : on les associe à ±0.45 plutôt que ±0.5.
  const src = [[-0.45, -0.45], [2.45, -0.45], [2.45, 2.45], [-0.45, 2.45]];
  // Ordre des coins : b.quad suit l'enveloppe (sens constant).
  const H = fitHomography(src, b.quad);
  if (!H) return null;
  const Lat = (i, j) => {
    const [x, y] = applyH(H, i, j);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= Hh) return null;
    return lab.L[yi * W + xi];
  };
  const cellL = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    for (const [dx, dy] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, 0]]) {
      const v = Lat(i + dx, j + dy);
      if (v !== null) cellL.push(v);
    }
  }
  if (cellL.length < 30) return null;
  const ref = median(cellL);
  // Jonctions : minimum de L dans un petit voisinage (le trou est petit).
  let dark = 0;
  for (const [i, j] of [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]]) {
    let mn = Infinity;
    for (let dy = -0.08; dy <= 0.081; dy += 0.04) for (let dx = -0.08; dx <= 0.081; dx += 0.04) {
      const v = Lat(i + dx, j + dy);
      if (v !== null && v < mn) mn = v;
    }
    if (ref - mn > 6) dark++;
  }
  // Rainures : milieu des lignes intérieures, plus sombres que les cases.
  let grooves = 0;
  for (const [i, j, horiz] of [[0, 0.5, 1], [1, 0.5, 1], [2, 0.5, 1], [0, 1.5, 1], [1, 1.5, 1], [2, 1.5, 1],
    [0.5, 0, 0], [0.5, 1, 0], [0.5, 2, 0], [1.5, 0, 0], [1.5, 1, 0], [1.5, 2, 0]]) {
    let mn = Infinity;
    for (let d = -0.06; d <= 0.061; d += 0.03) {
      const v = horiz ? Lat(i, j + d) : Lat(i + d, j);
      if (v !== null && v < mn) mn = v;
    }
    if (ref - mn > 4) grooves++;
  }
  if (dark < 3 && grooves < 8) return null;
  if (dark < 2) return null;
  return finishFace(H, lab, W, Hh, { members: 0, residual: 0.05, memberCands: [b], solid: true, allCands: cands });
}

function cellShapeRatio(c, H, i, j) {
  const p0 = applyH(H, i - 0.5, j), p1 = applyH(H, i + 0.5, j);
  const q0 = applyH(H, i, j - 0.5), q1 = applyH(H, i, j + 0.5);
  const du = [p1[0] - p0[0], p1[1] - p0[1]], dv = [q1[0] - q0[0], q1[1] - q0[1]];
  const ldu = Math.hypot(...du), ldv = Math.hypot(...dv);
  const out = [0, 0];
  for (const w of [c.u, c.v]) {
    const lw = Math.hypot(...w);
    const cu = Math.abs(w[0] * du[0] + w[1] * du[1]) / (lw * ldu);
    const cv = Math.abs(w[0] * dv[0] + w[1] * dv[1]) / (lw * ldv);
    if (Math.max(cu, cv) < 0.94) return null;
    if (cu > cv) out[0] = lw / ldu; else out[1] = lw / ldv;
  }
  // Les deux axes doivent correspondre à deux directions différentes.
  if (!out[0] || !out[1]) return null;
  return out;
}

function cellArea(H, i, j) {
  return polygonArea([[i - 0.5, j - 0.5], [i + 0.5, j - 0.5], [i + 0.5, j + 0.5], [i - 0.5, j + 0.5]].map(([x, y]) => applyH(H, x, y)));
}

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}
