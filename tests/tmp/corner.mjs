// Vue de coin : combien des faces visibles sont détectées, et sont-elles reliées ?
import { generate } from '../lib/synth.js';
import { detectFaces } from '../../src/vision/detector.js';
import { adjacentFaces } from '../../src/scan/orientation.js';
import { applyMoves, SOLVED } from '../../src/cube/cube.js';
import { savePng, clone, drawPoly } from '../lib/image.js';
const COLOR = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const state = applyMoves(SOLVED, "R U F' L2 D B' R2 U' F L' D2 B U2 R'");
const style = process.argv[2] || 'black';
const pose = (process.argv[3] || '30,35').split(',').map(Number);
let tot = { faces: 0, adj: 0, n: 0, two: 0, three: 0 };
for (let s = 0; s < 20; s++) {
  const r = generate(100 + s, { width: 300, height: 400, style, palette: 'neon', cube: { state, front: 'F', top: 'U', colorOfSlot: COLOR }, pose: [pose[0], pose[1], 0], tilt: 6, faceFrac: 0.38, logo: true });
  const res = detectFaces(r.image);
  const mask = Buffer.from(r.gt.mask, 'base64');
  const on = res.faces.filter((f) => mask[Math.round(f.center[1]) * 300 + Math.round(f.center[0])]);
  let adj = 0;
  for (const f of on) adj += adjacentFaces(f, on).length;
  tot.n++; tot.faces += on.length; tot.adj += adj / 2;
  if (on.length >= 2) tot.two++;
  if (on.length >= 3) tot.three++;
  if (s < 2) { const d = clone(r.image); for (const f of res.faces) drawPoly(d, f.corners, [255, 255, 0]); for (const c of res.candidates) drawPoly(d, c.quad, [255, 0, 255]); savePng(d, `tests/out/corner-${style}-${s}.png`); }
}
console.log(style, pose.join(','), `faces/image ${(tot.faces / tot.n).toFixed(2)}, ≥2: ${tot.two}/20, ≥3: ${tot.three}/20, arêtes communes/image ${(tot.adj / tot.n).toFixed(2)}`);
