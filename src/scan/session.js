// Session de scan guidé : quelles faces montrer, dans quel ordre et quelle
// orientation, identification de la face montrée, puis reconstruction des
// 54 cases dans la convention du solveur.

import { rgbToLab, labDist, chroma, hueDeg } from '../vision/color.js';
import { scanToCanonical, rotateGrid, FACES } from '../cube/cube.js';
import { assignColors } from '../cube/colors.js';

export const COLOR_INFO = {
  W: { name: 'blanche', short: 'Blanc', css: '#f5f5f0' },
  Y: { name: 'jaune', short: 'Jaune', css: '#ffd60a' },
  R: { name: 'rouge', short: 'Rouge', css: '#ff3b5c' },
  O: { name: 'orange', short: 'Orange', css: '#ff8a1f' },
  B: { name: 'bleue', short: 'Bleu', css: '#2f7bff' },
  G: { name: 'verte', short: 'Vert', css: '#2fd36b' },
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
  if (h < 75) return 'O';
  if (h < 105) return 'Y';
  if (h < 200) return 'G';
  return 'B';
}

export class ScanSession {
  // anyOrder : faces acceptées dans n'importe quel ordre (mode libre).
  constructor({ anyOrder = false } = {}) {
    this.anyOrder = anyOrder;
    this.scans = {}; // couleur -> { labs: [9], rgbs: [9] } (ordre image)
    this.history = [];
  }

  get done() { return Object.keys(this.scans).length === 6; }

  nextStep() {
    return STEPS.find((s) => !this.scans[s.color]) || null;
  }

  // Couleur probable d'un centre (pour les faces voisines) : centre déjà
  // scanné le plus proche, sinon estimation par la teinte.
  colorOf(lab) {
    let near = null;
    for (const [col, sc] of Object.entries(this.scans)) {
      const d = labDist(lab, sc.labs[4]);
      if (!near || d < near.d) near = { col, d };
    }
    if (near && near.d < 14) return near.col;
    return roughColor(lab);
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
    let group = STEPS.find((s) => s.color === color).group;
    if (this.scans[color] || (!this.anyOrder && group !== step.group)) {
      // Teinte ambiguë (orange/jaune, rouge/orange…) : si une couleur encore
      // attendue dans cette étape est proche, c'est sans doute elle.
      const alt = this.ambiguousAlternative(centerLab, this.anyOrder ? null : step.group);
      if (alt) return { color: alt, status: 'ok' };
    }
    if (this.scans[color]) return { color, status: 'already' };
    if (!this.anyOrder && group !== step.group) return { color, status: 'later' };
    return { color, status: 'ok' };
  }

  // top : couleur en haut de l'image (par défaut celle de la consigne).
  ambiguousAlternative(lab, group) {
    const HUE = { R: 25, O: 55, Y: 92, G: 140, B: 265 };
    const c = chroma(lab), h = hueDeg(lab);
    if (c < 25) return null;
    let best = null;
    for (const st of STEPS) {
      if ((group && st.group !== group) || this.scans[st.color] || !(st.color in HUE)) continue;
      let d = Math.abs(h - HUE[st.color]);
      d = Math.min(d, 360 - d);
      if (d <= 24 && (!best || d < best.d)) best = { color: st.color, d };
    }
    if (!best) return null;
    // Pas un centre déjà scanné (sinon c'est bien une face déjà vue).
    for (const sc of Object.values(this.scans)) if (labDist(lab, sc.labs[4]) < 12) return null;
    return best.color;
  }

  accept(color, labs, rgbs, top = null) {
    this.scans[color] = { labs, rgbs, top: top || STEPS.find((s) => s.color === color).top };
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
    // Rouge et orange se départagent par la teinte réelle des deux centres
    // (le rouge est le moins « jaune ») : on corrige les étiquettes d'abord.
    const scans = { ...this.scans };
    if (scans.R && scans.O) {
      const rank = (lab) => { const h = hueDeg(lab); return h > 300 ? h - 360 : h; };
      if (rank(scans.R.labs[4]) > rank(scans.O.labs[4])) [scans.R, scans.O] = [scans.O, scans.R];
    }
    // Le schéma standard d'abord. Le schéma miroir (cube aux couleurs
    // inversées, très rare) n'est retenu que s'il est nettement meilleur : sur
    // un cube presque résolu, les deux sont « possibles » et le miroir serait
    // une erreur.
    const candidates = [WESTERN, { ...WESTERN, R: 'O', L: 'R' }];
    const colors = STEPS.map((s) => s.color);
    let best = null;
    for (const scheme of candidates) {
      const slotOf = Object.fromEntries(Object.entries(scheme).map(([slot, col]) => [col, slot]));
      // rots[c] : quarts de tour supplémentaires appliqués à la face c, au cas
      // où elle aurait été montrée dans un autre sens que celui demandé.
      const build = (rots) => {
        const labs = new Array(54);
        for (const step of STEPS) {
          const slot = slotOf[step.color];
          const topSlot = slotOf[scans[step.color].top];
          const canon = rotateGrid(scanToCanonical(slot, topSlot, scans[step.color].labs), rots[step.color] || 0);
          const f = FACES.indexOf(slot);
          for (let k = 0; k < 9; k++) labs[f * 9 + k] = canon[k];
        }
        return labs;
      };
      // Petits a priori : on préfère la consigne (surtout pour les faces
      // latérales, faciles à tenir droites) et le schéma de couleurs standard.
      const score = (res, rots) => res.cost + (res.valid.ok ? 0 : 1e6) + (res.corrected ? 30 : 0) +
        colors.reduce((t, c) => t + (rots[c] ? (c === 'W' || c === 'Y' ? 15 : 40) : 0), 0) +
        (scheme === WESTERN ? 0 : 250);
      const quick = (rots) => score(assignColors(build(rots), { iterations: 1 }), rots);
      // Blanc et jaune : les 16 combinaisons ; pour chacune, on ajuste les
      // faces latérales une à une tant que ça s'améliore.
      let rots = {}, cur = Infinity;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        let r = { W: a, Y: b }, sc = quick(r);
        for (let pass = 0; pass < 3; pass++) {
          let improved = false;
          for (const c of colors) {
            for (let k = 0; k < 4; k++) {
              if ((r[c] || 0) === k) continue;
              const r2 = { ...r, [c]: k };
              const sc2 = quick(r2);
              if (sc2 < sc - 1e-6) { sc = sc2; r = r2; improved = true; }
            }
          }
          if (!improved) break;
        }
        if (sc < cur) { cur = sc; rots = r; }
      }
      const labs = build(rots);
      const res = assignColors(labs);
      const sc = score(res, rots);
      if (!best || sc < best.score) {
        best = { ...res, scheme, score: sc, labs, rotated: colors.filter((c) => rots[c]) };
      }
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
