// Interface du solveur : un worker rapide (solution immédiate, ≤ 22 coups)
// et un worker « améliorant » qui cherche plus court pendant quelques secondes.

const WORKER_URL = new URL('./solver-worker.js', import.meta.url);

let fast = null;
let readyPromise = null;

export function warmUp() {
  if (fast) return readyPromise;
  fast = new Worker(WORKER_URL);
  readyPromise = new Promise((resolve) => {
    const onMsg = (e) => { if (e.data.type === 'ready') { fast.removeEventListener('message', onMsg); resolve(); } };
    fast.addEventListener('message', onMsg);
  });
  fast.postMessage({ type: 'init' });
  return readyPromise;
}

let nextId = 1;

// onUpdate(moves, final) est appelé à chaque solution trouvée.
export function solve(facelets, { onUpdate, improveMs = 4000 } = {}) {
  warmUp();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    let best = null;
    let improver = null;
    let timer = null;
    const finish = () => {
      clearTimeout(timer);
      if (improver) improver.terminate();
      improver = null;
      resolve(best);
    };
    const consider = (moves, final) => {
      const n = moves ? moves.split(/\s+/).length : 0;
      if (best === null || n < (best ? best.split(/\s+/).length : 0)) {
        best = moves;
        onUpdate && onUpdate(best, false);
      }
      if (final === 'stop') finish();
    };
    const onFast = (e) => {
      if (e.data.id !== id) return;
      fast.removeEventListener('message', onFast);
      if (e.data.type === 'error') { reject(new Error(e.data.message)); return; }
      consider(e.data.moves);
      if (!best) { finish(); return; }
      // Amélioration dans un worker séparé, interrompu après improveMs.
      improver = new Worker(WORKER_URL);
      improver.onmessage = (ev) => {
        if (ev.data.type !== 'solution') return;
        consider(ev.data.moves);
        if (ev.data.final) finish();
      };
      improver.postMessage({ id, facelets, improve: true });
      timer = setTimeout(finish, improveMs);
    };
    fast.addEventListener('message', onFast);
    fast.postMessage({ id, facelets });
  });
}
