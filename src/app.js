// Application : accueil -> scan guidé -> vérification -> solution 3D.

import { Cube3D } from './render/cube3d.js';
import { Scanner } from './scan/scanner.js';
import { ScanSession, STEPS, COLOR_INFO, slotColors } from './scan/session.js';
import { scanToCanonical, FACES, SOLVED, validateFacelets, parseMoves, applyMoves } from './cube/cube.js';
import { labDist, labToRgb, chroma, hueDeg } from './vision/color.js';
import { detectFaces } from './vision/detector.js';
import { solve, warmUp } from './solver/solver.js';
import { adjacentFaces, topFromNeighbor } from './scan/orientation.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

// Schéma standard : couleur -> face du solveur (sert au guide et à la saisie).
const SLOT_OF = { W: 'U', R: 'R', G: 'F', Y: 'D', O: 'L', B: 'B' };
const WESTERN_SLOTS = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const FACE_FR = { U: 'haut', D: 'bas', F: 'avant', B: 'arrière', R: 'droite', L: 'gauche' };

const chip = (key, text) => `<span class="chip" style="background:${COLOR_INFO[key].css}">${text || COLOR_INFO[key].name}</span>`;

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

// ---------------------------------------------------------------- Accueil
let homeCube = null;
function initHome() {
  homeCube = new Cube3D($('home-cube'), { interactive: true });
  homeCube.speed = 0.8;
  // Petite animation : mélange puis rotation lente.
  const moves = 'R U F2 L\' D B R2 U\' F'.split(' ');
  let k = 0;
  const spin = () => {
    if (!document.getElementById('home').classList.contains('active')) { setTimeout(spin, 1000); return; }
    const m = parseMoves(moves[k % moves.length])[0];
    k++;
    homeCube.move(m.face, m.turns, 380).then(() => setTimeout(spin, 350));
  };
  setTimeout(spin, 800);
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('home-note').textContent = 'La caméra n’est disponible qu’en HTTPS. Tu peux quand même importer des photos ou saisir les couleurs.';
  }
  $('btn-scan').onclick = () => startScan();
  $('btn-manual').onclick = () => openReview(manualResult());
  warmUp();
}

// ---------------------------------------------------------------- Scan
const scan = {
  session: null, scanner: null, guide: null, track: null, cooldownUntil: 0, lastResult: null,
};

async function startScan() {
  show('scan');
  scan.session = new ScanSession();
  scan.track = null;
  if (!scan.guide) scan.guide = new Cube3D($('guide'), { interactive: false, distance: 12 });
  updateScanUI();
  $('scan-error').hidden = true;
  const overlay = $('overlay');
  if (!scan.scanner) {
    scan.scanner = new Scanner($('video'), overlay, { onResult: onDetection, debug: DEBUG });
  }
  try {
    await scan.scanner.start();
    $('torch').hidden = !scan.scanner.torchSupported;
  } catch (err) {
    const box = $('scan-error');
    box.hidden = false;
    box.innerHTML = `<h2>Caméra indisponible</h2>
      <p class="small">${err && err.name === 'NotAllowedError'
        ? 'L’accès à la caméra a été refusé. Autorise-le dans les réglages du navigateur, puis réessaie.'
        : 'Impossible d’ouvrir la caméra (' + (err && err.message || err) + '). Elle nécessite une page en HTTPS.'}</p>
      <button class="primary" id="err-retry">Réessayer</button>
      <button class="ghost" id="err-photo">Importer des photos à la place</button>
      <button class="ghost" id="err-home">Retour</button>`;
    $('err-retry').onclick = () => startScan();
    $('err-photo').onclick = () => { box.hidden = true; $('photo-input').click(); };
    $('err-home').onclick = () => { stopScan(); show('home'); };
  }
}

function stopScan() {
  if (scan.scanner) scan.scanner.stop();
}

function stepCells(color) {
  const sc = scan.session.scans[color];
  if (!sc) return null;
  return sc.rgbs.map((rgb) => `rgb(${rgb.join(',')})`);
}

