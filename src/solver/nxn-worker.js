// Worker (module) des cubes 2x2 et 4x4.
// Messages reçus : { id, N, facelets } ou { type: 'init', N }.
import { solve222 } from './solve222.js';
import { solve444, initialize } from './solve444.js';

let Cube = null;
// cubejs est un script classique : on l'évalue avec `self` comme global.
async function loadCubejs() {
  if (Cube) return Cube;
  for (const f of ['cube.js', 'solve.js']) {
    const src = await (await fetch(new URL(`../../vendor/cubejs/${f}`, import.meta.url))).text();
    new Function(src).call(self);
  }
  Cube = self.Cube;
  Cube.initSolver();
  return Cube;
}

async function prepare(N) {
  if (N === 4) { initialize(); await loadCubejs(); }
}

self.onmessage = async (e) => {
  const { id, N, facelets, type } = e.data;
  try {
    await prepare(N);
    if (type === 'init') { postMessage({ type: 'ready', N }); return; }
    const moves = N === 2 ? solve222(facelets) : solve444(facelets, (f) => Cube.fromString(f).solve());
    postMessage({ type: 'solution', id, moves, final: true });
  } catch (err) {
    postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  }
};
