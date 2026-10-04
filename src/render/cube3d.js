// Rendu 3D du cube (Three.js) : état, animation des mouvements, orientation.

import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../vendor/three/addons/RoundedBoxGeometry.js';
import { FACELET_GEOMETRY, FACES, SOLVED, applyMove } from '../cube/cube.js';

const FACE_AXIS = { U: [1, 1], D: [1, -1], R: [0, 1], L: [0, -1], F: [2, 1], B: [2, -1] };
const NORMAL = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };

function roundedSquare(size, r) {
  const s = new THREE.Shape();
  const h = size / 2;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ShapeGeometry(s, 4);
}

export class Cube3D {
  constructor(container, { interactive = true, colors = {}, fov = 30, distance = 11 } = {}) {
    this.container = container;
    this.colors = { U: '#f4f4f0', R: '#d7263d', F: '#2fbf4a', D: '#ffd500', L: '#ff7a1a', B: '#1f6fe0', ...colors };
    this.state = SOLVED;
    this.queue = Promise.resolve();
    this.speed = 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    this.camera.position.set(0, 0, distance);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-6, -2, 4);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.setDefaultView(false);

    const bodyGeo = new RoundedBoxGeometry(0.96, 0.96, 0.96, 3, 0.1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.6 });
    const stickerGeo = roundedSquare(0.84, 0.12);
    this.cubies = [];
    this.stickers = new Array(54);
    const cubieAt = new Map();
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat));
      g.userData.home = new THREE.Vector3(x, y, z);
      g.position.copy(g.userData.home);
      this.root.add(g);
      this.cubies.push(g);
      cubieAt.set(`${x},${y},${z}`, g);
    }
    FACELET_GEOMETRY.forEach((fg, i) => {
      const g = cubieAt.get(fg.pos.join(','));
      const m = new THREE.Mesh(stickerGeo, new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.35, side: THREE.DoubleSide }));
      const n = new THREE.Vector3(...fg.normal);
      m.position.copy(n.clone().multiplyScalar(0.484));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      g.add(m);
      this.stickers[i] = m;
    });
    this.setState(SOLVED);

    if (interactive) this.enableDrag();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      // Pas de rendu quand le cube n'est pas affiché (économie de batterie).
      if (this.container.offsetParent !== null) {
        this.tick && this.tick();
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    // Garde le cube entier visible en portrait.
    this.camera.zoom = Math.min(1, (w / h) * 1.1);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.running = false;
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setColors(colors) {
    Object.assign(this.colors, colors);
    this.setState(this.state);
  }

  // Remet chaque pièce à sa place et colore selon la chaîne de facettes.
  setState(facelets) {
    this.state = facelets;
    for (const c of this.cubies) {
      c.position.copy(c.userData.home);
      c.quaternion.identity();
      if (c.parent !== this.root) this.root.attach(c);
    }
    this.stickers.forEach((m, i) => m.material.color.set(this.colors[facelets[i]] || '#555'));
  }

  // Couleurs arbitraires par facette (guide de scan).
  setStickerColors(cssArray) {
    for (const c of this.cubies) { c.position.copy(c.userData.home); c.quaternion.identity(); }
    this.stickers.forEach((m, i) => m.material.color.set(cssArray[i] || '#555'));
  }

  // Anime un mouvement, puis met à jour l'état. Les appels s'enchaînent.
  move(face, turns = 1, duration = 320) {
    this.queue = this.queue.then(() => this._animate(face, turns, duration / this.speed));
    return this.queue;
  }

  _animate(face, turns, duration) {
    const [axis, sign] = FACE_AXIS[face];
    const pivot = new THREE.Group();
    this.root.add(pivot);
    const layer = this.cubies.filter((c) => Math.round(c.userData.home.getComponent(axis)) === sign);
    // Les pièces sont à leur place d'origine (état recoloré après chaque coup).
    layer.forEach((c) => pivot.attach(c));
    const q = turns % 4 === 3 ? -1 : turns % 4;
    const angle = -sign * q * (Math.PI / 2);
    const axisVec = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
    const d = duration * (Math.abs(q) === 2 ? 1.4 : 1);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / d);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pivot.quaternion.setFromAxisAngle(axisVec, angle * e);
        if (t < 1) { requestAnimationFrame(step); return; }
        layer.forEach((c) => this.root.attach(c));
        this.root.remove(pivot);
        this.setState(applyMove(this.state, face, turns));
        resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // Oriente le cube : face `front` vers la caméra, face `top` en haut,
  // avec une légère inclinaison pour voir aussi le dessus et un côté.
  setView(front, top, animate = true, tilt = [0.42, -0.5]) {
    const nf = new THREE.Vector3(...NORMAL[front]), nt = new THREE.Vector3(...NORMAL[top]);
    const nx = new THREE.Vector3().crossVectors(nt, nf);
    const m = new THREE.Matrix4().set(
      nx.x, nx.y, nx.z, 0,
      nt.x, nt.y, nt.z, 0,
      nf.x, nf.y, nf.z, 0,
      0, 0, 0, 1,
    );
    const base = new THREE.Quaternion().setFromRotationMatrix(m);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], tilt[1], 0, 'XYZ'));
    const target = tq.multiply(base);
    if (!animate) { this.root.quaternion.copy(target); this.tick = null; return; }
    const from = this.root.quaternion.clone();
    const t0 = performance.now();
    this.tick = () => {
      const t = Math.min(1, (performance.now() - t0) / 700);
      const e = 1 - Math.pow(1 - t, 3);
      this.root.quaternion.slerpQuaternions(from, target, e);
      if (t >= 1) this.tick = null;
    };
  }

  // Oriente le cube par une matrice 3x3 (lignes) repère cube -> repère vue,
  // puis applique une inclinaison fixe pour montrer trois faces.
  setMatrix(rows, animate = true, tilt = [0.38, -0.5]) {
    const m = new THREE.Matrix4().set(
      rows[0][0], rows[0][1], rows[0][2], 0,
      rows[1][0], rows[1][1], rows[1][2], 0,
      rows[2][0], rows[2][1], rows[2][2], 0,
      0, 0, 0, 1,
    );
    const base = new THREE.Quaternion().setFromRotationMatrix(m);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], tilt[1], 0, 'XYZ')).multiply(base);
    if (!animate) { this.root.quaternion.copy(target); this.tick = null; return; }
    const from = this.root.quaternion.clone();
    if (from.angleTo(target) < 1e-3) return;
    const t0 = performance.now();
    this.tick = () => {
      const t = Math.min(1, (performance.now() - t0) / 450);
      this.root.quaternion.slerpQuaternions(from, target, 1 - Math.pow(1 - t, 3));
      if (t >= 1) this.tick = null;
    };
  }

  // Rotation lente et continue (en attente).
  spin(on) {
    if (!on) { if (this.tick && this.tick.spin) this.tick = null; return; }
    if (this.tick && this.tick.spin) return;
    const f = () => this.root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), 0.012);
    f.spin = true;
    this.tick = f;
  }

  setDefaultView(animate = true) {
    this.setView('F', 'U', animate);
  }

  enableDrag() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    let last = null;
    el.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); this.tick = null; });
    el.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      const k = 0.01;
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * k);
      const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * k);
      this.root.quaternion.premultiply(qy).premultiply(qx);
    });
    const up = () => { last = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}

export { FACES };
