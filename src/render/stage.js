// Scène 3D unique, plein écran, partagée par tous les écrans de l'app.
//
// Un seul cube vit dans cette scène et se déplace d'un écran à l'autre : il
// se pose sur un « ancrage » (un élément HTML transparent qui réserve sa
// place dans la page), change de taille, s'oriente, se déplie en patron comme
// une boîte en carton, puis se replie. Les transitions entre écrans sont donc
// continues : c'est toujours le même objet que l'on voit.

import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../vendor/three/addons/RoundedBoxGeometry.js';
import { FACES } from '../cube/cube.js';
import { puzzle } from '../cube/nxn.js';

const FACE_AXIS = { U: [1, 1], D: [1, -1], R: [0, 1], L: [0, -1], F: [2, 1], B: [2, -1] };
const NORMAL = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function roundedSquare(size, r) {
  const s = new THREE.Shape();
  const h = size / 2;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ShapeGeometry(s, 5);
}

function tween(duration, fn, easing = ease) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / duration);
      fn(easing(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------------------
// Le cube : pièces (pour jouer les mouvements) + patron articulé (pour se
// déplier). Les deux sont superposables quand le patron est replié.
export class CubeObject {
  constructor() {
    this.holder = new THREE.Group(); // position / taille (ancrage)
    this.root = new THREE.Group(); // orientation
    this.holder.add(this.root);
    this.colors = { U: '#f5f5f0', R: '#ff3b5c', F: '#2fd36b', D: '#ffd60a', L: '#ff8a1f', B: '#2f7bff', '?': '#3a3f4d' };
    this.override = null; // couleurs par facette (scan) ou null
    this.queue = Promise.resolve();
    this.speed = 1;
    this.spinning = false;
    this.selected = -1;
    this.uncertain = new Set();
    this.build(3);
  }

  // (Re)construit le cube pour une taille N (2, 3, 4…). Le cube garde la
  // même taille à l'écran : ce sont les pièces qui rapetissent.
  build(N) {
    if (this.N === N) return;
    if (this.cubiesGroup) this.root.remove(this.cubiesGroup, this.netGroup);
    this.N = N;
    this.P = puzzle(N);
    const P = this.P, s = 3 / N, size = P.size;
    this.cell = s;

    // --- Pièces
    this.cubiesGroup = new THREE.Group();
    this.root.add(this.cubiesGroup);
    const bodyGeo = new RoundedBoxGeometry(0.96 * s, 0.96 * s, 0.96 * s, 3, 0.1 * s);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.55 });
    const stickerGeo = roundedSquare(0.84 * s, 0.13 * s);
    this.cubies = [];
    this.stickers = new Array(size);
    const cubieAt = new Map();
    // Coordonnées doublées : -(N-1), …, N-1 (seules les pièces visibles).
    for (let x = 1 - N; x < N; x += 2) for (let y = 1 - N; y < N; y += 2) for (let z = 1 - N; z < N; z += 2) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== N - 1) continue;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat));
      g.userData.idx = [x, y, z];
      g.userData.home = new THREE.Vector3(x, y, z).multiplyScalar(s / 2);
      g.position.copy(g.userData.home);
      this.cubiesGroup.add(g);
      this.cubies.push(g);
      cubieAt.set(`${x},${y},${z}`, g);
    }
    const stickerMat = () => new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.32, metalness: 0.02, side: THREE.DoubleSide });
    P.geometry.forEach((fg, i) => {
      const g = cubieAt.get(fg.cubie.join(','));
      const m = new THREE.Mesh(stickerGeo, stickerMat());
      const n = new THREE.Vector3(...fg.normal);
      m.position.copy(n.clone().multiplyScalar(0.484 * s));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      g.add(m);
      this.stickers[i] = m;
    });

    // --- Patron articulé (visible seulement pour le dépliage)
    this.netGroup = new THREE.Group();
    this.root.add(this.netGroup);
    this.netGroup.visible = false;
    const plateGeo = new RoundedBoxGeometry(2.98, 2.98, 0.08, 2, 0.14);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.6 });
    const netStickerGeo = roundedSquare(0.86 * s, 0.14 * s);
    this.netStickers = new Array(size);
    const n2 = N * N;
    const makeFace = (slot) => {
      const g = new THREE.Group();
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.z = -0.04;
      g.add(plate);
      const f = FACES.indexOf(slot);
      for (let k = 0; k < n2; k++) {
        const r = Math.floor(k / N), c = k % N;
        const m = new THREE.Mesh(netStickerGeo, stickerMat());
        m.position.set((c - (N - 1) / 2) * s, ((N - 1) / 2 - r) * s, 0.012);
        m.userData.index = f * n2 + k;
        g.add(m);
        this.netStickers[f * n2 + k] = m;
      }
      return g;
    };
    // Charnières : F au centre ; U, D, L, R autour ; B accroché à R.
    const pivot = (x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); return p; };
    this.netF = pivot(0, 0, 1.5); this.netF.add(makeFace('F'));
    this.pU = pivot(0, 1.5, 1.5); { const f = makeFace('U'); f.position.set(0, 1.5, 0); this.pU.add(f); }
    this.pD = pivot(0, -1.5, 1.5); { const f = makeFace('D'); f.position.set(0, -1.5, 0); this.pD.add(f); }
    this.pL = pivot(-1.5, 0, 1.5); { const f = makeFace('L'); f.position.set(-1.5, 0, 0); this.pL.add(f); }
    this.pR = pivot(1.5, 0, 1.5); { const f = makeFace('R'); f.position.set(1.5, 0, 0); this.pR.add(f); }
    this.pB = pivot(3, 0, 0); { const f = makeFace('B'); f.position.set(1.5, 0, 0); this.pB.add(f); }
    this.pR.add(this.pB);
    this.netGroup.add(this.netF, this.pU, this.pD, this.pL, this.pR);
    this.setFold(1);
    this.setState(P.solved);
  }

  colorOf(i) {
    if (this.override && this.override[i]) return this.override[i];
    return this.colors[this.state[i]] || this.colors['?'];
  }

  refreshColors() {
    for (let i = 0; i < this.P.size; i++) {
      const c = this.colorOf(i);
      this.stickers[i].material.color.set(c);
      this.netStickers[i].material.color.set(c);
    }
  }

  setColors(colors) { Object.assign(this.colors, colors); this.refreshColors(); }

  setState(facelets) {
    this.state = facelets;
    for (const c of this.cubies) {
      if (c.parent !== this.cubiesGroup) this.cubiesGroup.attach(c);
      c.position.copy(c.userData.home);
      c.quaternion.identity();
    }
    this.refreshColors();
  }

  setOverride(cssArray) { this.override = cssArray; this.refreshColors(); }

  // f : 1 = replié (cube), 0 = à plat (patron en croix). Les faces se
  // déplient légèrement décalées dans le temps, c'est plus vivant.
  setFold(f, stagger = 0) {
    const a = (delay) => Math.max(0, Math.min(1, (f - delay * stagger) / (1 - delay * stagger || 1))) * Math.PI / 2;
    this.pU.rotation.x = -a(0.1);
    this.pD.rotation.x = a(0.2);
    this.pL.rotation.y = -a(0);
    this.pR.rotation.y = a(0.05);
    this.pB.rotation.y = a(0.3);
    // Recentre la croix (son centre n'est pas la face avant).
    this.netGroup.position.set(-1.5 * (1 - f), 0, -1.5 * (1 - f));
    this.fold = f;
  }

  showNet(on) {
    this.netGroup.visible = on;
    this.cubiesGroup.visible = !on;
  }

  // Animation : le cube se déplie en patron (ou se replie).
  async unfold(duration = 1300) {
    this.showNet(true);
    await tween(duration, (t) => this.setFold(1 - t, 1));
  }

  async refold(duration = 1100) {
    await tween(duration, (t) => this.setFold(t, 1));
    this.showNet(false);
  }

  // --- Mouvements (couches lo..hi comptées depuis la face : 1 = extérieure)
  move(face, turns = 1, duration = 330, lo = 1, hi = 1) {
    this.queue = this.queue.then(() => this._animate(face, turns, duration / this.speed, lo, hi));
    return this.queue;
  }

  _animate(face, turns, duration, lo = 1, hi = 1) {
    const [axis, sign] = FACE_AXIS[face];
    const N = this.N;
    const pivotG = new THREE.Group();
    this.cubiesGroup.add(pivotG);
    const layer = this.cubies.filter((c) => {
      const L = (N - 1 - sign * c.userData.idx[axis]) / 2 + 1;
      return L >= lo && L <= hi;
    });
    layer.forEach((c) => pivotG.attach(c));
    const q = turns % 4 === 3 ? -1 : turns % 4;
    const angle = -sign * q * (Math.PI / 2);
    const axisVec = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
    const d = duration * (Math.abs(q) === 2 ? 1.4 : 1);
    // La tranche qui tourne s'illumine brièvement.
    const lit = layer.flatMap((c) => c.children.filter((m) => m.geometry && m.geometry.type === 'ShapeGeometry'));
    return tween(d, (t) => {
      pivotG.quaternion.setFromAxisAngle(axisVec, angle * t);
      const g = 0.28 * Math.sin(Math.PI * t);
      lit.forEach((m) => m.material.emissive.setRGB(g, g, g));
    }).then(() => {
      lit.forEach((m) => m.material.emissive.setRGB(0, 0, 0));
      layer.forEach((c) => this.cubiesGroup.attach(c));
      this.cubiesGroup.remove(pivotG);
      this.setState(this.P.apply(this.state, [{ face, lo, hi, turns }]));
    });
  }

  // --- Orientation
  static viewQuaternion(front, top, tilt = [0.42, -0.55]) {
    const nf = new THREE.Vector3(...NORMAL[front]), nt = new THREE.Vector3(...NORMAL[top]);
    const nx = new THREE.Vector3().crossVectors(nt, nf);
    const m = new THREE.Matrix4().set(nx.x, nx.y, nx.z, 0, nt.x, nt.y, nt.z, 0, nf.x, nf.y, nf.z, 0, 0, 0, 0, 1);
    const base = new THREE.Quaternion().setFromRotationMatrix(m);
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], tilt[1], 0, 'XYZ')).multiply(base);
  }

  static matrixQuaternion(rows, tilt = [0.38, -0.5]) {
    const m = new THREE.Matrix4().set(...rows[0], 0, ...rows[1], 0, ...rows[2], 0, 0, 0, 0, 1);
    const base = new THREE.Quaternion().setFromRotationMatrix(m);
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], tilt[1], 0, 'XYZ')).multiply(base);
  }

  orientTo(q, duration = 600) {
    this.spinning = false;
    const from = this.root.quaternion.clone();
    if (from.angleTo(q) < 1e-3) return Promise.resolve();
    const token = (this._orientToken = {});
    return tween(duration, (t) => { if (this._orientToken === token) this.root.quaternion.slerpQuaternions(from, q, t); }, easeOut);
  }

  setView(front, top, duration = 600, tilt) { return this.orientTo(CubeObject.viewQuaternion(front, top, tilt), duration); }
  setDefaultView(duration = 600) { return this.setView('F', 'U', duration); }
  flatView(duration = 600) { return this.orientTo(new THREE.Quaternion(), duration); }

  // Mise à jour par image : rotation lente, clignotement des cases douteuses.
  update(time, dt) {
    if (this.spinning) this.root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dt * 0.6);
    if (this.netGroup.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      this.netStickers.forEach((m, i) => {
        const sel = i === this.selected, unsure = this.uncertain.has(i);
        m.material.emissive.setRGB(sel ? 0.35 : unsure ? 0.45 * pulse : 0, sel ? 0.35 : unsure ? 0.33 * pulse : 0, sel ? 0.35 : 0);
        const s = sel ? 1.12 : 1;
        m.scale.setScalar(m.scale.x + (s - m.scale.x) * Math.min(1, dt * 12));
      });
    }
  }
}