function updateScanUI() {
  const s = scan.session;
  const step = s.nextStep();
  // Pastilles de progression.
  $('steps').innerHTML = STEPS.map((st) => {
    const cells = stepCells(st.color);
    const cur = step && st.color === step.color;
    const inner = cells
      ? cells.map((c) => `<span style="background:${c}"></span>`).join('')
      : Array.from({ length: 9 }, (_, i) => `<span style="background:${i === 4 ? COLOR_INFO[st.color].css : 'transparent'}"></span>`).join('');
    return `<div class="step${cur ? ' current' : ''}" title="Face ${COLOR_INFO[st.color].name}">${inner}</div>`;
  }).join('');
  $('scan-undo').disabled = s.history.length === 0;
  if (!step) return;
  const first = s.history.length === 0;
  if (step.group === 'side') {
    $('instr-main').innerHTML = `Montre la face ${chip(step.color)}`;
    $('instr-sub').innerHTML = `${chip('W', 'Blanc')} en haut. ${first ? 'Tiens le cube à 20–30 cm, bien éclairé, face bien droite.' : 'Tourne le cube sur lui-même, le blanc reste en haut.'}`;
  } else {
    $('instr-main').innerHTML = `Montre la face ${chip(step.color)}`;
    $('instr-sub').innerHTML = `Avec la face ${chip(step.top)} en haut.`;
  }
  // Guide 3D : orientation attendue, faces déjà scannées en vraies couleurs.
  const css = new Array(54).fill('#3a3d46');
  for (const st of STEPS) {
    const slot = SLOT_OF[st.color];
    const f = FACES.indexOf(slot);
    const cells = stepCells(st.color);
    const actualTop = cells ? scan.session.scans[st.color].top : st.top;
    const canon = cells ? scanToCanonical(slot, SLOT_OF[actualTop], cells) : null;
    for (let k = 0; k < 9; k++) css[f * 9 + k] = canon ? canon[k] : k === 4 ? COLOR_INFO[st.color].css : '#3a3d46';
  }
  scan.guide.setStickerColors(css);
  scan.guide.setView(SLOT_OF[step.color], SLOT_OF[step.top], true, [0.35, -0.45]);
}

function setHint(text) {
  const h = $('hint');
  if (h.textContent !== text) h.textContent = text;
}

// Choisit, parmi les faces détectées, celle qui nous intéresse.
function pickFace(res) {
  let best = null;
  for (const f of res.faces) {
    const id = scan.session.identify(f.cells[4].lab);
    const rank = (id.status === 'ok' ? 100 : id.status === 'already' ? 10 : 0) + f.score;
    if (!best || rank > best.rank) best = { face: f, id, rank };
  }
  return best;
}

const STABLE_FRAMES = 6;
const STABLE_MS = 650;

