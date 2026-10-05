// Attribution des couleurs pour les cubes sans centre fixe (2x2, 4x4).
//
// Sans centre, on ne sait pas d'avance quelle couleur va sur quelle face :
//  1. regroupement équilibré des cases en 6 couleurs (N² cases chacune) ;
//  2. on cherche ensuite l'étiquetage couleur -> face (URFDLB) qui forme un
//     vrai cube : coins existants (affectation optimale avec orientation),
//     ailes (4x4), centres (4x4) — tout cela au coût minimal ;
//  3. torsion impossible des coins corrigée au moindre coût.

import { puzzle, FACES } from './nxn.js';
import { hungarian } from './colors.js';
import { labDist, chroma, hueDeg } from '../vision/color.js';

const NAMES = ['W', 'Y', 'R', 'O', 'B', 'G'];
const HUE = { R: 25, O: 55, Y: 92, G: 140, B: 265 };

// Ressemblance d'une couleur mesurée avec une couleur nominale.
function nameCost(lab, name) {
  const c = chroma(lab), h = hueDeg(lab);
  if (name === 'W') return c < 30 ? c : 60 + c;
  if (c < 18) return 80;
  const d = Math.abs(h - HUE[name]);
  return Math.min(d, 360 - d) + (name === 'Y' && lab[0] < 50 ? 30 : 0);
}

const median3 = (list) => [0, 1, 2].map((c) => {
  const v = list.map((m) => m[c]).sort((a, b) => a - b);
  return v[v.length >> 1];
});

// Regroupement en 6 couleurs de N² cases chacune.
function balancedClusters(labs, n2) {
  // Départ : prototypes par teinte, puis médianes.
  let refs = NAMES.map((name) => {
    const near = labs.filter((l) => NAMES.every((o) => nameCost(l, name) <= nameCost(l, o)));
    return near.length ? median3(near) : null;
  });
  const fallback = { W: [85, 0, 5], Y: [80, -5, 75], R: [45, 60, 35], O: [62, 45, 65], B: [40, 10, -55], G: [60, -55, 30] };
  refs = refs.map((r, k) => r || fallback[NAMES[k]]);
  let assign = null;
  for (let iter = 0; iter < 4; iter++) {
    const cost = labs.map((l) => {
      const row = [];
      for (let c = 0; c < 6; c++) { const d = labDist(l, refs[c]); for (let k = 0; k < n2; k++) row.push(d); }
      return row;
    });
    const a = hungarian(cost).map((col) => Math.floor(col / n2));
    if (assign && a.every((x, i) => x === assign[i])) break;
    assign = a;
    refs = refs.map((r, c) => median3(labs.filter((_, i) => assign[i] === c)));
  }
  return { refs, assign };
}

