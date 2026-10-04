// Petite boîte à outils géométrique : enveloppe convexe, quadrilatère,
// homographie (DLT) et résolution de systèmes linéaires.

export function convexHull(pts) {
  // Monotone chain. pts: tableau de [x, y].
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function lineDist(a, b, p) {
  // Distance signée de p à la droite (a,b).
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.hypot(dx, dy) || 1;
  return ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / n;
}

// Approxime l'enveloppe par le quadrilatère inscrit (heuristique itérative).
export function fitQuad(hull, cx, cy) {
  const m = hull.length;
  if (m < 4) return null;
  let ia = 0, best = -1;
  for (let i = 0; i < m; i++) {
    const d = (hull[i][0] - cx) ** 2 + (hull[i][1] - cy) ** 2;
    if (d > best) { best = d; ia = i; }
  }
  let ic = 0; best = -1;
  for (let i = 0; i < m; i++) {
    const d = (hull[i][0] - hull[ia][0]) ** 2 + (hull[i][1] - hull[ia][1]) ** 2;
    if (d > best) { best = d; ic = i; }
  }
  let ib = -1, id = -1;
  for (let iter = 0; iter < 3; iter++) {
    let bmax = 0, dmin = 0;
    ib = -1; id = -1;
    for (let i = 0; i < m; i++) {
      const s = lineDist(hull[ia], hull[ic], hull[i]);
      if (s > bmax) { bmax = s; ib = i; }
      if (s < dmin) { dmin = s; id = i; }
    }
    if (ib < 0 || id < 0) return null;
    // Raffine A et C par rapport à la diagonale BD.
    let amax = 0, cmin = 0, na = ia, nc = ic;
    const sideA = Math.sign(lineDist(hull[ib], hull[id], hull[ia]));
    for (let i = 0; i < m; i++) {
      const s = lineDist(hull[ib], hull[id], hull[i]) * sideA;
      if (s > amax) { amax = s; na = i; }
      if (s < cmin) { cmin = s; nc = i; }
    }
    if (na === ia && nc === ic) break;
    ia = na; ic = nc;
  }
  // Ordonne A, B, C, D dans le sens du parcours de l'enveloppe.
  const idx = [ia, ib, ic, id].sort((x, y) => x - y);
  return idx.map((i) => hull[i]);
}

// Résout A x = b (Gauss avec pivot partiel). A: tableau de lignes.
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      if (k === 0) continue;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Homographie src -> dst par moindres carrés (h33 = 1), avec normalisation.
export function fitHomography(src, dst) {
  const n = src.length;
  if (n < 4) return null;
  const norm = (pts) => {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    let s = 0;
    for (const p of pts) s += Math.hypot(p[0] - mx, p[1] - my);
    s = s / pts.length || 1;
    const k = Math.SQRT2 / s;
    return { T: [k, 0, -k * mx, 0, k, -k * my, 0, 0, 1], pts: pts.map((p) => [(p[0] - mx) * k, (p[1] - my) * k]) };
  };
  const ns = norm(src), nd = norm(dst);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const addRow = (row, v) => {
    for (let i = 0; i < 8; i++) {
      if (row[i] === 0) continue;
      Atb[i] += row[i] * v;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < n; k++) {
    const [x, y] = ns.pts[k];
    const [u, v] = nd.pts[k];
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  // H = Td^-1 * Hn * Ts
  const Tdi = invert3(nd.T);
  return mul3(Tdi, mul3(Hn, ns.T));
}

export function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}