function onDetection(res) {
  scan.lastResult = res;
  const s = scan.session;
  const step = s.nextStep();
  drawOverlay(res, null);
  if (!step || $('scan').classList.contains('active') === false) return;
  const now = performance.now();
  if (now < scan.cooldownUntil) return;
  const pick = pickFace(res);
  let progress = 0;
  if (!pick) {
    setHint(res.faces.length ? '' : 'Je cherche le cube… remplis bien le cadre avec une face');
    scan.track = null;
  } else {
    const { face, id } = pick;
    const areaFrac = face.area / (res.width * res.height);
    drawOverlay(res, pick);
    if (id.status === 'already') {
      setHint(`Face ${COLOR_INFO[id.color].name} déjà scannée — montre la face ${COLOR_INFO[step.color].name}`);
      scan.track = null;
    } else if (id.status === 'later') {
      setHint(`C’est la face ${COLOR_INFO[id.color].name} : on la fera à la fin`);
      scan.track = null;
    } else if (id.status !== 'ok') {
      setHint('Couleur du centre pas claire — évite les reflets');
      scan.track = null;
    } else if (areaFrac < 0.025) {
      setHint('Approche le cube');
      scan.track = null;
    } else if (Math.abs(face.roll) > 28) {
      setHint('Redresse le cube (face bien droite)');
      scan.track = null;
    } else {
      // Suivi : la même face, des couleurs stables d'une image à l'autre.
      const labs = face.cells.map((c) => c.lab);
      const t = scan.track;
      const same = t && t.color === id.color && t.frames[t.frames.length - 1].every((l, k) => labDist(l, labs[k]) < 14);
      if (same) t.frames.push(labs);
      else scan.track = { color: id.color, frames: [labs], t0: now };
      const tr = scan.track;
      // Doigt sur une case ? (teinte « peau » peu saturée, loin des centres connus)
      const fingers = face.cells.some((c) => looksLikeSkin(c.lab));
      if (fingers) tr.skin = (tr.skin || 0) + 1;
      // Orientation : une face voisine visible indique la couleur du haut.
      const top = voteTop(face, id.color, res.faces);
      if (top) tr.topVotes = [...(tr.topVotes || []), top];
      const needMs = STABLE_MS + (tr.skin ? 1500 : 0);
      progress = Math.min(1, tr.frames.length / STABLE_FRAMES, (now - tr.t0) / needMs);
      setHint(fingers ? 'Attention : un doigt cache peut-être une case'
        : id.color === step.color ? 'Ne bouge plus…' : `Face ${COLOR_INFO[id.color].name} — ne bouge plus…`);
      if (tr.frames.length >= STABLE_FRAMES && now - tr.t0 >= needMs) capture(tr);
    }
  }
  $('stability-bar').style.width = `${Math.round(progress * 100)}%`;
}

function looksLikeSkin(lab) {
  const c = chroma(lab), h = hueDeg(lab);
  if (!(c > 12 && c < 32 && h > 25 && h < 70 && lab[0] > 40 && lab[0] < 88)) return false;
  // Une vraie couleur du cube déjà mesurée (orange pâle, blanc chaud…) ?
  return !Object.values(scan.session.scans).some((sc) => labDist(lab, sc.labs[4]) < 18);
}

function medianLab(list) {
  return [0, 1, 2].map((c) => {
    const v = list.map((l) => l[c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
}

// Faces voisines fiables : pour une face latérale, le blanc ou le jaune
// (au-dessus ou en dessous) ; pour blanc/jaune, le bleu ou le vert. Ces
// positions ne dépendent pas du sens rouge/orange du cube.
function voteTop(face, color, faces) {
  const trusted = color === 'W' || color === 'Y' ? ['B', 'G'] : ['W', 'Y'];
  const tops = [];
  for (const { face: n, side } of adjacentFaces(face, faces)) {
    const nc = scan.session.colorOf(n.cells[4].lab);
    if (!trusted.includes(nc)) continue;
    const t = topFromNeighbor(color, nc, side);
    if (t) tops.push(t);
  }
  return tops.length && tops.every((t) => t === tops[0]) ? tops[0] : null;
}

function capture(track) {
  const labs = Array.from({ length: 9 }, (_, k) => medianLab(track.frames.map((f) => f[k])));
  // Orientation détectée sur plusieurs images concordantes ?
  let top = null;
  const votes = track.topVotes || [];
  if (votes.length >= Math.max(3, track.frames.length * 0.5)) {
    const counts = {};
    votes.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n >= votes.length * 0.9) top = best;
  }
  acceptFace(track.color, labs, top);
}

function acceptFace(color, labs, top = null) {
  const rgbs = labs.map((l) => labToRgb(...l));
  const expectedTop = STEPS.find((s) => s.color === color).top;
  scan.session.accept(color, labs, rgbs, top);
  scan.track = null;
  scan.cooldownUntil = performance.now() + 900;
  const fl = $('flash');
  fl.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove('on')));
  if (navigator.vibrate) navigator.vibrate(60);
  beep();
  setHint(top && top !== expectedTop
    ? `Face ${COLOR_INFO[color].name} enregistrée ✓ (${COLOR_INFO[top].short.toLowerCase()} en haut, détecté)`
    : `Face ${COLOR_INFO[color].name} enregistrée ✓`);
  $('stability-bar').style.width = '0%';
  updateScanUI();
  if (scan.session.done) {
    setTimeout(() => {
      stopScan();
      openReview(scan.session.resolve());
    }, 500);
  }
}

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.16);
  } catch { /* pas de son, tant pis */ }
}

