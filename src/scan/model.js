// Reconstruction 3D libre du cube : on tourne le cube devant la caméra, et
// chaque image enrichit un modèle des 6 faces.
//
// 1. Vue locale : les faces détectées qui partagent une arête sont « repliées »
//    en 3D (si deux faces se touchent par une arête à l'image, leur position
//    relative sur le cube est entièrement déterminée).
// 2. Recalage : la vue locale est confrontée au modèle sous les 24 rotations
//    possibles d'un cube ; couleurs des centres et stickers déjà vus
//    désignent la bonne.
// 3. Accumulation : chaque case reçoit des mesures pondérées (une face vue de
//    face compte plus qu'une face très inclinée).
//
// Repère « corps » : x droite, y haut, z vers l'avant, cube centré, cases
// à ±1.5. Une face = normale n + axes de lecture ex (colonnes) et ey (lignes,
// vers le bas de la face vue de l'extérieur), avec ex × ey = -n.

import { adjacentFaces } from './orientation.js';
import { labDist, labToRgb, chroma, hueDeg } from '../vision/color.js';
import { FACES, FACELET_GEOMETRY } from '../cube/cube.js';
import { assignColors } from '../cube/colors.js';

// --- petits outils vectoriels (vecteurs entiers 3D) ------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => [-a[0], -a[1], -a[2]];
const round = (a) => a.map((x) => Math.round(x) + 0);
const key = (v) => round(v).join(',');
const apply = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
const transpose = (M) => [0, 1, 2].map((i) => [M[0][i], M[1][i], M[2][i]]);

// Les 24 rotations du cube (matrices de permutation signées, déterminant +1).
export const ROTATIONS = (() => {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const M = [0, 1, 2].map((i) => { const r = [0, 0, 0]; r[p[i]] = s & (1 << i) ? -1 : 1; return r; });
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (det === 1) out.push(M);
  }
  return out;
})();
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Coins d'une face en ordre de lecture (HG, HD, BD, BG).
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const cornerOf = (f, k) => add(mul(f.n, 1.5), add(mul(f.ex, 1.5 * CORNER_SIGNS[k][0]), mul(f.ey, 1.5 * CORNER_SIGNS[k][1])));
// Direction vers le côté p (0 haut, 1 droite, 2 bas, 3 gauche).
const sideDir = (f, p) => [neg(f.ey), f.ex, f.ey, neg(f.ex)][p];

// Place la face Y, voisine de X : côté p de X, côté q de Y. Les deux faces
// parcourent l'arête commune en sens opposés (toutes deux vues de l'extérieur).
export function fold(X, p, q) {
  const n = sideDir(X, p);
  const c = mul(n, 1.5);
  const d1 = mul(sub(cornerOf(X, (p + 1) % 4), c), 1 / 1.5);
  const d2 = mul(sub(cornerOf(X, p), c), 1 / 1.5);
  const [sx1, sy1] = CORNER_SIGNS[q], [sx2, sy2] = CORNER_SIGNS[(q + 1) % 4];
  const det = sx1 * sy2 - sy1 * sx2;
  if (!det) return null;
  const ex = round(mul(sub(mul(d1, sy2), mul(d2, sy1)), 1 / det));
  const ey = round(mul(sub(mul(d2, sx1), mul(d1, sx2)), 1 / det));
  if (dot(ex, ex) !== 1 || dot(ey, ey) !== 1 || dot(ex, ey) !== 0) return null;
  if (key(cross(ex, ey)) !== key(neg(n))) return null;
  return { n, ex, ey };
}

// Index (0..8) de la case d'une face qui contient le point 3D p (sur la face).
function cellIndex(f, p) {
  const d = sub(p, mul(f.n, 1.5));
  const i = Math.round(dot(d, f.ex)) + 1, j = Math.round(dot(d, f.ey)) + 1;
  if (i < 0 || i > 2 || j < 0 || j > 2) return -1;
  return j * 3 + i;
}
const cellPoint = (f, k) => add(mul(f.n, 1.5), add(mul(f.ex, (k % 3) - 1), mul(f.ey, Math.floor(k / 3) - 1)));

