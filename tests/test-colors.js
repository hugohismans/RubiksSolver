// Test de l'attribution des couleurs sur des cubes aléatoires simulés
// (palette réaliste, éclairage différent par face, bruit, reflets).
import Cube from 'cubejs';
import { assignColors } from '../src/cube/colors.js';
import { rgbToLab } from '../src/vision/color.js';
import { FACES } from '../src/cube/cube.js';
import { PALETTES } from './lib/synth.js';

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const range = (a, b) => a + (b - a) * rnd();
const colorOf = { U: 'W', D: 'Y', F: 'G', B: 'B', R: 'R', L: 'O' };

export function run(n = 500, verbose = false) {
  let exact = 0, flaggedAll = 0;
  for (let t = 0; t < n; t++) {
    const state = Cube.random().asString();
    const pal = PALETTES[Object.keys(PALETTES)[t % 3]];
    const labs = [];
    for (let f = 0; f < 6; f++) {
      // Éclairage propre à chaque face (exposition + dominante).
      const k = range(0.6, 1.15), cast = [range(0.9, 1.1), range(0.95, 1.05), range(0.88, 1.12)];
      for (let i = 0; i < 9; i++) {
        const rgb = pal[colorOf[state[f * 9 + i]]].map((c, j) => Math.max(0, Math.min(255, c * k * cast[j] + range(-10, 10))));
        let lab = rgbToLab(...rgb);
        if (rnd() < 0.03) lab = [Math.min(100, lab[0] + 15), lab[1] * 0.6, lab[2] * 0.6]; // reflet
        labs.push(lab);
      }
    }
    const res = assignColors(labs);
    const ok = res.facelets === state;
    if (ok) exact++;
    else {
      const wrong = [...state].map((c, i) => (c !== res.facelets[i] ? i : -1)).filter((i) => i >= 0);
      if (wrong.every((i) => res.uncertain.has(i))) flaggedAll++;
      if (verbose) console.log('erreur', wrong.length, 'cases, signalées:', wrong.filter((i) => res.uncertain.has(i)).length);
    }
  }
  return { exact, n, flaggedAll };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = run(+(process.argv[2] || 500), true);
  console.log(`cubes exacts: ${r.exact}/${r.n}, erreurs toutes signalées: ${r.flaggedAll}/${r.n - r.exact}`);
}
