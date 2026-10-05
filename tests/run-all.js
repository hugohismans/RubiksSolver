// Suite de tests rapide : npm test
//   - modèle du cube comparé à cubejs
//   - attribution des couleurs, session de scan (orientation, rouge/orange)
//   - détecteur : photo réelle + 120 images synthétiques (seuils minimaux)
// Les tests E2E navigateur (fausse caméra) sont à part : voir README.
import Cube from 'cubejs';
import { applyMoves, SOLVED, validateFacelets, invertMoves } from '../src/cube/cube.js';
import { run as runColors } from './test-colors.js';
import { run as runSession } from './test-session.js';
import { loadImage, resize } from './lib/image.js';
import { detectFaces } from '../src/vision/detector.js';
import { generate, COLORS } from './lib/synth.js';
import { rgbToLab, labDist } from '../src/vision/color.js';
import { simulate } from './free-scan-sim.js';
import { run as runHybrid } from './test-hybrid.js';
import { detectMultiScale } from '../src/vision/multiscale.js';
import { roughColor } from '../src/scan/model.js';
import { fold, ROTATIONS } from '../src/scan/model.js';
import { runNxN } from './test-nxn.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

// 1. Mouvements
{
  let ok = 0;
  for (let k = 0; k < 200; k++) {
    const mv = Array.from({ length: 25 }, () => 'URFDLB'[(Math.random() * 6) | 0] + ['', "'", '2'][(Math.random() * 3) | 0]).join(' ');
    const c = new Cube(); c.move(mv);
    const mine = applyMoves(SOLVED, mv);
    if (c.asString() === mine && validateFacelets(mine).ok && applyMoves(mine, invertMoves(mv)) === SOLVED) ok++;
  }
  check('mouvements identiques à cubejs', ok === 200, `${ok}/200`);
  const bad = SOLVED.slice(0, 8) + 'R' + SOLVED.slice(9);
  check('validation rejette un cube impossible', !validateFacelets(bad).ok);
}

// 2. Couleurs et session
{
  const r = runColors(300);
  check('attribution des couleurs (cubes simulés)', r.exact >= 297, `${r.exact}/${r.n}`);
  const s = runSession(60);
  check('session de scan', s.ok === s.n && s.okSwap === s.n, `${s.ok}/${s.n}, rouge/orange inversés ${s.okSwap}/${s.n}`);
  check('identification des centres', s.identOk >= s.identTot * 0.98, `${s.identOk}/${s.identTot}`);
  const t = runSession(60, true);
  const ns = runSession(60, false, true);
  check('cube presque résolu (pas de confusion miroir)', ns.ok === ns.n && ns.okSwap === ns.n, `${ns.ok}/${ns.n}, rouge/orange inversés ${ns.okSwap}/${ns.n}`);
  // Faces en plus tournées au hasard : quelques cas sont réellement ambigus.
  const nr = runSession(60, true, true);
  check('presque résolu + faces tournées', nr.ok >= 54 && nr.okSwap >= 54, `${nr.ok}/${nr.n}, ${nr.okSwap}/${nr.n}`);
  check('faces montrées dans le mauvais sens', t.ok >= 58 && t.okSwap >= 58, `${t.ok}/${t.n}, ${t.okSwap}/${t.n}`);
}

// 3. Détecteur
{
  const img = resize(loadImage('tests/fixtures/gan-corner.jpg'), 480);
  const res = detectFaces(img);
  const white = res.faces.find((f) => f.cells.every((c) => c.lab[0] > 80 && Math.hypot(c.lab[1], c.lab[2]) < 20));
  check('photo réelle : face blanche (avec logo) trouvée', !!white, `${res.faces.length} face(s)`);
  let found = 0, cells = 0, ok = 0, fp = 0;
  const N = 120;
  for (let s = 5000; s < 5000 + N; s++) {
    const { image, gt } = generate(s, { width: 300, height: 400 });
    const r = detectFaces(image);
    const mask = Buffer.from(gt.mask, 'base64');
    fp += r.faces.filter((f) => !mask[Math.round(f.center[1]) * image.width + Math.round(f.center[0])]).length;
    const cell = Math.hypot(gt.centers[0][0] - gt.centers[1][0], gt.centers[0][1] - gt.centers[1][1]);
    const m = r.faces.find((f) => f.cells.every((c, k) => Math.hypot(c.x - gt.centers[k][0], c.y - gt.centers[k][1]) < 0.3 * cell));
    if (!m) continue;
    found++;
    const refs = COLORS.map((c) => rgbToLab(...gt.palette[c]));
    m.cells.forEach((c, k) => {
      let best = 0, bd = 1e9;
      refs.forEach((rf, i) => { const d = labDist(c.lab, rf); if (d < bd) { bd = d; best = i; } });
      cells++;
      if (COLORS[best] === gt.colors[k]) ok++;
    });
  }
  check('détecteur : images synthétiques', found >= N * 0.85, `${found}/${N} faces trouvées, ${fp} faux positifs, ${((100 * ok) / cells).toFixed(1)}% cases bien lues`);
}

