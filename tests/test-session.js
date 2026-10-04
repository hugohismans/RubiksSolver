// Simule une session de scan complète (y compris confusion rouge/orange)
// et vérifie qu'on retrouve exactement l'état du cube.
import Cube from 'cubejs';
import { ScanSession, STEPS, slotColors } from '../src/scan/session.js';
import { rgbToLab } from '../src/vision/color.js';
import { FACES, CANONICAL_NEIGHBORS, rotateGrid } from '../src/cube/cube.js';
import { PALETTES } from './lib/synth.js';

const SLOT = { W: 'U', R: 'R', G: 'F', Y: 'D', O: 'L', B: 'B' };
const COLOR = Object.fromEntries(Object.entries(SLOT).map(([c, s]) => [s, c]));

export function run(n = 200) {
  let ok = 0, okSwap = 0, identOk = 0, identTot = 0;
  for (let t = 0; t < n; t++) {
    const state = Cube.random().asString();
    const pal = PALETTES[Object.keys(PALETTES)[t % 3]];
    for (const swapRO of [false, true]) {
      const s = new ScanSession();
      for (const step of STEPS) {
        const slot = SLOT[step.color], top = SLOT[step.top];
        const canon = [...state.slice(FACES.indexOf(slot) * 9, FACES.indexOf(slot) * 9 + 9)];
        const p = CANONICAL_NEIGHBORS[slot].indexOf(top);
        const img = rotateGrid(canon, -p);
        const k = 0.7 + 0.4 * Math.random();
        const labs = img.map((f) => rgbToLab(...pal[COLOR[f]].map((c) => Math.min(255, c * k + (Math.random() - 0.5) * 16))));
        // L'utilisateur montre l'orange quand on demande le rouge (et inversement).
        let label = step.color;
        if (swapRO && label === 'R') label = 'O'; else if (swapRO && label === 'O') label = 'R';
        if (!swapRO) {
          const id = s.identify(labs[4]);
          identTot++;
          if (id.color === step.color && id.status === 'ok') identOk++;
        }
        s.accept(label, labs, labs);
      }
      const r = s.resolve();
      if (r.facelets === state) { if (swapRO) okSwap++; else ok++; }
      const disp = slotColors(r);
      if (disp.R !== 'R' || disp.L !== 'O') console.log('affichage rouge/orange incorrect', disp);
    }
  }
  return { ok, okSwap, n, identOk, identTot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = run(+(process.argv[2] || 200));
  console.log(`exact: ${r.ok}/${r.n}, avec rouge/orange inversés: ${r.okSwap}/${r.n}, identification des centres: ${r.identOk}/${r.identTot}`);
}
