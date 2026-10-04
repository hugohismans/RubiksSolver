// Worker de détection : reçoit une image RGBA, renvoie les faces trouvées.
import { detectFaces } from './detector.js';

self.onmessage = (e) => {
  const { id, width, height, buffer, debug } = e.data;
  const image = { width, height, data: new Uint8ClampedArray(buffer) };
  const t0 = performance.now();
  let res;
  try {
    res = detectFaces(image);
  } catch (err) {
    self.postMessage({ id, error: String(err), width, height, faces: [], buffer }, [buffer]);
    return;
  }
  const faces = res.faces.map((f) => ({
    cells: f.cells, corners: f.corners, center: f.center, area: f.area, roll: f.roll,
    members: f.members, residual: f.residual, solid: f.solid, uniform: f.uniform, score: f.score, squareness: f.squareness,
  }));
  const candidates = debug ? res.candidates.map((c) => c.quad) : null;
  // On renvoie le tampon pour le réutiliser (pas d'allocation à chaque image).
  self.postMessage({ id, ms: performance.now() - t0, width, height, faces, candidates, buffer }, [buffer]);
};
