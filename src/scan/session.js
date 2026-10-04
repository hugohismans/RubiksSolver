// Session de scan guidé : quelles faces montrer, dans quel ordre et quelle
// orientation, identification de la face montrée, puis reconstruction des
// 54 cases dans la convention du solveur.

import { rgbToLab, labDist, chroma, hueDeg } from '../vision/color.js';
import { scanToCanonical, FACES } from '../cube/cube.js';
import { assignColors } from '../cube/colors.js';

export const COLOR_INFO = {
  W: { name: 'blanche', short: 'Blanc', css: '#f4f4f0' },
  Y: { name: 'jaune', short: 'Jaune', css: '#ffd500' },
  R: { name: 'rouge', short: 'Rouge', css: '#d7263d' },
  O: { name: 'orange', short: 'Orange', css: '#ff7a1a' },
  B: { name: 'bleue', short: 'Bleu', css: '#1f6fe0' },
  G: { name: 'verte', short: 'Vert', css: '#2fbf4a' },
};
export const COLOR_KEYS = ['W', 'Y', 'R', 'O', 'B', 'G'];

// Ordre demandé : les 4 faces latérales blanc en haut, puis blanc et jaune
// avec le bleu en haut.
export const STEPS = [
  { color: 'R', top: 'W', group: 'side' },
  { color: 'B', top: 'W', group: 'side' },
  { color: 'O', top: 'W', group: 'side' },
  { color: 'G', top: 'W', group: 'side' },
  { color: 'W', top: 'B', group: 'cap' },
  { color: 'Y', top: 'B', group: 'cap' },
];

// Schéma de couleurs standard (occidental) : face du solveur -> couleur.
const WESTERN = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };

// Prototype grossier d'une couleur à partir de sa teinte (avant calibration).
export function roughColor(lab) {
  const c = chroma(lab), h = hueDeg(lab);
  // Blanc : peu saturé (un blanc sous lumière chaude reste moins saturé qu'un jaune).
  if (c < 22 || (c < 32 && lab[0] > 78)) return lab[0] > 30 ? 'W' : null;
  if (h < 38 || h >= 330) return 'R';
  if (h < 68) return 'O';
  if (h < 105) return 'Y';
  if (h < 200) return 'G';
  return 'B';
}

export class ScanSession {
  constructor() {
    this.scans = {}; // couleur -> { labs: [9], rgbs: [9] } (ordre image)
    this.history = [];
  }

  get done() { return Object.keys(this.scans).length === 6; }

  nextStep() {
    return STEPS.find((s) => !this.scans[s.color]) || null;
  }

  // Identifie la face montrée à partir de son centre.
  // Renvoie { color, status } avec status : 'ok' | 'already' | 'later'.
  identify(centerLab) {
    const step = this.nextStep();
    if (!step) return { color: null, status: 'done' };
    // Déjà scannée ? (très proche d'un centre mesuré)
    let near = null;
    for (const [col, sc] of Object.entries(this.scans)) {
      const d = labDist(centerLab, sc.labs[4]);
      if (!near || d < near.d) near = { col, d };
    }
    const rough = roughColor(centerLab);
    if (!rough) return { color: null, status: 'unknown' };
    if (near && near.d < 12 && (rough === near.col || near.d < 7)) return { color: near.col, status: 'already' };
    let color = rough;
    // Rouge/orange : si l'une des deux est déjà scannée et que ce centre est
    // nettement différent, c'est l'autre.
    if ((rough === 'R' || rough === 'O') && this.scans[rough]) {
      const other = rough === 'R' ? 'O' : 'R';
      if (!this.scans[other] && labDist(centerLab, this.scans[rough].labs[4]) > 10) color = other;
    }
    if (this.scans[color]) return { color, status: 'already' };
    const group = STEPS.find((s) => s.color === color).group;
    if (group !== step.group) return { color, status: 'later' };
    return { color, status: 'ok' };
  }

  accept(color, labs, rgbs) {
    this.scans[color] = { labs, rgbs };
    this.history.push(color);
  }

  undo() {
    const c = this.history.pop();
    if (c) delete this.scans[c];
    return c;
  }

  // Construit les 54 mesures pour un schéma donné et résout les couleurs.
  // On essaie le schéma standard et sa version miroir (rouge/orange inversés),
  // ce qui corrige aussi une confusion rouge/orange sur les centres.
  resolve() {
    const candidates = [WESTERN, { ...WESTERN, R: 'O', L: 'R' }];
    let best = null;
    for (const scheme of candidates) {
      const slotOf = Object.fromEntries(Object.entries(scheme).map(([slot, col]) => [col, slot]));
      const labs = new Array(54);
      for (const step of STEPS) {
        const slot = slotOf[step.color];
        const topSlot = slotOf[step.top];
        const canon = scanToCanonical(slot, topSlot, this.scans[step.color].labs);
        const f = FACES.indexOf(slot);
        for (let k = 0; k < 9; k++) labs[f * 9 + k] = canon[k];
      }
      const res = assignColors(labs);
      const score = res.cost + (res.valid.ok ? 0 : 1e6) + (res.corrected ? 30 : 0);
      if (!best || score < best.score) best = { ...res, scheme, score, labs };
    }
    return best;
  }
}

// Couleur (clé W/Y/R/O/B/G) de chaque face du solveur, pour l'affichage.
// Rouge et orange sont départagés par la teinte réelle des centres.
export function slotColors(result) {
  const out = { ...result.scheme };
  const ro = FACES.filter((f) => out[f] === 'R' || out[f] === 'O');
  if (ro.length === 2) {
    const [a, b] = ro.map((f) => ({ f, h: hueDeg(result.labs[FACES.indexOf(f) * 9 + 4]) }));
    const hueRank = (x) => (x.h > 300 ? x.h - 360 : x.h);
    if (hueRank(a) <= hueRank(b)) { out[a.f] = 'R'; out[b.f] = 'O'; } else { out[a.f] = 'O'; out[b.f] = 'R'; }
  }
  return out;
}

export function rgbCss(rgb) {
  return `rgb(${rgb.map((v) => Math.round(v)).join(',')})`;
}

export { rgbToLab };
