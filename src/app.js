// Application : accueil -> scan guidé -> vérification -> solution 3D.

import { Stage, CubeObject } from './render/stage.js';
import { launchConfetti } from './render/confetti.js';
import { Scanner } from './scan/scanner.js';
import { ScanSession, STEPS, COLOR_INFO, slotColors } from './scan/session.js';
import { scanToCanonical, rotateGrid, FACES, SOLVED, validateFacelets, parseMoves, applyMoves } from './cube/cube.js';
import { labDist, labToRgb, chroma, hueDeg } from './vision/color.js';
import { detectMultiScale } from './vision/multiscale.js';
import { solve, warmUp } from './solver/solver.js';
import { adjacentFaces, topFromNeighbor } from './scan/orientation.js';
import { CubeModel } from './scan/model.js';
import { resolveHybrid, fixedFromModel } from './scan/hybrid.js';
import { FreeCapture } from './scan/freecapture.js';

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
  $('camera-layer').classList.toggle('on', id === 'scan');
  if (id !== 'solve') $('solve').classList.remove('celebrating');
}

// La scène 3D partagée et son unique cube.
const stage = new Stage($('stage'));
const cube = stage.cube;
const slotCssMap = (slotKey) => Object.fromEntries(FACES.map((f) => [f, COLOR_INFO[slotKey[f]].css]));

// ---------------------------------------------------------------- Accueil
let demoTimer = null;
function goHome() {
  show('home');
  cube.selected = -1;
  cube.uncertain = new Set();
  const enter = async () => {
    if (cube.netGroup.visible) await cube.refold(800);
    cube.setOverride(null);
    cube.setColors(slotCssMap(WESTERN_SLOTS));
    stage.anchor($('home-cube'), { fit: 'cube', duration: 1000 });
    cube.setDefaultView(800).then(() => { cube.spinning = true; });
  };
  enter();
}