function drawOverlay(res, pick) {
  const c = $('overlay');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!scan.scanner || !scan.scanner.video.videoWidth) return;
  const map = scan.scanner.mapper();
  if (DEBUG && res.candidates) {
    ctx.strokeStyle = 'rgba(255,0,255,0.6)';
    ctx.lineWidth = 1;
    for (const q of res.candidates) { ctx.beginPath(); q.map(map).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); }
  }
  for (const f of res.faces) {
    const isPick = pick && pick.face === f;
    const pts = f.corners.map(map);
    ctx.lineWidth = isPick ? 3 : 1.5;
    const ok = isPick && pick.id.status === 'ok';
    ctx.strokeStyle = isPick ? (ok ? 'rgba(52,199,89,0.95)' : 'rgba(255,176,32,0.95)') : 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    if (!isPick) continue;
    // Grille intérieure (lignes à 1/3 et 2/3) et couleurs lues.
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    ctx.lineWidth = 1.5;
    for (const t of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      let a = lerp(pts[0], pts[1], t), b = lerp(pts[3], pts[2], t);
      ctx.moveTo(...a); ctx.lineTo(...b);
      a = lerp(pts[0], pts[3], t); b = lerp(pts[1], pts[2], t);
      ctx.moveTo(...a); ctx.lineTo(...b);
      ctx.stroke();
    }
    const side = Math.sqrt(Math.abs(f.area)) * (c.clientWidth / (res.width * 1.0)) / 3;
    for (const cell of f.cells) {
      const [x, y] = map([cell.x, cell.y]);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(6, Math.min(16, side * 0.16)), 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${cell.rgb.join(',')})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }
  if (DEBUG) {
    ctx.fillStyle = 'white';
    ctx.font = '12px monospace';
    ctx.fillText(`${res.ms ? res.ms.toFixed(0) : '?'} ms, ${res.faces.length} face(s)`, 10, h - 10);
  }
}

// Import d'une photo (secours si pas de caméra, ou pour tester).
async function importPhoto(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s);
  cv.height = Math.round(bmp.height * s);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const res = detectFaces(ctx.getImageData(0, 0, cv.width, cv.height));
  const pick = pickFace(res);
  if (!pick || pick.id.status !== 'ok') {
    setHint(pick ? `Photo : face ${COLOR_INFO[pick.id.color]?.name || '?'} non attendue ici` : 'Photo : aucune face reconnue');
    return;
  }
  acceptFace(pick.id.color, pick.face.cells.map((c) => c.lab));
}

function initScan() {
  $('scan-back').onclick = () => { stopScan(); show('home'); };
  $('scan-undo').onclick = () => {
    const c = scan.session.undo();
    if (c) setHint(`Face ${COLOR_INFO[c].name} effacée`);
    updateScanUI();
  };
  let torch = false;
  $('torch').onclick = async () => { torch = !torch; await scan.scanner.setTorch(torch); };
  $('scan-photo').onclick = () => $('photo-input').click();
  $('photo-input').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!scan.session) scan.session = new ScanSession();
    if (!$('scan').classList.contains('active')) { show('scan'); updateScanUI(); }
    await importPhoto(f);
  };
}

// ---------------------------------------------------------------- Vérification
const review = { facelets: null, uncertain: new Set(), slotKey: null, selected: -1 };

function manualResult() {
  const facelets = FACES.map((f) => '?'.repeat(4) + f + '?'.repeat(4)).join('');
  return { facelets, uncertain: new Set(), scheme: WESTERN_SLOTS, manual: true };
}

function openReview(result) {
  review.facelets = result.facelets.split('');
  review.uncertain = new Set(result.uncertain || []);
  review.slotKey = result.manual ? { ...WESTERN_SLOTS } : slotColors(result);
  review.selected = -1;
  review.corrected = result.corrected;
  review.rotated = result.rotated || [];
  show('review');
  renderReview();
}

