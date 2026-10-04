// Simulation d'un scan libre : le cube tourne devant la caméra (trajectoire
// de poses), chaque image passe par le détecteur puis le modèle 3D.
// Usage : node tests/free-scan-sim.js [style] [palette] [seed]
import Cube from 'cubejs';
import { generate } from './lib/synth.js';
import { detectMultiScale } from '../src/vision/multiscale.js';
import { CubeModel } from '../src/scan/model.js';

const COLOR = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };

// Trajectoire : tour complet (blanc en haut, incliné), puis bascule vers le bas.
export function trajectory(step = 12) {
  const poses = [];
  // L'utilisateur montre d'abord bien le dessus (comme le demande l'app).
  for (let ax = 30; ax <= 60; ax += step) poses.push([ax, 35, 0]);
  for (let ay = 35; ay > 35 - 360; ay -= step) poses.push([30, ay, 0]);
  for (let ax = 30; ax >= -40; ax -= step) poses.push([ax, 35 - 360, 0]);
  for (let ay = 35; ay > 35 - 360; ay -= step * 1.5) poses.push([-38, ay, 0]);
  // … puis le dessous, bien en face (« Montre-moi le dessous »).
  for (let ax = -45; ax >= -70; ax -= 8) poses.push([ax, 20, 0]);
  return poses;
}

export function simulate({ style = 'stickerless', palette = 'neon', seed = 1, state = Cube.random().asString(), verbose = false, realism = !!process.env.REALISM } = {}) {
  const model = new CubeModel();
  model.debug = !!process.env.DEBUG_MODEL;
  const poses = Array.from({ length: +(process.env.LOOPS || 1) }, () => trajectory()).flat();
  let roi = null;
  let done = -1, stats = { ok: 0, lost: 0, ambiguous: 0, none: 0, need2: 0, reset: 0 };
  for (let k = 0; k < poses.length; k++) {
    const { image } = generate(seed, { width: 300, height: 400, style, palette, cube: { state, front: 'F', top: 'U', colorOfSlot: COLOR }, pose: poses[k], tilt: 3, faceFrac: 0.4, logo: true, poseSeed: k, hand: true, background: 'tiles', realism });
    const det = detectMultiScale(image, { hint: roi, trackOnly: !!roi && k % 4 !== 0 });
    roi = det.roi;
    const res = model.update(det.faces);
    stats[res.status]++;
    if (verbose) {
      const p = model.progress();
      console.log(`#${k} pose ${poses[k].map((x) => x.toFixed(0)).join(',')} ${res.status} local=${res.local.length} faces=${p.faces} connues=${p.known}/54`);
    }
    if (done < 0 && model.isComplete()) { done = k; break; }
  }
  const p = model.progress();
  if (verbose) for (const f of model.faces.values()) console.log('face', f.n.join(','), f.color, [...Array(9).keys()].filter((k) => model.cellKnown(f, k)).length, '/9', 'mesures', f.cells.map((c) => c.length).join(' '));
  let exact = false, facelets = null, valid = null;
  if (model.faces.size === 6 && p.known >= 50) {
    const r = model.solve();
    facelets = r.facelets;
    valid = r.valid.ok;
    exact = facelets === state;
  }
  return { done, frames: poses.length, progress: p, stats, exact, valid, state, facelets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [style, palette, seed] = process.argv.slice(2);
  const r = simulate({ style, palette, seed: +(seed || 1), verbose: true });
  console.log(r.stats, 'terminé à l’image', r.done, '/', r.frames);
  console.log('attendu', r.state);
  console.log('obtenu ', r.facelets, r.exact ? 'EXACT ✓' : `(valide: ${r.valid})`);
}