// Les 24 étiquetages « rotation » d'un étiquetage de référence, plus leurs miroirs.
function allLabelings() {
  const out = [];
  const perm = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perm([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  // face k <- groupe p[k]. Le coût ne change pas si l'on tourne tout le cube :
  // on garde un représentant par classe (groupe 0 en U, le plus petit des
  // groupes latéraux en F) — 30 étiquetages au lieu de 720.
  for (const p of perm([0, 1, 2, 3, 4, 5])) {
    if (p[0] !== 0) continue; // U
    if (p[2] !== Math.min(p[1], p[2], p[4], p[5])) continue; // F parmi R F L B
    out.push(p);
  }
  return out;
}
const LABELINGS = allLabelings();

// fast : coins seulement, sans recalibrage (pour comparer des hypothèses).
export function assignColorsNxN(labs, N, { iterations = 2, fast = false } = {}) {
  const P = puzzle(N);
  const n2 = N * N;
  const { refs: clusterRefs } = balancedClusters(labs, n2);
  const full = N === 4 && !fast;
  const wings = full ? P.edgeOrbits[0] : [];
  const centers = full ? P.centerOrbits[0] : [];
  const solvedCorner = P.corners.map((c) => c.map((f) => P.solved[f]));
  const solvedWing = wings.map((w) => w.map((f) => P.solved[f]));
  const fi = Object.fromEntries(FACES.map((f, i) => [f, i]));

  // Coût d'un étiquetage (refs[k] = couleur de la face k).
  function evaluate(refs) {
    const d = (k, letter) => labDist(labs[k], refs[fi[letter]]);
    const cornerOpt = P.corners.map((pos) => solvedCorner.map((cols) => {
      let best = null;
      for (let o = 0; o < 3; o++) {
        let c = 0;
        for (let k = 0; k < 3; k++) c += d(pos[(k + o) % 3], cols[k]);
        if (!best || c < best.c) best = { c, o };
      }
      return best;
    }));
    const cp = hungarian(cornerOpt.map((row) => row.map((x) => x.c)));
    const co = cp.map((p, i) => cornerOpt[i][p].o);
    let cost = cp.reduce((t, p, i) => t + cornerOpt[i][p].c, 0);
    let wp = null, cAssign = null;
    if (full) {
      const wCost = wings.map((pos) => solvedWing.map((cols) => d(pos[0], cols[0]) + d(pos[1], cols[1])));
      wp = hungarian(wCost);
      cost += wp.reduce((t, p, i) => t + wCost[i][p], 0);
      const cCost = centers.map((f) => {
        const row = [];
        for (const L of FACES) { const v = d(f, L); for (let k = 0; k < 4; k++) row.push(v); }
        return row;
      });
      cAssign = hungarian(cCost).map((col) => FACES[Math.floor(col / 4)]);
      cost += centers.reduce((t, f, i) => t + d(f, cAssign[i]), 0);
    }
    return { cost, cp, co, wp, cAssign, d, cornerOpt };
  }

  let refs = null, best = null;
  // 1. Étiquetage : groupes -> faces (les 720 bijections ; les miroirs, qui
  //    ne forment aucun vrai coin, coûtent cher et sont écartés d'eux-mêmes).
  for (const lab of LABELINGS) {
    const r = lab.map((g) => clusterRefs[g]);
    const ev = evaluate(r);
    if (!best || ev.cost < best.cost - 1e-6) { best = ev; refs = r; }
  }
  if (fast) {
    const twist = best.co.reduce((a, b) => a + b, 0) % 3;
    return { cost: best.cost + (twist ? 40 : 0) };
  }
  // 2. Recalibrage des couleurs de référence sur l'attribution obtenue.
  let facelets = null, changed = new Set();
  for (let iter = 0; iter < iterations; iter++) {
    const ev = iter === 0 ? best : evaluate(refs);
    const { cp, co, wp, cAssign } = ev;
    changed = new Set();
    // Torsion impossible : on tourne le coin dont le changement coûte le moins.
    const twist = co.reduce((a, b) => a + b, 0) % 3;
    if (twist) {
      let fix = null;
      for (let i = 0; i < 8; i++) {
        const no = (co[i] + 3 - twist) % 3;
        const cc = (o) => { let c = 0; for (let k = 0; k < 3; k++) c += ev.d(P.corners[i][(k + o) % 3], solvedCorner[cp[i]][k]); return c; };
        const delta = cc(no) - cc(co[i]);
        if (!fix || delta < fix.delta) fix = { i, no, delta };
      }
      co[fix.i] = fix.no;
      P.corners[fix.i].forEach((k) => changed.add(k));
    }
    const s = new Array(P.size).fill('?');
    for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) s[P.corners[i][(k + co[i]) % 3]] = solvedCorner[cp[i]][k];
    if (full) {
      wings.forEach((pos, i) => { s[pos[0]] = solvedWing[wp[i]][0]; s[pos[1]] = solvedWing[wp[i]][1]; });
      centers.forEach((f, i) => { s[f] = cAssign[i]; });
    }
    facelets = s;
    refs = FACES.map((L, k) => {
      const m = labs.filter((_, i) => s[i] === L);
      return m.length ? median3(m) : refs[k];
    });
  }
  // Pour le 2x2, le solveur garde le coin DBL fixe : on renomme les faces
  // (rotation du cube entier) pour que la pièce en DBL y soit bien placée.
  if (N === 2) {
    const dbl = P.corners[6].map((f) => facelets[f]);
    const rename = { [dbl[0]]: 'D', [dbl[1]]: 'B', [dbl[2]]: 'L' };
    const opp = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
    for (const [from, to] of Object.entries({ ...rename })) rename[opp[from]] = opp[to];
    facelets = facelets.map((x) => rename[x]);
    const newRefs = {};
    FACES.forEach((L, k) => { newRefs[rename[L]] = refs[k]; });
    refs = FACES.map((L) => newRefs[L]);
  }
  // Nom de couleur (W, Y…) de chaque face d'après sa teinte.
  const nameAssign = hungarian(refs.map((r) => NAMES.map((n) => nameCost(r, n))));
  const colorOf = Object.fromEntries(FACES.map((L, k) => [L, NAMES[nameAssign[k]]]));
  // Cases douteuses : couleur retenue pas nettement la plus proche.
  const uncertain = new Set(changed);
  for (let k = 0; k < P.size; k++) {
    const ds = FACES.map((L, i) => ({ L, d: labDist(labs[k], refs[i]) })).sort((a, b) => a.d - b.d);
    const mine = ds.find((x) => x.L === facelets[k]).d, other = ds.find((x) => x.L !== facelets[k]).d;
    if (other - mine < 8) uncertain.add(k);
  }
  const str = facelets.join('');
  let cost = 0;
  for (let k = 0; k < P.size; k++) cost += labDist(labs[k], refs[fi[str[k]]]);
  return { facelets: str, colorOf, refs, uncertain, corrected: changed.size > 0, cost, valid: validateNxN(str, N) };
}

// Validation d'un état 2x2 / 4x4 (lettres URFDLB).
export function validateNxN(s, N) {
  const P = puzzle(N);
  const errors = [];
  if (s.length !== P.size) return { ok: false, errors: [`Il faut ${P.size} cases.`] };
  for (const f of FACES) {
    const n = [...s].filter((x) => x === f).length;
    if (n !== N * N) errors.push(`Une couleur apparaît ${n} fois au lieu de ${N * N}.`);
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const solvedCorner = P.corners.map((c) => c.map((f) => P.solved[f]));
  const seen = new Set();
  let twist = 0;
  for (const c of P.corners) {
    const cols = c.map((f) => s[f]);
    const o = cols.findIndex((x) => x === 'U' || x === 'D');
    const p = o < 0 ? -1 : solvedCorner.findIndex((sc) => sc[0] === cols[o] && sc[1] === cols[(o + 1) % 3] && sc[2] === cols[(o + 2) % 3]);
    if (p < 0) { errors.push(`Coin impossible : ${cols.join('')}.`); continue; }
    if (seen.has(p)) errors.push('Un même coin apparaît deux fois.');
    seen.add(p);
    twist += o;
  }
  if (!errors.length && twist % 3) errors.push('Un coin est tourné sur lui-même (torsion impossible).');
  if (N === 4) {
    const key = (w) => w.map((f) => s[f]).join('');
    const solvedKeys = new Set(P.edgeOrbits[0].map((w) => w.map((f) => P.solved[f]).join('')));
    const keys = P.edgeOrbits[0].map(key);
    if (keys.some((k) => !solvedKeys.has(k))) errors.push('Une arête est impossible.');
    else if (new Set(keys).size !== 24) errors.push('Une même arête apparaît deux fois.');
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