function initHome() {
  stage.enableDrag($('home-cube'));
  cube.setColors(slotCssMap(WESTERN_SLOTS));
  stage.anchor($('home-cube'), { fit: 'cube', duration: 0 });
  cube.setDefaultView(0);
  cube.spinning = true;
  // Petite démo : le cube se mélange tout seul tant qu'on est à l'accueil.
  const moves = "R U F2 L' D B R2 U' F L D' B2".split(' ');
  let k = 0;
  const demo = () => {
    if ($('home').classList.contains('active') && !cube.override && !cube.netGroup.visible) {
      const m = parseMoves(moves[k++ % moves.length])[0];
      cube.move(m.face, m.turns, 420);
    }
    demoTimer = setTimeout(demo, 1100);
  };
  demoTimer = setTimeout(demo, 1200);
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

async function startScan(mode = scan.mode || 'free') {
  scan.mode = mode;
  show('scan');
  const el = $('scan');
  el.classList.toggle('free', mode === 'free');
  $('camera-layer').classList.toggle('guided', mode !== 'free');
  el.classList.remove('complete');
  $('scan-mode').textContent = mode === 'free' ? 'Mode pas à pas' : 'Mode libre';
  scan.session = new ScanSession();
  scan.track = null;
  scan.model = new CubeModel();
  scan.free = new ScanSession({ anyOrder: true });
  scan.cap = new FreeCapture();
  scan.relVotes = {};
  scan.relChanged = false;
  scan.resolving = false;
  scan.waitSince = 0;
  scan.lastPick = null;
  scan.finishing = false;
  scan.retries = 0;
  scan.hint = { text: '', t: 0 };
  // Le cube de l'accueil s'envole vers son coin et devient « vierge ».
  if (cube.netGroup.visible) cube.refold(600);
  cube.selected = -1;
  cube.uncertain = new Set();
  cube.setOverride(new Array(54).fill('#3a3f4d'));
  if (mode === 'free') {
    stage.anchor($('mini-cube'), { fit: 'cube', duration: 900 });
    cube.setDefaultView(700).then(() => { cube.spinning = true; });
    renderChips(scan.free);
    refreshMini();
    setHint('Montre-moi ton cube, de face ou par un coin');
  } else {
    cube.spinning = false;
    stage.anchor($('guide'), { fit: 'cube', duration: 900 });
    updateScanUI();
  }
  $('scan-error').hidden = true;
  const overlay = $('overlay');
  if (!scan.scanner) {
    scan.scanner = new Scanner($('video'), overlay, { onResult: (res) => (scan.mode === 'free' ? onFreeDetection(res) : onDetection(res)), debug: DEBUG });
  }
  try {
    if (!scan.scanner.running) await scan.scanner.start();
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
    $('err-home').onclick = () => { stopScan(); goHome(); };
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

// Pastilles des 6 faces (remplies quand la face est capturée).
function renderChips(session, current = null) {
  $('steps').innerHTML = STEPS.map((st) => {
    const sc = session.scans[st.color];
    const inner = sc
      ? sc.rgbs.map((c) => `<span style="background:rgb(${c.join(',')})"></span>`).join('')
      : Array.from({ length: 9 }, (_, i) => `<span style="background:${i === 4 ? COLOR_INFO[st.color].css : 'transparent'}"></span>`).join('');
    return `<div class="step${current === st.color ? ' current' : ''}${sc ? ' done' : ''}" title="Face ${COLOR_INFO[st.color].name}">${inner}</div>`;
  }).join('');
}

function updateScanUI() {
  const s = scan.session;
  const step = s.nextStep();
  renderChips(s, step && step.color);
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
  cube.setOverride(css);
  cube.setView(SLOT_OF[step.color], SLOT_OF[step.top], 600, [0.35, -0.45]);
}

function setHint(text) {
  const h = $('hint');
  if (h.dataset.text === text) return;
  h.dataset.text = text;
  // Une flèche en tête de consigne est animée.
  const m = text.match(/^([↺↻⤴⤵⟲◎])\s*(.*)$/);
  h.innerHTML = '';
  if (m) {
    const icon = document.createElement('span');
    icon.className = `hint-icon i-${'↺↻⤴⤵⟲◎'.indexOf(m[1])}`;
    icon.textContent = m[1];
    h.append(icon, document.createTextNode(' ' + m[2]));
  } else {
    h.textContent = text;
  }
  h.classList.remove('pop');
  void h.offsetWidth;
  h.classList.add('pop');
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

function looksLikeSkin(lab, session = scan.session) {
  const c = chroma(lab), h = hueDeg(lab);
  if (!(c > 12 && c < 32 && h > 25 && h < 70 && lab[0] > 40 && lab[0] < 88)) return false;
  // Une vraie couleur du cube déjà mesurée (orange pâle, blanc chaud…) ?
  return !Object.values(session.scans).some((sc) => labDist(lab, sc.labs[4]) < 18);
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
      const res = scan.session.resolve();
      celebrateScan({ ...res, slotKey: slotColors(res) });
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

function drawOverlay(res, pick, classify = null) {
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
    const cls = classify ? classify(f) : null;
    const isPick = (pick && pick.face === f) || !!cls;
    const pts = f.corners.map(map);
    ctx.lineWidth = isPick ? 3 : 1.5;
    const ok = cls ? cls === 'ok' : isPick && pick.id.status === 'ok';
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


// ---------------------------------------------------------------- Scan libre
// Mode libre : on montre les faces dans n'importe quel ordre et n'importe quel
// sens ; chacune est capturée dès qu'elle est stable (comme en pas à pas).
// En bonus, quand deux faces sont visibles ensemble, on note laquelle touche
// laquelle (cela fixe leur orientation) et le modèle 3D se remplit.

function freeHint(text, priority = false) {
  const now = performance.now();
  if (text === scan.hint.text) return;
  if (!priority && now - scan.hint.t < 900) return;
  scan.hint = { text, t: now };
  setHint(text);
}

const missingNames = () => STEPS.filter((st) => !scan.free.scans[st.color]).map((st) => COLOR_INFO[st.color].name);

// Rotation (quarts de tour) qui aligne la grille vue maintenant sur la capture.
function alignRotation(now, captured) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < 4; k++) {
    const g = rotateGrid(captured, k);
    let d = 0;
    for (let i = 0; i < 9; i++) d += labDist(g[i], now[i]);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// Faces voisines vues ensemble : « la face X touche la face Y par son côté s »,
// exprimé dans l'image de la capture de X.
function recordRelations(faces) {
  for (const A of faces) {
    const cA = scan.free.colorOf(A.cells[4].lab);
    const cap = scan.free.scans[cA];
    if (!cap) continue;
    const k = alignRotation(A.cells.map((c) => c.lab), cap.labs);
    for (const { face: B, side } of adjacentFaces(A, faces)) {
      const cB = scan.free.colorOf(B.cells[4].lab);
      if (!cB || cB === cA) continue;
      const key = `${cB}:${(side - k + 4) % 4}`;
      const votes = (scan.relVotes[cA] = scan.relVotes[cA] || {});
      votes[key] = (votes[key] || 0) + 1;
      if (votes[key] === 2) scan.relChanged = true;
    }
  }
}

function relations() {
  const out = {};
  for (const [c, votes] of Object.entries(scan.relVotes)) {
    out[c] = Object.entries(votes).filter(([, n]) => n >= 2).map(([k]) => {
      const [n, side] = k.split(':');
      return { n, side: +side };
    });
  }
  return out;
}

// Mini-cube : faces capturées à leur place (schéma standard).
function refreshMini(showColor = null) {
  const css = new Array(54).fill('#3a3f4d');
  for (const st of STEPS) {
    const sc = scan.free.scans[st.color];
    const f = FACES.indexOf(SLOT_OF[st.color]);
    for (let k = 0; k < 9; k++) css[f * 9 + k] = sc ? `rgb(${sc.rgbs[k].join(',')})` : k === 4 ? COLOR_INFO[st.color].css + '66' : '#3a3f4d';
  }
  cube.setOverride(css);
  const p = Object.keys(scan.free.scans).length;
  $('mini-count').textContent = `${p} / 6 faces`;
  $('mini-bar').style.width = `${Math.round((100 * p) / 6)}%`;
  if (showColor) {
    // Le mini-cube se tourne vers la face qu'on vient de capturer.
    const slot = SLOT_OF[showColor];
    cube.setView(slot, slot === 'U' ? 'B' : slot === 'D' ? 'F' : 'U', 600).then(() => {
      setTimeout(() => { if (!scan.finishing) cube.spinning = true; }, 900);
    });
  }
}


function onFreeDetection(res) {
  if (scan.finishing || !$('scan').classList.contains('active')) return;
  scan.model.update(res.faces); // bonus 3D
  recordRelations(res.faces);
  // Faces entièrement connues par le modèle 3D : comptées comme capturées.
  const fixed = fixedFromModel(scan.model);
  let fresh = null;
  for (const [slot, labs] of Object.entries(fixed)) {
    const color = WESTERN_SLOTS[slot];
    if (!scan.free.scans[color] && !scan.cap.seenAs(labs)) {
      scan.free.accept(color, labs, labs.map((l) => labToRgb(...l)));
      scan.cap.add(color, labs);
      fresh = color;
    }
  }
  if (fresh) {
    renderChips(scan.free);
    refreshMini(fresh);
    beep();
    if (scan.free.done) { finishFree(); return; }
  }
  const now = performance.now();
  drawOverlay(res, null, (f) => (f === scan.lastPick ? 'ok' : null));
  // Il manque seulement l'orientation : on attend une vue de coin.
  if (scan.free.done) {
    if (scan.relChanged && !scan.resolving) { scan.relChanged = false; finishFree(); }
    return;
  }
  // Capture : toutes les faces visibles sont suivies en parallèle.
  const u = scan.cap.update(res.faces, now);
  scan.lastPick = u.tracking ? u.tracking.face : null;
  for (const c of u.captured) captureFree(c.color, c.labs);
  if (scan.free.done) return;
  if (u.captured.length) {
    // (la consigne vient d'être mise à jour par captureFree)
  } else if (u.tracking) {
    freeHint(`Face ${COLOR_INFO[u.tracking.guess] ? COLOR_INFO[u.tracking.guess].name : ''} — ne bouge plus…`, true);
  } else if (u.seen.length) {
    freeHint(`Déjà vue ✓ — tourne le cube : il reste ${missingNames().join(', ')}`);
  } else {
    freeHint(Object.keys(scan.free.scans).length ? `Montre-moi une autre face : ${missingNames().join(', ')}` : 'Montre-moi ton cube, de face ou par un coin');
  }
  $('stability-bar').style.width = `${Math.round((u.tracking ? u.tracking.progress : 0) * 100)}%`;
}

function captureFree(color, labs) {
  scan.free.accept(color, labs, labs.map((l) => labToRgb(...l)));
  const fl = $('flash');
  fl.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove('on')));
  if (navigator.vibrate) navigator.vibrate(60);
  beep();
  renderChips(scan.free);
  refreshMini(color);
  $('stability-bar').style.width = '0%';
  const left = missingNames();
  freeHint(left.length ? `Face ${COLOR_INFO[color].name} ✓ — encore : ${left.join(', ')}` : 'Toutes les faces sont là ✓', true);
  if (scan.free.done) setTimeout(finishFree, 400);
}

// Couleur (W/Y/R/O/B/G) de chaque face du solveur d'après la teinte des centres.
function slotKeysFromLabs(labs) {
  const centers = FACES.map((f, i) => ({ f, lab: labs[i * 9 + 4] }));
  const out = {};
  const white = centers.slice().sort((a, b) => (chroma(a.lab) - a.lab[0] * 0.3) - (chroma(b.lab) - b.lab[0] * 0.3))[0];
  out[white.f] = 'W';
  const rest = centers.filter((c) => c !== white).map((c) => ({ ...c, h: (hueDeg(c.lab) + 360 - 340) % 360 }));
  rest.sort((a, b) => a.h - b.h);
  ['R', 'O', 'Y', 'G', 'B'].forEach((k, i) => { out[rest[i].f] = k; });
  return out;
}

async function finishFree() {
  if (scan.resolving) return;
  scan.resolving = true;
  if (!scan.waitSince) freeHint('Je reconstitue ton cube…', true);
  const loose = Object.fromEntries(Object.entries(scan.free.scans).map(([c, sc]) => [c, sc.labs]));
  const res = await resolveHybrid(loose, fixedFromModel(scan.model), { relations: relations() });
  scan.resolving = false;
  if (!res || scan.finishing) return;
  const slotKey = slotKeysFromLabs(res.labs);
  const result = { facelets: res.facelets, uncertain: res.uncertain, corrected: res.corrected, slotKey };
  // Plusieurs lectures possibles (cube presque résolu…) : une vue de coin
  // suffit à trancher.
  if (res.valid.ok && res.ambiguous) {
    scan.waitSince = scan.waitSince || performance.now();
    if (performance.now() - scan.waitSince < 20000) {
      freeHint('↻ Presque fini ! Montre-moi un coin du cube, avec deux faces visibles', true);
      return;
    }
  }
  const doubtful = !res.valid.ok || res.corrected || res.uncertain.size > 3;
  if (doubtful && (scan.retries || 0) < 2) {
    // La face la plus douteuse est à remontrer.
    scan.retries = (scan.retries || 0) + 1;
    const counts = {};
    const idx = res.uncertain.size ? [...res.uncertain] : [];
    for (const i of idx) { const c = slotKey[FACES[Math.floor(i / 9)]]; counts[c] = (counts[c] || 0) + 1; }
    const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const color = worst ? worst[0] : null;
    if (color && scan.free.scans[color]) {
      delete scan.free.scans[color];
      scan.cap.remove(color);
      scan.free.history = scan.free.history.filter((c) => c !== color);
      renderChips(scan.free);
      refreshMini();
      freeHint(`Remontre-moi la face ${COLOR_INFO[color].name}, bien de face`, true);
      return;
    }
  }
  scan.finishing = true;
  stopScan();
  if (navigator.vibrate) navigator.vibrate([60, 60, 120]);
  beep();
  if (doubtful || res.ambiguous) { openReview(result); return; }
  celebrateScan(result);
}

// Fin du scan : la caméra s'efface, le cube prend ses vraies couleurs, vient
// au centre… puis se déplie en patron pour la vérification.
async function celebrateScan(result) {
  $('scan').classList.add('complete');
  cube.spinning = false;
  cube.setOverride(null);
  cube.setColors(slotCssMap(result.slotKey));
  cube.setState(result.facelets);
  $('camera-layer').classList.remove('on');
  stage.anchor($('net-anchor'), { fit: 'cube', duration: 1000 });
  await cube.setDefaultView(900);
  await new Promise((r) => setTimeout(r, 650));
  $('scan').classList.remove('complete');
  openReview(result);
}

// Import d'une photo (secours si pas de caméra, ou pour tester).
async function importPhoto(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s);
  cv.height = Math.round(bmp.height * s);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const res = detectMultiScale(ctx.getImageData(0, 0, cv.width, cv.height), { base: 480 });
  const pick = pickFace(res);
  if (!pick || pick.id.status !== 'ok') {
    setHint(pick ? `Photo : face ${COLOR_INFO[pick.id.color]?.name || '?'} non attendue ici` : 'Photo : aucune face reconnue');
    return;
  }
  acceptFace(pick.id.color, pick.face.cells.map((c) => c.lab));
}

function initScan() {
  $('scan-back').onclick = () => { stopScan(); goHome(); };
  $('scan-mode').onclick = () => startScan(scan.mode === 'free' ? 'guided' : 'free');
  $('scan-restart').onclick = () => { scan.scanner && scan.scanner.running ? startScan('free') : startScan('free'); };
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

async function openReview(result) {
  review.facelets = result.facelets.split('');
  review.uncertain = new Set(result.uncertain || []);
  review.slotKey = result.slotKey || (result.manual ? { ...WESTERN_SLOTS } : slotColors(result));
  review.selected = -1;
  review.corrected = result.corrected;
  review.rotated = result.rotated || [];
  showReview();
}

// Affiche la vérification : le cube se met à plat… et se déplie.
async function showReview() {
  show('review');
  stopScan();
  cube.spinning = false;
  cube.setOverride(null);
  cube.setColors({ ...slotCssMap(review.slotKey), '?': '#3a3f4d' });
  cube.setState(review.facelets.join(''));
  cube.uncertain = review.uncertain;
  cube.selected = review.selected;
  renderReview();
  if (!cube.netGroup.visible) {
    stage.anchor($('net-anchor'), { fit: 'cube', duration: 700 });
    await cube.flatView(700);
    stage.anchor($('net-anchor'), { fit: 'net', duration: 1300 });
    await cube.unfold(1300);
  } else {
    stage.anchor($('net-anchor'), { fit: 'net', duration: 600 });
  }
}

function slotCss(slot) {
  return slot === '?' ? '#3a3f4d' : COLOR_INFO[review.slotKey[slot]].css;
}

function selectCell(i) {
  if (i < 0 || i % 9 === 4) { review.selected = -1; } else { review.selected = review.selected === i ? -1 : i; }
  cube.selected = review.selected;
  renderReview();
}

function renderReview() {
  $('palette').classList.toggle('disabled', review.selected < 0);
  $('palette').innerHTML = FACES.map((f) => `<button data-f="${f}" class="${review.selected >= 0 && review.facelets[review.selected] === f ? 'on' : ''}" style="background:${slotCss(f)}" aria-label="${COLOR_INFO[review.slotKey[f]].short}"></button>`).join('');
  $('palette').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      if (review.selected < 0) return;
      review.facelets[review.selected] = b.dataset.f;
      review.uncertain.delete(review.selected);
      cube.setState(review.facelets.join(''));
      // Passe automatiquement à la case suivante à remplir (saisie manuelle).
      const next = review.facelets.findIndex((c, k) => c === '?' && k > review.selected);
      review.selected = next;
      cube.selected = next;
      renderReview();
    };
  });
  const s = review.facelets.join('');
  const missing = s.split('').filter((c) => c === '?').length;
  const msg = $('review-msg');
  let ok = false;
  if (missing) {
    msg.className = 'msg';
    msg.textContent = `Il reste ${missing} case${missing > 1 ? 's' : ''} à remplir : touche une case grise, puis une couleur.`;
  } else {
    const v = validateFacelets(s);
    ok = v.ok;
    msg.className = `msg ${v.ok ? 'ok' : 'err'}`;
    const rot = review.rotated.length
      ? ` J’ai remis dans le bon sens : face${review.rotated.length > 1 ? 's' : ''} ${review.rotated.map((c) => COLOR_INFO[c].name).join(', ')}.`
      : '';
    msg.textContent = v.ok
      ? (review.uncertain.size ? `Tout a l’air bon ✓ — jette un œil aux ${review.uncertain.size} cases qui clignotent.` : 'Tout est bon ✓') + rot
      : v.errors[0];
  }
  $('review-solve').disabled = !ok;
}

function initReview() {
  $('review-back').onclick = () => goHome();
  $('review-rescan').onclick = () => startScan();
  $('review-solve').onclick = () => openSolve(review.facelets.join(''), review.slotKey);
  // Toucher une case du patron 3D.
  const el = $('net-anchor');
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 10) return;
    selectCell(stage.pickNet(e.clientX, e.clientY));
  });
}

