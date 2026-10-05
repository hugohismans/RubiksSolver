// Scan guidé des cubes sans centre fixe (2x2, 4x4).
//
// Sans centre, la couleur d'une face ne dit pas où elle se trouve : on se fie
// donc à l'ORDRE des faces montrées. L'utilisateur garde le même dessus et
// tourne le cube d'un quart de tour vers la gauche, quatre fois (avant,
// droite, arrière, gauche), puis montre le dessus et le dessous.
// Les imprécisions (sens de rotation inversé, dessus/dessous montrés dans un
// autre sens) sont corrigées à la fin : on garde l'hypothèse qui forme le
// cube le plus cohérent.

import { labToRgb } from '../vision/color.js';
import { assignColorsNxN } from '../cube/colors-nxn.js';
import { FACES } from '../cube/nxn.js';
import { sameSticker } from './freecapture.js';

export const STEPS_NXN = [
  { slot: 'F', text: 'Montre une face', sub: 'N’importe laquelle — c’est la face avant. Garde le même dessus pendant les 4 premières faces.' },
  { slot: 'R', text: 'Un quart de tour vers la gauche', sub: 'Tourne le cube sur lui-même, le dessus reste en haut.' },
  { slot: 'B', text: 'Encore un quart de tour', sub: 'Toujours vers la gauche, même dessus.' },
  { slot: 'L', text: 'Encore un quart de tour', sub: 'Toujours vers la gauche, même dessus.' },
  { slot: 'U', text: 'Montre le dessus', sub: 'Un dernier quart de tour pour revenir à la 1re face, puis bascule le haut du cube vers toi.' },
  { slot: 'D', text: 'Montre le dessous', sub: 'Retourne le cube d’un demi-tour (le dessous face à toi).' },
];

// Rotation horaire d'une grille N×N (k quarts de tour).
export function rotateGridN(cells, k, N) {
  let g = cells.slice();
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) {
    const n = new Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) n[c * N + (N - 1 - r)] = g[r * N + c];
    g = n;
  }
  return g;
}

// Nombre de cases identiques entre deux grilles, sous la meilleure rotation.
export function patternMatchN(a, b, N) {
  let best = 0;
  for (let k = 0; k < 4; k++) {
    const g = rotateGridN(a, k, N);
    let n = 0;
    for (let i = 0; i < N * N; i++) if (sameSticker(g[i], b[i])) n++;
    best = Math.max(best, n);
  }
  return best;
}

export class NxNSession {
  constructor(N) {
    this.N = N;
    this.scans = []; // { labs, rgbs } dans l'ordre des étapes
  }

  get done() { return this.scans.length === 6; }
  get history() { return this.scans; }
  nextStep() { return STEPS_NXN[this.scans.length] || null; }

  // La face montrée a-t-elle déjà été capturée ? (même motif)
  seenIndex(labs) {
    const need = this.N * this.N - (this.N > 2 ? 1 : 0);
    return this.scans.findIndex((sc) => patternMatchN(sc.labs, labs, this.N) >= need);
  }

  accept(labs, rgbs = labs.map((l) => labToRgb(...l))) {
    this.scans.push({ labs, rgbs });
  }

  undo() { return this.scans.pop() || null; }

  // Grilles dans l'ordre canonique du solveur, pour une hypothèse donnée.
  labsFor(sides, capRots) {
    const n2 = this.N * this.N;
    const bySlot = {};
    // sides : faces 1..4 -> emplacements (F R B L, ou F L B R si tourné à droite).
    this.scans.slice(0, 4).forEach((sc, i) => { bySlot[sides[i]] = sc.labs; });
    bySlot.U = rotateGridN(this.scans[4].labs, capRots[0], this.N);
    bySlot.D = rotateGridN(this.scans[5].labs, capRots[1], this.N);
    const out = [];
    for (const f of FACES) for (let k = 0; k < n2; k++) out.push(bySlot[f][k]);
    return out;
  }

  // Reconstruction : on essaie les deux sens de rotation et les 16
  // orientations possibles du dessus/dessous, on garde la plus cohérente.
  resolve() {
    const hyps = [];
    for (const sides of [['F', 'R', 'B', 'L'], ['F', 'L', 'B', 'R']]) {
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const labs = this.labsFor(sides, [a, b]);
        // Pénalité légère pour les écarts à la consigne.
        const pen = (sides[1] === 'L' ? 15 : 0) + (a ? 8 : 0) + (b ? 8 : 0);
        hyps.push({ sides, rots: [a, b], labs, score: assignColorsNxN(labs, this.N, { fast: true }).cost + pen });
      }
    }
    hyps.sort((x, y) => x.score - y.score);
    // Évaluation complète des meilleures hypothèses.
    let best = null;
    for (const h of hyps.slice(0, 3)) {
      const res = assignColorsNxN(h.labs, this.N);
      const score = res.cost + (res.valid.ok ? 0 : 1e6) + (res.corrected ? 30 : 0);
      if (!best || score < best.score) best = { ...res, score, labs: h.labs, sides: h.sides, rots: h.rots };
    }
    return best;
  }
}
