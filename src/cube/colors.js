// Attribution des couleurs aux 54 cases à partir des mesures Lab.
//
// Plutôt que de classer chaque case isolément (fragile : rouge/orange,
// blanc/jaune sous un éclairage chaud…), on raisonne par PIÈCES : chaque
// emplacement de coin reçoit l'un des 8 coins réels (avec une de ses 3
// orientations), chaque emplacement d'arête l'une des 12 arêtes. C'est une
// affectation optimale (algorithme hongrois) : elle garantit 9 cases de chaque
// couleur et des pièces qui existent vraiment. On corrige ensuite, au moindre
// coût, torsion des coins, retournement des arêtes et parité.

import { FACES, CORNERS, EDGES, CORNER_COLORS, EDGE_COLORS, validateFacelets } from './cube.js';
import { labDist } from '../vision/color.js';

// Algorithme hongrois (affectation de coût minimal), matrice n x n.
export function hungarian(cost) {
  const n = cost.length;
  // Une valeur non finie bloquerait l'algorithme.
  cost = cost.map((row) => row.map((x) => (Number.isFinite(x) ? x : 1e6)));
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const assign = new Array(n);
  for (let j = 1; j <= n; j++) assign[p[j] - 1] = j - 1;
  return assign;
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

// labs : tableau de 54 mesures Lab dans l'ordre Kociemba (centres compris).
// Renvoie { facelets, uncertain: Set<index>, corrected: bool, cost }.
export function assignColors(labs) {
  let refs = FACES.map((_, f) => labs[f * 9 + 4]);
  const faceIdx = Object.fromEntries(FACES.map((f, i) => [f, i]));
  let result = null;
  for (let iter = 0; iter < 4; iter++) {
    const d = (k, face) => labDist(labs[k], refs[faceIdx[face]]);
    // Coins : coût[emplacement][pièce] = meilleure des 3 orientations.
    const cornerOpt = CORNERS.map((pos) => CORNER_COLORS.map((cols) => {
      let best = null;
      for (let o = 0; o < 3; o++) {
        // orientation o : la facette (k + o) % 3 montre la couleur k de la pièce
        let c = 0;
        for (let k = 0; k < 3; k++) c += d(pos[(k + o) % 3], cols[k]);
        if (!best || c < best.c) best = { c, o };
      }
      return best;
    }));
    const edgeOpt = EDGES.map((pos) => EDGE_COLORS.map((cols) => {
      const c0 = d(pos[0], cols[0]) + d(pos[1], cols[1]);
      const c1 = d(pos[0], cols[1]) + d(pos[1], cols[0]);
      return c0 <= c1 ? { c: c0, o: 0 } : { c: c1, o: 1 };
    }));
    const cp = hungarian(cornerOpt.map((row) => row.map((x) => x.c)));
    const ep = hungarian(edgeOpt.map((row) => row.map((x) => x.c)));
    const co = cp.map((pc, i) => cornerOpt[i][pc].o);
    const eo = ep.map((pe, i) => edgeOpt[i][pe].o);
    const cornerCost = (i, piece, o) => {
      let c = 0;
      for (let k = 0; k < 3; k++) c += d(CORNERS[i][(k + o) % 3], CORNER_COLORS[piece][k]);
      return c;
    };
    const edgeCost = (i, piece, o) => (o === 0
      ? d(EDGES[i][0], EDGE_COLORS[piece][0]) + d(EDGES[i][1], EDGE_COLORS[piece][1])
      : d(EDGES[i][0], EDGE_COLORS[piece][1]) + d(EDGES[i][1], EDGE_COLORS[piece][0]));
    const changed = new Set();

    // Torsion des coins : on ajuste le coin dont le changement coûte le moins.
    const twist = co.reduce((a, b) => a + b, 0) % 3;
    if (twist) {
      let best = null;
      for (let i = 0; i < 8; i++) {
        const no = (co[i] + 3 - twist) % 3;
        const delta = cornerCost(i, cp[i], no) - cornerCost(i, cp[i], co[i]);
        if (!best || delta < best.delta) best = { i, no, delta };
      }
      co[best.i] = best.no;
      CORNERS[best.i].forEach((k) => changed.add(k));
    }
    // Retournement d'arête.
    if (eo.reduce((a, b) => a + b, 0) % 2) {
      let best = null;
      for (let i = 0; i < 12; i++) {
        const delta = edgeCost(i, ep[i], 1 - eo[i]) - edgeCost(i, ep[i], eo[i]);
        if (!best || delta < best.delta) best = { i, delta };
      }
      eo[best.i] = 1 - eo[best.i];
      EDGES[best.i].forEach((k) => changed.add(k));
    }
    // Parité : on échange les deux arêtes (orientations conservées) les moins chères.
    if (parity(cp) !== parity(ep)) {
      let best = null;
      for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) {
        const delta = edgeCost(a, ep[b], eo[a]) + edgeCost(b, ep[a], eo[b]) - edgeCost(a, ep[a], eo[a]) - edgeCost(b, ep[b], eo[b]);
        if (!best || delta < best.delta) best = { a, b, delta, kind: 'e' };
      }
      for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
        const delta = cornerCost(a, cp[b], co[a]) + cornerCost(b, cp[a], co[b]) - cornerCost(a, cp[a], co[a]) - cornerCost(b, cp[b], co[b]);
        if (delta < best.delta) best = { a, b, delta, kind: 'c' };
      }
      if (best.kind === 'e') {
        [ep[best.a], ep[best.b]] = [ep[best.b], ep[best.a]];
        [...EDGES[best.a], ...EDGES[best.b]].forEach((k) => changed.add(k));
      } else {
        [cp[best.a], cp[best.b]] = [cp[best.b], cp[best.a]];
        [...CORNERS[best.a], ...CORNERS[best.b]].forEach((k) => changed.add(k));
      }
    }

    // Reconstruit la chaîne de facettes.
    const s = new Array(54);
    for (let f = 0; f < 6; f++) s[f * 9 + 4] = FACES[f];
    for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) s[CORNERS[i][(k + co[i]) % 3]] = CORNER_COLORS[cp[i]][k];
    for (let i = 0; i < 12; i++) {
      const cols = EDGE_COLORS[ep[i]];
      s[EDGES[i][0]] = cols[eo[i]];
      s[EDGES[i][1]] = cols[1 - eo[i]];
    }
    const facelets = s.join('');
    let cost = 0;
    for (let k = 0; k < 54; k++) cost += d(k, facelets[k]);
    result = { facelets, changed, cost };
    // Recalibre les couleurs de référence sur les cases attribuées (médiane).
    const newRefs = FACES.map((f) => {
      const members = [];
      for (let k = 0; k < 54; k++) if (facelets[k] === f) members.push(labs[k]);
      return [0, 1, 2].map((c) => {
        const v = members.map((m) => m[c]).sort((a, b) => a - b);
        return v[v.length >> 1];
      });
    });
    refs = newRefs;
  }

  // Cases douteuses : la couleur retenue n'est pas nettement la plus proche.
  const uncertain = new Set(result.changed);
  for (let k = 0; k < 54; k++) {
    if (k % 9 === 4) continue;
    const dists = FACES.map((f, i) => ({ f, d: labDist(labs[k], refs[i]) })).sort((a, b) => a.d - b.d);
    const mine = dists.find((x) => x.f === result.facelets[k]).d;
    const other = dists.find((x) => x.f !== result.facelets[k]).d;
    if (other - mine < 8) uncertain.add(k);
  }
  const valid = validateFacelets(result.facelets);
  return { facelets: result.facelets, uncertain, corrected: result.changed.size > 0, cost: result.cost, refs, valid };
}