// ---------------------------------------------------------------- Solution
const player = { cube: null, start: null, moves: [], idx: 0, busy: false, playing: false };

function moveText(m) { return m.face + (m.turns === 2 ? '2' : m.turns === 3 ? '\'' : ''); }
function moveDesc(m) {
  return `Face ${FACE_FR[m.face]} — ${m.turns === 2 ? 'demi-tour' : m.turns === 1 ? 'sens horaire' : 'sens antihoraire'}`;
}

async function openSolve(facelets, slotKey) {
  show('solve');
  player.cube = cube;
  cube.selected = -1;
  cube.uncertain = new Set();
  cube.setOverride(null);
  cube.setColors(slotCssMap(slotKey));
  player.start = facelets;
  cube.setState(facelets);
  player.slotKey = slotKey;
  // Le patron se replie en cube, qui grandit et se tourne de trois quarts.
  if (cube.netGroup.visible) {
    stage.anchor($('viewer'), { fit: 'cube', duration: 1100 });
    await cube.refold(1100);
  } else {
    stage.anchor($('viewer'), { fit: 'cube', duration: 900 });
  }
  cube.setDefaultView(800);
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
    if (!searching) $('solve-title').textContent = `${player.moves.length} coups`;
    return;
  }
  player.moves = parseMoves(moves);
  // Vérification : la solution doit vraiment résoudre le cube.
  const okSolve = applyMoves(player.start, player.moves) === SOLVED;
  const n = player.moves.length;
  $('solve-title').textContent = !okSolve ? 'Solution invalide (bug)' : n === 0 ? 'Ton cube est déjà résolu !' : `${n} coups${searching ? ' · je cherche plus court…' : ''}`;
  renderPlayer();
}

