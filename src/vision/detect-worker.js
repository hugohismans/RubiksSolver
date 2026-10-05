// Worker de détection : reçoit une image RGBA, renvoie les faces trouvées.
import { detectMultiScale } from './multiscale.js';

let lastRoi = null, frame = 0, lastN = 3;

self.onmessage = (e) => {
  const { id, width, height, buffer, debug, base, n = 3 } = e.data;
  const image = { width, height, data: new Uint8ClampedArray(buffer) };
  const t0 = performance.now();
  let res;
  try {
    // Suivi : on analyse la zone du cube ; toutes les 4 images, l'image entière.
    frame++;
    if (n !== lastN) { lastRoi = null; lastN = n; }
    res = detectMultiScale(image, { base, n, hint: lastRoi, trackOnly: !!lastRoi && frame % 4 !== 0 });
    lastRoi = res.roi;
  } catch (err) {
    lastRoi = null;
    self.postMessage({ id, error: String(err), width, height, faces: [], buffer }, [buffer]);
    return;
  }
  const faces = res.faces.map((f) => ({
    cells: f.cells, corners: f.corners, center: f.center, area: f.area, roll: f.roll,
    members: f.members, residual: f.residual, solid: f.solid, predicted: f.predicted, neighborIdx: f.neighborOf ? res.faces.indexOf(f.neighborOf) : -1, uniform: f.uniform, score: f.score, squareness: f.squareness,
  }));
  const candidates = debug ? res.candidates.map((c) => c.quad) : null;
  // On renvoie le tampon pour le réutiliser (pas d'allocation à chaque image).
  self.postMessage({ id, ms: performance.now() - t0, width: res.width, height: res.height, faces, candidates, roi: res.roi, buffer }, [buffer]);
};