const NET_POS = { U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] };

function slotCss(slot) {
  return slot === '?' ? '#2a2e37' : COLOR_INFO[review.slotKey[slot]].css;
}

function renderReview() {
  const grid = Array.from({ length: 9 }, () => new Array(12).fill(-1));
  FACES.forEach((f, fi) => {
    const [c0, r0] = NET_POS[f];
    for (let k = 0; k < 9; k++) grid[r0 + Math.floor(k / 3)][c0 + (k % 3)] = fi * 9 + k;
  });
  $('net').innerHTML = grid.flat().map((i) => {
    if (i < 0) return '<div class="gap"></div>';
    const cls = ['cell', i % 9 === 4 ? 'center' : '', review.uncertain.has(i) ? 'unsure' : '', review.selected === i ? 'selected' : ''].join(' ');
    return `<button class="${cls}" data-i="${i}" style="background:${slotCss(review.facelets[i])}" aria-label="case ${i}"></button>`;
  }).join('');
  $('net').querySelectorAll('.cell').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i;
      if (i % 9 === 4) return; // les centres sont fixes
      review.selected = review.selected === i ? -1 : i;
      renderReview();
    };
  });
  $('palette').innerHTML = FACES.map((f) => `<button data-f="${f}" class="${review.selected >= 0 && review.facelets[review.selected] === f ? 'on' : ''}" style="background:${slotCss(f)}" aria-label="${COLOR_INFO[review.slotKey[f]].short}"></button>`).join('');
  $('palette').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      if (review.selected < 0) return;
      review.facelets[review.selected] = b.dataset.f;
      review.uncertain.delete(review.selected);
      // Passe automatiquement à la case suivante à remplir (saisie manuelle).
      const next = review.facelets.findIndex((c, k) => c === '?' && k > review.selected);
      review.selected = next;
      renderReview();
    };
  });
  const s = review.facelets.join('');
  const missing = s.split('').filter((c) => c === '?').length;
  const msg = $('review-msg');
  let ok = false;
  if (missing) {
    msg.className = 'msg';
    msg.textContent = `Il reste ${missing} case${missing > 1 ? 's' : ''} à remplir (touche une case, puis une couleur).`;
  } else {
    const v = validateFacelets(s);
    ok = v.ok;
    msg.className = `msg ${v.ok ? 'ok' : 'err'}`;
    const rot = review.rotated.length
      ? ` J’ai remis dans le bon sens : face${review.rotated.length > 1 ? 's' : ''} ${review.rotated.map((c) => COLOR_INFO[c].name).join(', ')}.`
      : '';
    msg.textContent = v.ok
      ? (review.uncertain.size ? `Cube cohérent ✓ — vérifie quand même les ${review.uncertain.size} cases qui clignotent.` : 'Cube cohérent ✓') + rot
      : v.errors[0];
  }
  $('review-solve').disabled = !ok;
}

function initReview() {
  $('review-back').onclick = () => show('home');
  $('review-rescan').onclick = () => startScan();
  $('review-solve').onclick = () => openSolve(review.facelets.join(''), review.slotKey);
}

// ---------------------------------------------------------------- Solution
const player = { cube: null, start: null, moves: [], idx: 0, busy: false, playing: false };

function moveText(m) { return m.face + (m.turns === 2 ? '2' : m.turns === 3 ? '\'' : ''); }
function moveDesc(m) {
  return `Face ${FACE_FR[m.face]} — ${m.turns === 2 ? 'demi-tour' : m.turns === 1 ? 'sens horaire' : 'sens antihoraire'}`;
}