function faceCss(face) {
  return player.slotKey ? COLOR_INFO[player.slotKey[face]].css : '#fff';
}

function renderPlayer() {
  $('moves').innerHTML = player.moves.map((m, i) => `<span data-i="${i}" style="--c:${faceCss(m.face)}" class="${i < player.idx ? 'done' : i === player.idx ? 'now' : ''}">${moveText(m)}</span>`).join('');
  $('moves').querySelectorAll('span').forEach((s) => { s.onclick = () => jumpTo(+s.dataset.i); });
  const m = player.moves[player.idx];
  $('cur-move').textContent = m ? moveText(m) : player.moves.length ? '✓' : '–';
  $('cur-move').style.color = m ? faceCss(m.face) : '';
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
  if (player.idx === player.moves.length) celebrateSolved();
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
  $('celebrate').hidden = true;
  $('solve').classList.remove('celebrating');
  cube.spinning = false;
  cube.setState(applyMoves(player.start, player.moves.slice(0, i)));
  renderPlayer();
  if (i > 0 && i === player.moves.length) celebrateSolved();
}

async function play() {
  player.playing = !player.playing;
  renderPlayer();
  while (player.playing) {
    const ok = await stepNext();
    if (!ok) break;
    await new Promise((r) => setTimeout(r, 180 / cube.speed));
  }
  player.playing = false;
  renderPlayer();
}

// Cube résolu : confettis, petite pirouette du cube.
function celebrateSolved() {
  player.playing = false;
  $('solve').classList.add('celebrating');
  $('celebrate').hidden = false;
  launchConfetti($('confetti'));
  if (navigator.vibrate) navigator.vibrate([40, 40, 40, 40, 120]);
  cube.spinning = true;
}

function initSolve() {
  stage.enableDrag($('viewer'));
  $('again').onclick = () => { $('celebrate').hidden = true; cube.spinning = false; startScan(); };
  $('solve-back').onclick = () => {
    player.playing = false;
    $('celebrate').hidden = true;
    cube.setState(player.start);
    showReview();
  };
  $('ctl-next').onclick = () => { player.playing = false; stepNext(); };
  $('ctl-prev').onclick = () => { player.playing = false; stepPrev(); };
  $('ctl-play').onclick = () => play();
  $('ctl-start').onclick = () => jumpTo(0);
  $('ctl-end').onclick = () => jumpTo(player.moves.length);
  $('speed').oninput = (e) => { cube.speed = +e.target.value; };
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
window.__app = { scan, review, player, openReview, openSolve, stage };
