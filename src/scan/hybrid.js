// Résolution du mode libre : on dispose de faces capturées une à une (dans
// n'importe quel sens : orientation inconnue) et, en bonus, de ce que le
// modèle 3D a appris quand plusieurs faces étaient visibles ensemble.
//
// Chaque face va à la position de sa couleur (schéma standard, ou miroir en
// dernier recours) ; on essaie les 4 rotations possibles des faces dont
// l'orientation est inconnue, et l'on garde la combinaison qui donne un cube
// possible au moindre coût (cohérence des pièces).

import { FACES, rotateGrid, CANONICAL_NEIGHBORS } from '../cube/cube.js';
import { assignColors } from '../cube/colors.js';
import { hueDeg, chroma } from '../vision/color.js';

const WESTERN = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const MIRROR = { ...WESTERN, R: 'O', L: 'R' };

// loose : { couleur: labs[9] (ordre de l'image) }.
// fixed : { face du solveur: labs[9] (ordre canonique) } connues par le modèle 3D.
// relations : { couleur: [{ n: couleur voisine, side: 0..3 }] } — faces voisines
//   vues lors de la capture (côté dans l'image : haut, droite, bas, gauche).
export async function resolveHybrid(loose, fixed = {}, { onProgress, relations = {} } = {}) {
  // Rouge/orange : on se fie à la teinte réelle des centres.
  loose = { ...loose };
  if (loose.R && loose.O) {
    const rank = (lab) => { const h = hueDeg(lab); return h > 300 ? h - 360 : h; };
    if (rank(loose.R[4]) > rank(loose.O[4])) [loose.R, loose.O] = [loose.O, loose.R];
  }
  // Blanc/jaune : le blanc est le moins saturé des deux.
  if (loose.W && loose.Y && chroma(loose.W[4]) > chroma(loose.Y[4])) [loose.W, loose.Y] = [loose.Y, loose.W];
  let best = null, second = null;
  let evals = 0;
  // Meilleure alternative valide qui donne un cube différent (ambiguïté).
  const pickSecond = (cur, cand, ref = null) => {
    if (!cand.valid.ok || cand.corrected) return cur;
    if (ref && cand.facelets === ref.facelets) return cur;
    return !cur || cand.score < cur.score ? cand : cur;
  };
  for (const scheme of [WESTERN, MIRROR]) {
    // Le miroir n'est essayé que si le schéma standard échoue.
    if (scheme === MIRROR && best && best.valid.ok && !best.corrected) break;
    const grids = {}, free = [];
    let ok = true;
    for (const slot of FACES) {
      if (fixed[slot]) grids[slot] = fixed[slot];
      else if (loose[scheme[slot]]) { grids[slot] = loose[scheme[slot]]; free.push(slot); }
      else ok = false;
    }
    if (!ok) continue;
    const slotOf = Object.fromEntries(Object.entries(scheme).map(([slot, col]) => [col, slot]));
    // Rotation imposée par une voisine vue en même temps (pénalité si on s'en écarte).
    const required = {};
    for (const slot of free) {
      for (const rel of relations[scheme[slot]] || []) {
        const q = CANONICAL_NEIGHBORS[slot].indexOf(slotOf[rel.n]);
        if (q >= 0) (required[slot] = required[slot] || []).push((q - rel.side + 4) % 4);
      }
    }
    const n = free.length;
    for (let code = 0; code < 4 ** n; code++) {
      const rots = {};
      let c = code;
      for (const slot of free) { rots[slot] = c % 4; c = Math.floor(c / 4); }
      const labs = [];
      for (const slot of FACES) labs.push(...(rots[slot] ? rotateGrid(grids[slot], rots[slot]) : grids[slot]));
      const res = assignColors(labs, { iterations: 1 });
      let hintPen = 0;
      for (const slot of free) for (const r of required[slot] || []) if (r !== (rots[slot] || 0)) hintPen += 60;
      const score = res.cost + (res.valid.ok ? 0 : 1e6) + (res.corrected ? 30 : 0) + (scheme === MIRROR ? 250 : 0) + hintPen;
      const cand = { score, rots, scheme, labs, valid: res.valid, corrected: res.corrected, facelets: res.facelets };
      if (!best || score < best.score) { if (best) second = pickSecond(second, best); best = cand; } else second = pickSecond(second, cand, best);
      // Rend la main régulièrement (l'interface reste fluide).
      if (++evals % 300 === 0) { onProgress && onProgress(evals); await new Promise((r) => setTimeout(r, 0)); }
    }
  }
  if (!best) return null;
  const res = assignColors(best.labs);
  // Ambiguë : une autre lecture valide, différente, presque aussi bonne.
  const ambiguous = !!(second && second.facelets !== best.facelets && second.score < best.score + 25);
  return { ...res, labs: best.labs, scheme: best.scheme, rotated: [], ambiguous, alternative: ambiguous ? second.facelets : null };
}

// Grilles canoniques des faces du solveur entièrement connues par le modèle 3D
// (il faut que le blanc et le vert y soient pour fixer le repère).
export function fixedFromModel(model) {
  const faces = [...model.faces.values()];
  const U = faces.find((f) => f.color === 'W');
  const F = U && faces.find((f) => f.color === 'G' && f.n.every((v, i) => v * U.n[i] === 0));
  if (!U || !F) return {};
  let refs;
  try { refs = model.toSolverLabs().refs; } catch { return {}; }
  const out = {};
  FACES.forEach((slot, si) => {
    const cells = refs.slice(si * 9, si * 9 + 9);
    if (cells.every((r) => r && r.face && model.cellKnown(r.face, r.k))) {
      out[slot] = cells.map((r) => model.cellEstimate(r.face, r.k).lab);
    }
  });
  return out;
}