// Couleur grossière d'un centre (même logique que le mode guidé).
export function roughColor(lab) {
  const c = chroma(lab), h = hueDeg(lab);
  if (c < 22 || (c < 32 && lab[0] > 78)) return 'W';
  if (h < 38 || h >= 330) return 'R';
  if (h < 75) return 'O';
  if (h < 105) return 'Y';
  if (h < 200) return 'G';
  return 'B';
}

function weightedMedian(samples, c) {
  const s = samples.map((x) => [x.lab[c], x.w]).sort((a, b) => a[0] - b[0]);
  const tot = s.reduce((t, x) => t + x[1], 0);
  let acc = 0;
  for (const [v, w] of s) { acc += w; if (acc >= tot / 2) return v; }
  return s[s.length - 1][0];
}

const MIN_SQUARENESS = 0.32; // face trop inclinée : on n'enregistre pas ses cases

export class CubeModel {
  constructor() {
    this.faces = new Map(); // clé de la normale -> { n, ex, ey, cells: [[samples]], centerLab }
    this.lastQ = null; // rotation locale -> corps de la dernière image recalée
    this.frames = 0;
    this.misses = 0; // images consécutives non recalées
  }

  // Couleur identifiant une face (centre) : centre connu le plus proche,
  // sinon estimation par la teinte.
  centerColor(lab) {
    let best = null;
    for (const f of this.faces.values()) {
      const d = labDist(lab, f.centerLab);
      if (!best || d < best.d) best = { f, d };
    }
    if (best && best.d < 14) return { key: key(best.f.n), color: best.f.color };
    return { key: null, color: roughColor(lab) };
  }

  // Construit la vue locale à partir des faces détectées dans une image.
  localView(detected) {
    if (!detected.length) return [];
    const usable = detected.filter((f) => f.members >= 5 || f.solid);
    if (!usable.length) return [];
    const anchor = usable.slice().sort((a, b) => b.squareness * b.area - a.squareness * a.area)[0];
    const placed = new Map([[anchor, { n: [0, 0, 1], ex: [1, 0, 0], ey: [0, -1, 0] }]]);
    const queue = [anchor];
    while (queue.length) {
      const X = queue.shift();
      for (const { face: Y, side: p } of adjacentFaces(X, usable)) {
        if (placed.has(Y)) continue;
        const back = adjacentFaces(Y, [X]);
        if (!back.length) continue;
        const g = fold(placed.get(X), p, back[0].side);
        if (!g) continue;
        if ([...placed.values()].some((h) => key(h.n) === key(g.n))) continue;
        placed.set(Y, g);
        queue.push(Y);
      }
    }
    return [...placed.entries()].map(([det, g]) => ({ ...g, det, labs: det.cells.map((c) => c.lab), weight: det.squareness }));
  }

  // Score d'une rotation Q (local -> corps), plus petit = meilleur ; null si
  // impossible. Il combine l'écart des stickers déjà connus et l'écart des
  // centres (une face ne peut pas changer de couleur).
  registrationCost(local, Q) {
    let cost = 0, matched = 0, compared = 0, centerPen = 0;
    for (const L of local) {
      const nb = apply(Q, L.n);
      const M = this.faces.get(key(nb));
      if (M) {
        const dc = labDist(L.labs[4], M.centerLab);
        if (dc > 40) return null;
        centerPen += Math.max(0, dc - 10);
        matched++;
        const exb = apply(Q, L.ex), eyb = apply(Q, L.ey);
        for (let k = 0; k < 9; k++) {
          if (k === 4) continue;
          const p = add(mul(nb, 1.5), add(mul(exb, (k % 3) - 1), mul(eyb, Math.floor(k / 3) - 1)));
          const est = this.cellEstimate(M, cellIndex(M, p));
          if (!est) continue;
          cost += Math.min(60, labDist(L.labs[k], est.lab));
          compared++;
        }
      } else {
        // Nouvelle face : son centre ne doit ressembler à aucun centre connu.
        for (const f of this.faces.values()) if (labDist(L.labs[4], f.centerLab) < 12) return null;
      }
    }
    if (!matched) return null;
    const stick = compared ? cost / compared : 12;
    return { cost: stick, score: stick + centerPen, matched, compared };
  }

