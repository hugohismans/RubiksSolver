// Tests 2x2 / 4x4 : modèle, solveurs, attribution des couleurs, scan guidé.
import { puzzle } from '../src/cube/nxn.js';
import { solve222 } from '../src/solver/solve222.js';
import { solve444, initialize } from '../src/solver/solve444.js';
import { assignColorsNxN } from '../src/cube/colors-nxn.js';
import { NxNSession, rotateGridN } from '../src/scan/session-nxn.js';
import { rgbToLab } from '../src/vision/color.js';
import { PALETTES } from './lib/synth.js';
import Cube from 'cubejs';

const WEST = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const rnd = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

export function scramble(N, r, len = 40) {
  const P = puzzle(N);
  const moves = N === 2 ? ['U', 'R', 'F'] : ['U', 'R', 'F', 'D', 'L', 'B', 'Uw', 'Rw', 'Fw'];
  const seq = [];
  for (let i = 0; i < len; i++) seq.push(moves[Math.floor(r() * moves.length)] + ['', "'", '2'][Math.floor(r() * 3)]);
  return P.apply(P.solved, seq.join(' '));
}

const sameUpToRelabel = (a, b) => {
  const m = {};
  for (let i = 0; i < a.length; i++) { if (m[a[i]] === undefined) m[a[i]] = b[i]; else if (m[a[i]] !== b[i]) return false; }
  return new Set(Object.values(m)).size === Object.keys(m).length;
};

export function runNxN(log = console.log) {
  let fails = 0;
  const check = (name, ok) => { if (!ok) { fails++; log(`  ÉCHEC ${name}`); } };
  // Solveurs.
  const r = rnd(7);
  for (let t = 0; t < 20; t++) {
    const P = puzzle(2), s = scramble(2, r);
    const sol = solve222(s);
    check('2x2 résolu', P.isSolved(P.apply(s, sol)) && (sol ? sol.split(' ').length : 0) <= 11);
  }
  initialize();
  Cube.initSolver();
  for (let t = 0; t < 4; t++) {
    const P = puzzle(4), s = scramble(4, r, 50);
    const sol = solve444(s, (f) => Cube.fromString(f).solve());
    check('4x4 résolu', P.isSolved(P.apply(s, sol)));
  }
  // Scan guidé simulé (bruit, schéma de couleurs, gestes imprécis).
  for (const N of [2, 4]) {
    for (let t = 0; t < 8; t++) {
      const P = puzzle(N), n2 = N * N, s = scramble(N, r);
      const pal = PALETTES[['classic', 'neon', 'pastel'][t % 3]];
      const lab = (L) => rgbToLab(...pal[WEST[L]].map((v) => v + (r() - 0.5) * 16));
      const grid = (f) => [...s.slice(f * n2, f * n2 + n2)].map(lab);
      const right = t % 2 === 1; // l'utilisateur tourne vers la droite
      const capA = t % 4, capB = (t * 3) % 4;
      const sess = new NxNSession(N);
      const order = right ? ['F', 'L', 'B', 'R'] : ['F', 'R', 'B', 'L'];
      for (const f of order) sess.accept(grid('URFDLB'.indexOf(f)));
      sess.accept(rotateGridN(grid(0), 4 - capA, N));
      sess.accept(rotateGridN(grid(3), 4 - capB, N));
      const res = sess.resolve();
      check(`scan ${N}x${N} #${t}`, res && res.valid.ok && sameUpToRelabel(s, res.facelets));
      check(`noms ${N}x${N} #${t}`, res && Object.values(res.colorOf).sort().join('') === 'BGORWY');
    }
  }
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = runNxN();
  console.log(f ? `${f} échec(s)` : 'nxn ok');
  process.exit(f ? 1 : 0);
}