async function openSolve(facelets, slotKey) {
  show('solve');
  const colors = Object.fromEntries(FACES.map((f) => [f, COLOR_INFO[slotKey[f]].css]));
  if (!player.cube) player.cube = new Cube3D($('viewer'), { interactive: true, colors });
  else player.cube.setColors(colors);
  player.start = facelets;
  player.cube.setState(facelets);
  player.cube.setDefaultView(false);
  player.moves = [];
  player.idx = 0;
  player.playing = false;
  $('hold').innerHTML = `Tiens ton cube avec la face ${chip(slotKey.U)} en haut et la face ${chip(slotKey.F)} devant toi.`;
  $('solve-title').textContent = 'Recherche de la solution…';
  $('moves').innerHTML = '';
  renderPlayer();
  try {
    const best = await solve(facelets, {
      improveMs: 4000,
      onUpdate: (moves) => setSolution(moves, true),
    });
    setSolution(best, false);
  } catch (err) {
    $('solve-title').textContent = 'Erreur du solveur';
    $('cur-desc').textContent = String(err.message || err);
  }
}

function setSolution(moves, searching) {
  // Pendant la lecture, on ne remplace pas la solution affichée.
  if (player.idx > 0 || player.busy) {
    if (!searching) $('solve-title').textContent = `Solution en ${player.moves.length} coups`;
    return;
  }
  player.moves = parseMoves(moves);
  // Vérification : la solution doit vraiment résoudre le cube.
  const okSolve = applyMoves(player.start, player.moves) === SOLVED;
  const n = player.moves.length;
  $('solve-title').textContent = !okSolve ? 'Solution invalide (bug)' : n === 0 ? 'Ton cube est déjà résolu !' : `Solution en ${n} coups${searching ? ' (je cherche plus court…)' : ''}`;
  renderPlayer();
}

function renderPlayer() {
  $('moves').innerHTML = player.moves.map((m, i) => `<span data-i="${i}" class="${i < player.idx ? 'done' : i === player.idx ? 'now' : ''}">${moveText(m)}</span>`).join('');
  $('moves').querySelectorAll('span').forEach((s) => { s.onclick = () => jumpTo(+s.dataset.i); });
  const m = player.moves[player.idx];
  $('cur-move').textContent = m ? moveText(m) : player.moves.length ? '✓' : '–';
  $('cur-desc').textContent = m ? moveDesc(m) : player.moves.length ? 'Cube résolu !' : '';
  $('ctl-play').innerHTML = player.playing ? '&#10073;&#10073;' : '&#9654;';
  const now = $('moves').querySelector('.now');
  if (now) now.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function stepNext() {
  if (player.busy || player.idx >= player.moves.length) return false;
  player.busy = true;
  const m = player.moves[player.idx];
  await player.cube.move(m.face, m.turns);
  player.idx++;
  player.busy = false;
  renderPlayer();
  return true;
}

async function stepPrev() {
  if (player.busy || player.idx <= 0) return;
  player.busy = true;
  const m = player.moves[player.idx - 1];
  await player.cube.move(m.face, 4 - m.turns);
  player.idx--;
  player.busy = false;
  renderPlayer();
}

function jumpTo(i) {
  if (player.busy) return;
  player.playing = false;
  player.idx = i;
  player.cube.setState(applyMoves(player.start, player.moves.slice(0, i)));
  renderPlayer();
}

async function play() {
  player.playing = !player.playing;
  renderPlayer();
  while (player.playing) {
    const ok = await stepNext();
    if (!ok) break;
    await new Promise((r) => setTimeout(r, 180 / player.cube.speed));
  }
  player.playing = false;
  renderPlayer();
}

function initSolve() {
  $('solve-back').onclick = () => { player.playing = false; show('review'); };
  $('ctl-next').onclick = () => { player.playing = false; stepNext(); };
  $('ctl-prev').onclick = () => { player.playing = false; stepPrev(); };
  $('ctl-play').onclick = () => play();
  $('ctl-start').onclick = () => jumpTo(0);
  $('ctl-end').onclick = () => jumpTo(player.moves.length);
  $('speed').oninput = (e) => { if (player.cube) player.cube.speed = +e.target.value; };
}

// ---------------------------------------------------------------- Démarrage
initHome();
initScan();
initReview();
initSolve();

// Accès de test (Playwright) et démo : ?state=<54 lettres> ouvre la vérification.
if (params.get('state')) {
  openReview({ facelets: params.get('state'), uncertain: [], scheme: WESTERN_SLOTS, manual: true });
}
window.__app = { scan, review, player, openReview, openSolve };
