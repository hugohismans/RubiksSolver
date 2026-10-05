// Résolution du 4x4x4 par réduction :
//  1. « threephase » (csTimer) regroupe les centres et apparie les arêtes ;
//  2. le cube réduit se résout comme un 3x3 (Kociemba, via cubejs) en ne
//     tournant que les couches extérieures.
// Les parités (OLL / PLL) sont réglées dès la réduction par threephase.

import { reduce444, moveCenters, moveEdges, initialize } from '../../vendor/threephase/threephase.js';
import { puzzle, FACES } from '../cube/nxn.js';

const P = puzzle(4);
const AXES = ['U', 'R', 'F', 'D', 'L', 'B'];

// Mouvement interne m (quart horaire = puissance 0) -> notre permutation.
function ourPerm(m) {
  const axis = AXES[Math.floor(m / 3) % 6], wide = m >= 18;
  return P.movePerm(axis, 1, wide ? 2 : 1, 1);
}

// Relie les emplacements internes (24 centres, 24 ailes) à nos facettes en
// propageant par les mouvements : si l'emplacement s va en d, son image va
// en l'image de d.
function link(count, moveFn, ourSlots, ourDest) {
  const destOf = [];
  for (let m = 0; m < 36; m += 3) {
    const arr = Array.from({ length: count }, (_, i) => i);
    moveFn(arr, m);
    const d = new Array(count);
    arr.forEach((piece, pos) => { d[piece] = pos; });
    destOf.push({ m, d });
  }
  for (let start = 0; start < ourSlots.length; start++) {
    const phi = new Array(count).fill(-1);
    phi[0] = start;
    const queue = [0];
    let ok = true;
    while (queue.length && ok) {
      const s = queue.shift();
      for (const { m, d } of destOf) {
        const t = d[s], img = ourDest(phi[s], ourPerm(m));
        if (phi[t] === -1) { phi[t] = img; queue.push(t); } else if (phi[t] !== img) { ok = false; break; }
      }
    }
    if (ok && !phi.includes(-1) && new Set(phi).size === count) return phi;
  }
  throw new Error('Correspondance 4x4 introuvable');
}

let map = null;
function mapping() {
  if (map) return map;
  const centers = P.centerOrbits[0];
  const wings = P.edgeOrbits[0];
  const wingOf = new Map(wings.map((w, k) => [w[0], k]));
  const ctPhi = link(24, moveCenters, centers, (k, perm) => centers.indexOf(perm[centers[k]]));
  const epPhi = link(24, moveEdges, wings, (k, perm) => wingOf.get(perm[wings[k][0]]));
  // Couleur interne de chaque face : celle des centres à l'état résolu.
  const colorOfFace = {};
  ctPhi.forEach((k, s) => { colorOfFace[P.faceOf(centers[k])] = Math.floor(s / 4); });
  map = { centers, wings, ctPhi, epPhi, colorOfFace };
  return map;
}

function parity(p) {
  let par = 0;
  const seen = new Array(p.length).fill(false);
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = p[j]) { seen[j] = true; len++; }
    par ^= (len - 1) & 1;
  }
  return par;
}

function cornerPerm(state) {
  const solvedSets = P.corners.map((c) => c.map((i) => P.solved[i]).sort().join(''));
  return P.corners.map((c) => solvedSets.indexOf(c.map((i) => state[i]).sort().join('')));
}

// Rotations du cube entier (24) et réétiquetage des faces qu'elles induisent.
const ROTATIONS = [];
for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) for (const b of ['', 'y', 'y2', "y'"]) ROTATIONS.push((a + ' ' + b).trim());
const relabelCache = new Map();
// Conjugue une séquence par une rotation ρ : « ρ seq ρ⁻¹ » sans rotation.
function conjugate(seq, rot) {
  if (!rot) return seq;
  if (!relabelCache.has(rot)) {
    const ids = Array.from({ length: P.size }, (_, i) => i);
    const map = {};
    for (const X of FACES) {
      const target = P.apply(ids, `${rot} ${X} ${P.invert(rot)}`).join(',');
      map[X] = FACES.find((Y) => P.apply(ids, Y).join(',') === target);
    }
    relabelCache.set(rot, map);
  }
  const map = relabelCache.get(rot);
  return seq.split(' ').filter(Boolean).map((m) => m.replace(/[URFDLB]/, (X) => map[X])).join(' ');
}

// Réduction : renvoie les mouvements (notation 4x4) qui regroupent centres et arêtes.
export function reduction(state) {
  const { centers, wings, ctPhi, epPhi, colorOfFace } = mapping();
  const ct = ctPhi.map((k) => colorOfFace[state[centers[k]]]);
  const wingKey = (w, s) => s[w[0]] + s[w[1]];
  const solvedIdx = new Map(wings.map((w, k) => [wingKey(w, P.solved), k]));
  const epInv = new Array(24);
  epPhi.forEach((k, s) => { epInv[k] = s; });
  const ep = epPhi.map((k) => epInv[solvedIdx.get(wingKey(wings[k], state))]);
  if (ep.some((x) => x === undefined) || new Set(ep).size !== 24) throw new Error('Arêtes incohérentes');
  const cp = cornerPerm(state);
  if (cp.includes(-1) || new Set(cp).size !== 8) throw new Error('Coins incohérents');
  const sol = reduce444(ct, ep, parity(cp));
  // La séquence rendue est exprimée à une rotation près du cube : on la retrouve.
  const raw = P.invert(sol.trim().split(/\s+/).filter(Boolean).join(' '));
  for (const rot of ROTATIONS) {
    const seq = conjugate(raw, rot);
    if (isReduced(P.apply(state, seq))) return seq;
  }
  throw new Error('Réduction 4x4 impossible');
}

// Solution complète : réduction puis résolution 3x3 (solve333 : chaîne de
// 54 facettes -> mouvements). Renvoie la séquence en notation 4x4.
export function solve444(state, solve333) {
  if (P.isSolved(state)) return '';
  const red = reduction(state);
  const reduced = P.apply(state, red);
  const s3 = to333(reduced);
  const sol3 = s3 === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB' ? '' : solve333(s3).trim();
  const all = `${red} ${sol3}`.trim().replace(/\s+/g, ' ');
  if (!P.isSolved(P.apply(state, all))) throw new Error('Solution 4x4 invalide');
  return all;
}

// Cube réduit -> chaîne 3x3 (54 facettes), lettres = faces selon les centres.
export function to333(state) {
  const out = [];
  for (let f = 0; f < 6; f++) {
    for (const r of [0, 1, 3]) for (const c of [0, 1, 3]) {
      out.push(state[f * 16 + (r === 1 && c === 1 ? 5 : r * 4 + c)]);
    }
  }
  const letter = {};
  FACES.forEach((F, f) => { letter[out[f * 9 + 4]] = F; });
  return out.map((x) => letter[x]).join('');
}

export function isReduced(state) {
  const at = (f, r, c) => state[f * 16 + r * 4 + c];
  for (let f = 0; f < 6; f++) {
    if (at(f, 1, 1) !== at(f, 1, 2) || at(f, 1, 1) !== at(f, 2, 1) || at(f, 1, 1) !== at(f, 2, 2)) return false;
    if (at(f, 0, 1) !== at(f, 0, 2) || at(f, 3, 1) !== at(f, 3, 2) || at(f, 1, 0) !== at(f, 2, 0) || at(f, 1, 3) !== at(f, 2, 3)) return false;
  }
  return true;
}

export { initialize, P };