  cellEstimate(face, k) {
    const s = face.cells[k];
    if (!s || !s.length) return null;
    const lab = [0, 1, 2].map((c) => weightedMedian(s, c));
    const w = s.reduce((t, x) => t + x.w, 0);
    return { lab, w, n: s.length };
  }

  // Les rotations Q1 et Q2 donnent-elles le même modèle (motif symétrique) ?
  equivalent(local, Q1, Q2) {
    for (const L of local) {
      const n1 = apply(Q1, L.n), n2 = apply(Q2, L.n);
      if (key(n1) !== key(n2)) return false; // une face irait ailleurs
      const M = this.faces.get(key(n1));
      if (!M) continue;
      const e1 = [apply(Q1, L.ex), apply(Q1, L.ey)], e2 = [apply(Q2, L.ex), apply(Q2, L.ey)];
      for (let k = 0; k < 9; k++) {
        const off = [(k % 3) - 1, Math.floor(k / 3) - 1];
        const p1 = add(mul(n1, 1.5), add(mul(e1[0], off[0]), mul(e1[1], off[1])));
        const p2 = add(mul(n2, 1.5), add(mul(e2[0], off[0]), mul(e2[1], off[1])));
        const a = this.cellEstimate(M, cellIndex(M, p1)), b = this.cellEstimate(M, cellIndex(M, p2));
        if (a && b && labDist(a.lab, b.lab) > 15) return false;
      }
    }
    return true;
  }

  // Intègre une image. Renvoie l'état du recalage pour l'interface.
  update(detected) {
    this.frames++;
    const local = this.localView(detected);
    if (!local.length) return { status: 'none', local };
    let Q = null;
    // Au début, on attend de voir deux faces voisines : une seule face ne
    // fixe pas l'orientation du cube.
    if (this.faces.size === 0) {
      if (local.length < 2) return { status: 'need2', local };
      Q = IDENTITY;
    } else {
      const scored = [];
      for (const R of ROTATIONS) {
        const r = this.registrationCost(local, R);
        if (r) scored.push({ R, ...r });
      }
      if (this.debug) {
        console.log('  local:', local.map((L) => `${roughColor(L.labs[4])}(${L.labs[4].map((x) => x.toFixed(0))}) n=${L.n} sq=${L.weight.toFixed(2)}`).join(' | '));
        console.log('  modèle:', [...this.faces.values()].map((f) => `${f.color}@${f.n}(${f.centerLab.map((x) => x.toFixed(0))})`).join(' '));
        console.log('  meilleurs:', scored.slice().sort((a, b) => a.score - b.score).slice(0, 3).map((x) => `m=${x.matched} s=${x.score.toFixed(1)} c=${x.cost.toFixed(1)} n=${x.compared}`).join(' ; '));
      }
      if (!scored.length) return this.miss('lost', local);
      scored.sort((a, b) => a.score - b.score);
      const best = scored[0];
      // Ambiguïté : une autre rotation aussi bonne et réellement différente.
      const rival = scored.find((s) => s !== best && s.score < best.score + 10 && !this.equivalent(local, best.R, s.R));
      if (rival) return this.miss('ambiguous', local);
      if (best.compared >= 4 && best.cost > 28) return this.miss('lost', local);
      Q = best.R;
    }
    this.lastQ = Q;
    this.misses = 0;
    // Enregistrement des mesures.
    for (const L of local) {
      const nb = apply(Q, L.n);
      let M = this.faces.get(key(nb));
      if (!M) {
        M = { n: nb, ex: apply(Q, L.ex), ey: apply(Q, L.ey), cells: Array.from({ length: 9 }, () => []), centerLab: L.labs[4] };
        M.color = roughColor(L.labs[4]);
        this.faces.set(key(nb), M);
      }
      if (L.weight < MIN_SQUARENESS) continue;
      const exb = apply(Q, L.ex), eyb = apply(Q, L.ey);
      const w = L.weight * L.weight;
      for (let k = 0; k < 9; k++) {
        const p = add(mul(nb, 1.5), add(mul(exb, (k % 3) - 1), mul(eyb, Math.floor(k / 3) - 1)));
        const idx = cellIndex(M, p);
        const arr = M.cells[idx];
        arr.push({ lab: L.labs[k], w });
        if (arr.length > 24) arr.shift();
      }
      const c = this.cellEstimate(M, 4);
      if (c) { M.centerLab = c.lab; M.color = roughColor(c.lab); }
    }
    return { status: 'ok', local, Q };
  }