// ---------------------------------------------------------------------------
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
    this.camera.position.set(0, 0, 40);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3550, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(6, 10, 14);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb7ff, 0.7);
    rim.position.set(-10, -4, 6);
    this.scene.add(rim);
    this.cube = new CubeObject();
    this.scene.add(this.cube.holder);
    this.anchorEl = null;
    this.anchorFit = 'cube';
    this.from = null; // {x, y, s} au début de la transition
    this.t0 = 0;
    this.duration = 0;
    this.drag = null;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.updateAnchor(now);
      this.cube.update(now / 1000, dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Unités du monde par pixel d'écran (dans le plan z = 0).
  get unitsPerPx() {
    const h = 2 * this.camera.position.z * Math.tan((this.camera.fov * Math.PI) / 360);
    return h / window.innerHeight;
  }

  targetFor(el, fit) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const u = this.unitsPerPx;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // Taille du contenu (unités du cube) : cube vu de trois quarts ou patron.
    const [cw, ch] = fit === 'net' ? [12.3, 9.3] : [5.4, 5.4];
    const s = Math.min((r.width * u) / cw, (r.height * u) / ch);
    return { x: (cx - window.innerWidth / 2) * u, y: -(cy - window.innerHeight / 2) * u, s };
  }

  // Pose le cube sur l'élément `el` (suivi en continu, transition animée).
  anchor(el, { fit = 'cube', duration = 900 } = {}) {
    const h = this.cube.holder;
    this.from = { x: h.position.x, y: h.position.y, s: h.scale.x };
    this.anchorEl = el;
    this.anchorFit = fit;
    this.t0 = performance.now();
    this.duration = duration;
    if (!duration) this.from = null;
    return new Promise((r) => setTimeout(r, duration));
  }

  updateAnchor(now) {
    if (!this.anchorEl) return;
    const target = this.targetFor(this.anchorEl, this.anchorFit);
    if (!target) return;
    const h = this.cube.holder;
    let t = this.duration ? Math.min(1, (now - this.t0) / this.duration) : 1;
    if (this.from && t < 1) {
      const e = ease(t);
      // Petite trajectoire en arc : le cube « saute » d'un endroit à l'autre.
      const lift = Math.sin(Math.PI * e) * 0.15 * Math.abs(this.from.s - target.s) * 4;
      h.position.set(this.from.x + (target.x - this.from.x) * e, this.from.y + (target.y - this.from.y) * e + lift, 0);
      h.scale.setScalar(this.from.s + (target.s - this.from.s) * e);
    } else {
      h.position.set(target.x, target.y, 0);
      h.scale.setScalar(target.s);
      this.from = null;
    }
  }

  // Facette du patron sous un point de l'écran (ou -1).
  pickNet(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.cube.netStickers, false)[0];
    return hit ? hit.object.userData.index : -1;
  }

  // Rotation du cube au doigt sur un élément.
  enableDrag(el) {
    el.style.touchAction = 'none';
    let last = null, moved = 0;
    el.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; moved = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 4) return;
      this.cube.spinning = false;
      this.cube._orientToken = null;
      const k = 0.01;
      this.cube.root.quaternion
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * k))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * k));
    });
    const up = () => { last = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
