// Worker classique : algorithme deux phases de Kociemba (bibliothèque cubejs).
// Messages reçus : { id, facelets, maxDepth, improve }
//   improve = true : cherche des solutions de plus en plus courtes et envoie
//   chaque amélioration (le thread principal arrête le worker après un délai).
/* global importScripts, Cube */
importScripts('../../vendor/cubejs/cube.js', '../../vendor/cubejs/solve.js');

let ready = false;
function init() {
  if (!ready) {
    Cube.initSolver();
    ready = true;
    postMessage({ type: 'ready' });
  }
}

self.onmessage = (e) => {
  const { id, facelets, maxDepth = 22, improve = false } = e.data;
  if (e.data.type === 'init') { init(); return; }
  init();
  try {
    const cube = Cube.fromString(facelets);
    if (cube.isSolved()) { postMessage({ type: 'solution', id, moves: '', final: true }); return; }
    let best = cube.solve(maxDepth).trim();
    postMessage({ type: 'solution', id, moves: best, final: !improve });
    if (!improve) return;
    // Recherche de solutions plus courtes (de plus en plus coûteuse).
    for (;;) {
      const n = best.split(/\s+/).length;
      if (n <= 16) break;
      const s = cube.solve(n - 1).trim();
      if (!s || s.split(/\s+/).length >= n) break;
      best = s;
      postMessage({ type: 'solution', id, moves: best, final: false });
    }
    postMessage({ type: 'solution', id, moves: best, final: true });
  } catch (err) {
    postMessage({ type: 'error', id, message: String(err && err.message || err) });
  }
};