  // Trop d'images impossibles à recaler alors que le modèle est encore
  // pauvre : le départ était sans doute mauvais, on recommence.
  miss(status, local) {
    this.misses++;
    if (this.misses > 12 && this.progress().known < 18) {
      this.faces.clear();
      this.lastQ = null;
      this.misses = 0;
      return { status: 'reset', local };
    }
    return { status, local };
  }

  // Une case est connue quand elle a assez de mesures concordantes.
  cellKnown(face, k) {
    const e = this.cellEstimate(face, k);
    return !!e && e.n >= 3 && e.w >= 0.8;
  }

  progress() {
    let known = 0;
    for (const f of this.faces.values()) for (let k = 0; k < 9; k++) if (this.cellKnown(f, k)) known++;
    return { known, total: 54, faces: this.faces.size };
  }

  isComplete() {
    return this.faces.size === 6 && this.progress().known === 54;
  }

  // Couleurs d'affichage par facette du rendu 3D (repère corps = repère du
  // rendu) : gris pour l'inconnu.
  displayColors(unknown = '#3a3d46') {
    return FACELET_GEOMETRY.map((g) => {
      const f = this.faces.get(key(g.normal));
      if (!f) return unknown;
      const k = cellIndex(f, add(g.pos, mul(g.normal, 0.5)));
      const e = this.cellEstimate(f, k);
      if (!e) return unknown;
      let rgb = labToRgb(...e.lab);
      // Case pas encore sûre : couleur atténuée.
      if (!this.cellKnown(f, k)) rgb = rgb.map((v) => Math.round(v * 0.45 + 58 * 0.55));
      return `rgb(${rgb.join(',')})`;
    });
  }

  // Face à montrer en priorité, et sa direction dans la vue actuelle.
  nextTarget() {
    const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    let best = null;
    for (const d of dirs) {
      const f = this.faces.get(key(d));
      const missing = f ? 9 - [...Array(9).keys()].filter((k) => this.cellKnown(f, k)).length : 10;
      if (missing && (!best || missing > best.missing)) best = { n: d, missing };
    }
    if (!best) return null;
    const local = this.lastQ ? apply(transpose(this.lastQ), best.n) : null;
    return { ...best, local, face: this.faces.get(key(best.n)) || null };
  }

  // Chaîne de 54 mesures dans la convention du solveur : U = face blanche,
  // F = face verte si elle est voisine du blanc (sinon une voisine).
  toSolverLabs() {
    const faces = [...this.faces.values()];
    const whiteness = (f) => chroma(f.centerLab) - f.centerLab[0] * 0.3;
    const U = faces.slice().sort((a, b) => whiteness(a) - whiteness(b))[0];
    const neighbors = faces.filter((f) => dot(f.n, U.n) === 0);
    const F = neighbors.find((f) => f.color === 'G') || neighbors[0];
    const nR = cross(U.n, F.n);
    const labs = new Array(54);
    FACELET_GEOMETRY.forEach((g, i) => {
      const toBody = (v) => add(add(mul(nR, v[0]), mul(U.n, v[1])), mul(F.n, v[2]));
      const n = toBody(g.normal), p = add(toBody(g.pos), mul(n, 0.5));
      const f = this.faces.get(key(n));
      labs[i] = this.cellEstimate(f, cellIndex(f, p)).lab;
    });
    // Couleur (W/Y/R/O/B/G) de chaque face du solveur, pour l'affichage.
    const slotFace = {};
    FACES.forEach((s, i) => { slotFace[s] = labs[i * 9 + 4]; });
    return { labs, slotLabs: slotFace };
  }

  solve() {
    const { labs } = this.toSolverLabs();
    const res = assignColors(labs);
    return { ...res, labs };
  }
}

export { key as vecKey, apply as applyRot, transpose as transposeRot };
