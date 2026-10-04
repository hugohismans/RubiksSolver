// Mode libre hybride : 6 faces capturées dans un sens quelconque.
import Cube from 'cubejs';
import { resolveHybrid } from '../src/scan/hybrid.js';
import { rgbToLab } from '../src/vision/color.js';
import { FACES, rotateGrid, applyMoves, SOLVED, CANONICAL_NEIGHBORS } from '../src/cube/cube.js';
import { PALETTES } from './lib/synth.js';

const COLOR = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
export async function run(n = 30, nearSolved = false, nRel = 0) {
  let ok = 0, ms = 0, amb = 0, wrongSure = 0;
  for (let t = 0; t < n; t++) {
    const state = nearSolved
      ? applyMoves(SOLVED, Array.from({ length: 1 + (t % 4) }, () => 'URFDLB'[(Math.random() * 6) | 0] + ['', "'", '2'][(Math.random() * 3) | 0]).join(' '))
      : Cube.random().asString();
    const pal = PALETTES[Object.keys(PALETTES)[t % 3]];
    const loose = {}, relations = {};
    FACES.forEach((slot, si) => {
      const k = 0.7 + 0.4 * Math.random();
      const canon = [...state.slice(si * 9, si * 9 + 9)].map((f) => rgbToLab(...pal[COLOR[f]].map((c) => c * k + (Math.random() - 0.5) * 14)));
      const rot = Math.floor(Math.random() * 4);
      loose[COLOR[slot]] = rotateGrid(canon, rot); // sens quelconque
      // Voisine vue en même temps (vue de coin) pour les nRel premières faces.
      if (si < nRel) {
        const q = Math.floor(Math.random() * 4);
        relations[COLOR[slot]] = [{ n: COLOR[CANONICAL_NEIGHBORS[slot][q]], side: (q + rot) % 4 }];
      }
    });
    const t0 = performance.now();
    const r = await resolveHybrid(loose, {}, { relations });
    ms += performance.now() - t0;
    if (r && r.facelets === state) ok++;
    else if (r && r.ambiguous) amb++;
    else if (r) wrongSure++;
  }
  return { ok, n, ms: ms / n, amb, wrongSure };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [ns, rel] of [[false, 0], [true, 0], [true, 2], [true, 4]]) { const r = await run(+(process.argv[2] || 30), ns, rel); console.log(ns ? 'presque résolu' : 'mélangé', `+${rel} voisines`, `exacts ${r.ok}/${r.n}, signalés ambigus ${r.amb}, faux non signalés ${r.wrongSure}`, `${r.ms.toFixed(0)} ms/cube`); }
}