// 3b. Photos réelles en vue de coin (GAN sans stickers) : deux faces par photo,
// centres vérifiés à l'œil.
{
  const expect = { 1: ['G', 'Y'], 2: ['G', 'W'], 3: ['B', 'R'] };
  for (const [i, centers] of Object.entries(expect)) {
    const r = detectMultiScale(resize(loadImage(`tests/fixtures/real-${i}.jpg`), 960));
    const got = r.faces.map((f) => roughColor(f.cells[4].lab)).sort();
    check(`photo réelle ${i} (vue de coin)`, got.join() === centers.slice().sort().join(), `centres lus : ${got.join(' ') || 'aucun'}`);
  }
}

// 3c. Mode libre : faces dans un sens quelconque.
{
  const a = await runHybrid(10, false, 0);
  check('mode libre : faces dans un sens quelconque', a.ok === a.n, `${a.ok}/${a.n}`);
  const b = await runHybrid(10, true, 0);
  check('mode libre : jamais de cube faux sans le signaler', b.wrongSure === 0, `${b.ok} exacts, ${b.amb} signalés ambigus`);
  const c = await runHybrid(10, true, 2);
  check('mode libre : une vue de coin lève l’ambiguïté', c.ok === c.n, `${c.ok}/${c.n}`);
}

// 3d. Vidéo réelle (iPhone, lumière chaude, cube tenu par un coin) : les
// deux faces bien visibles doivent être capturées vite, sans doublon.
{
  const { FreeCapture } = await import('../src/scan/freecapture.js');
  const fs = await import('node:fs');
  const dir = 'tests/fixtures/rec1';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  const cap = new FreeCapture();
  let roi = null, firstAt = null;
  files.forEach((f, k) => {
    const r = detectMultiScale(loadImage(`${dir}/${f}`), { hint: roi, trackOnly: !!roi && k % 4 !== 0 });
    roi = r.roi;
    const u = cap.update(r.faces, (k * 1000) / 8);
    if (u.captured.length && firstAt === null) firstAt = k / 8;
  });
  check('vidéo réelle : captures rapides et sans doublon', cap.count === 2 && firstAt !== null && firstAt < 3.5, `${cap.count} faces, première à ${firstAt}s`);
}

// 4. Scan libre (modèle 3D)
{
  check('24 rotations du cube', ROTATIONS.length === 24);
  // Repliage : la face du dessus d'une face avant (n = +z, lecture x/-y).
  const top = fold({ n: [0, 0, 1], ex: [1, 0, 0], ey: [0, -1, 0] }, 0, 2);
  check('repliage d’une face voisine', top && top.n.join() === '0,1,0' && top.ex.join() === '1,0,0' && top.ey.join() === '0,0,1');
  let exact = 0;
  const runs = [['stickerless', 'neon', 21], ['black', 'classic', 22]];
  for (const [style, palette, seed] of runs) if (simulate({ style, palette, seed }).exact) exact++;
  check('scan libre simulé (cube qui tourne)', exact === runs.length, `${exact}/${runs.length} cubes exacts`);
}

// 5. 2x2 et 4x4
{
  check('2x2 / 4x4 : solveurs, couleurs, scan guidé simulé', runNxN() === 0);
  for (const n of [2, 4]) {
    let found = 0;
    for (let s = 1; s <= 20; s++) {
      const { image, gt } = generate(s, { n, style: s % 2 ? 'black' : 'stickerless' });
      const cell = Math.hypot(gt.centers[0][0] - gt.centers[1][0], gt.centers[0][1] - gt.centers[1][1]);
      if (detectFaces(image, { n }).faces.some((f) => f.cells.every((c, k) => Math.hypot(c.x - gt.centers[k][0], c.y - gt.centers[k][1]) < 0.3 * cell))) found++;
    }
    check(`détection ${n}x${n} (synthétique)`, found >= (n === 2 ? 14 : 16), `${found}/20`);
  }
}

console.log(failed ? `\n${failed} test(s) en échec` : '\nTous les tests passent.');
process.exit(failed ? 1 : 0);
