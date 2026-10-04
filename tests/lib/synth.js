// Générateur d'images synthétiques de Rubik's cube (lancer de rayons simple).
// Sert à mesurer le détecteur sur des milliers de cas variés et connus :
// cubes à bords noirs ou sans stickers, rainures plus ou moins visibles,
// logos, carrelage en perspective, main, reflets, bruit, dominante couleur.

export const PALETTES = {
  classic: { W: [240, 240, 236], Y: [255, 213, 0], R: [196, 30, 58], O: [255, 88, 0], B: [0, 81, 186], G: [0, 158, 96] },
  neon: { W: [236, 234, 226], Y: [250, 232, 40], R: [235, 30, 70], O: [255, 125, 55], B: [30, 115, 235], G: [110, 225, 60] },
  pastel: { W: [245, 245, 245], Y: [255, 238, 90], R: [225, 45, 45], O: [255, 150, 40], B: [40, 140, 240], G: [60, 200, 90] },
};
export const COLORS = ['W', 'Y', 'R', 'O', 'B', 'G'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };

function rotMat(ax, ay, az) {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mtv = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

// Faces du cube dans son repère (x droite, y bas, z vers l'avant/loin).
// La face 0 (-z) regarde la caméra : u = +x, v = +y => ordre de lecture direct.
const FACES = [
  { axis: 2, sign: -1, u: [1, 0, 0], v: [0, 1, 0] },
  { axis: 2, sign: 1, u: [-1, 0, 0], v: [0, 1, 0] },
  { axis: 0, sign: 1, u: [0, 0, 1], v: [0, 1, 0] },
  { axis: 0, sign: -1, u: [0, 0, -1], v: [0, 1, 0] },
  { axis: 1, sign: -1, u: [1, 0, 0], v: [0, 0, 1] },
  { axis: 1, sign: 1, u: [1, 0, 0], v: [0, 0, -1] },
];

function sdRoundBox(px, py, h, r) {
  const qx = Math.abs(px) - h + r, qy = Math.abs(py) - h + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export function generate(seed, opts = {}) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const range = (a, b) => a + (b - a) * rnd();
  const W = opts.width || 360, H = opts.height || 480;
  const style = opts.style || pick(['black', 'stickerless', 'stickerless']);
  const pal = PALETTES[opts.palette || pick(Object.keys(PALETTES))];
  const ss = 2; // suréchantillonnage

  // Couleurs : chaque face a un centre distinct, le reste est mélangé.
  const centers = COLORS.slice().sort(() => rnd() - 0.5);
  const solvedFace = opts.solved ?? rnd() < 0.15;
  const faces = FACES.map((_, k) => {
    const cells = [];
    for (let c = 0; c < 9; c++) cells.push(c === 4 || solvedFace ? centers[k] : pick(COLORS));
    if (k === 0 && opts.frontColors) return opts.frontColors.slice();
    return cells;
  });
  // Variation de teinte par pièce (plastique) et par image.
  const jitter = () => [range(-8, 8), range(-8, 8), range(-8, 8)];
  const pieceJitter = faces.map(() => Array.from({ length: 9 }, jitter));

  const tilt = opts.tilt ?? 35;
  let R, f, dist, t, faceFrac;
  const projectWith = (P) => {
    const w = mv(R, P);
    const c = [w[0] + t[0], w[1] + t[1], w[2] + t[2]];
    return [W / 2 + (f * c[0]) / c[2], H / 2 + (f * c[1]) / c[2]];
  };
  // Tire une pose jusqu'à ce que la face avant soit entièrement dans l'image.
  for (let tries = 0; tries < 50; tries++) {
    const ax = (range(-tilt, tilt) * Math.PI) / 180;
    const ay = (range(-tilt, tilt) * Math.PI) / 180;
    const az = (range(-22, 22) * Math.PI) / 180;
    R = rotMat(ax, ay, az);
    f = H * range(0.9, 1.4);
    faceFrac = opts.faceFrac ?? range(0.25, 0.6); // largeur de face / largeur image
    dist = (3 * f) / (faceFrac * W);
    t = [range(-0.15, 0.15) * W / f * dist, range(-0.15, 0.15) * H / f * dist, dist];
    const m = 0.03 * W;
    const ok = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]].every(([x, y]) => {
      const [px, py] = projectWith([x, y, -1.5]);
      return px > m && px < W - m && py > m && py < H - m;
    });
    if (ok) break;
  }
  const gapW = style === 'black' ? range(0.08, 0.16) : range(0.015, 0.05);
  const radius = style === 'black' ? range(0.03, 0.15) : range(0.08, 0.22);
  const grooveDark = range(0.25, 0.85); // 0.85 = rainure quasi invisible
  const logo = opts.logo ?? rnd() < 0.7;
  const noCube = !!opts.noCube;
  const capR = style === 'stickerless' ? range(0.25, 0.38) : 0;

  const light = (() => { const l = [range(-0.6, 0.6), range(-1, -0.2), -1]; const n = Math.hypot(...l); return l.map((x) => x / n); })();
  const ambient = range(0.35, 0.6), diffuse = range(0.4, 0.8);
  const cast = [range(0.85, 1.15), range(0.92, 1.08), range(0.85, 1.15)];
  const exposure = range(0.8, 1.25);
  const noise = opts.noise ?? range(1, 5);
  const bgKind = opts.background || pick(['tiles', 'tiles', 'plain', 'clutter']);
  const tileSize = range(0.6, 2.5);
  const floorPitch = range(0.6, 1.2);
  const floorDist = dist + range(2, 8);
  const tileBase = range(140, 210);
  const hand = opts.hand ?? rnd() < 0.6;
  const spec = rnd() < 0.5 ? { u: range(-1.4, 1.4), v: range(-1.4, 1.4), r: range(0.2, 0.6), k: range(0.2, 0.7) } : null;
  const clutter = Array.from({ length: 8 }, () => ({ x: rnd() * W, y: rnd() * H, w: range(20, 140), h: range(20, 140), c: [rnd() * 255, rnd() * 255, rnd() * 255] }));

  const linCol = (c) => [toLin(c[0]), toLin(c[1]), toLin(c[2])];

  function cubeColor(fi, u, v) {
    // u, v dans [-1.5, 1.5]
    const ci = Math.min(2, Math.floor(u + 1.5)), cj = Math.min(2, Math.floor(v + 1.5));
    const lu = u + 1.5 - ci - 0.5, lv = v + 1.5 - cj - 0.5;
    const name = faces[fi][cj * 3 + ci];
    const base = pal[name].map((x, k) => Math.max(0, Math.min(255, x + pieceJitter[fi][cj * 3 + ci][k])));
    const d = sdRoundBox(lu, lv, 0.5 - gapW / 2, radius);
    let col;
    if (style === 'black') {
      col = d < 0 ? base : [18, 18, 20];
    } else {
      col = d < 0 ? base : base.map((x) => x * grooveDark * 0.6);
    }
    if (ci === 1 && cj === 1 && logo && d < 0) {
      const rr = Math.hypot(lu, lv);
      if (capR && Math.abs(rr - capR) < 0.025) col = base.map((x) => x * 0.75);
      if (name === 'W' || rnd() < 0) {
        // Logo : quelques traits bleus/noirs au centre.
        const inLogo = (Math.abs(lu) < 0.16 && Math.abs(lv) < 0.04) || (Math.abs(lu + 0.08) < 0.035 && Math.abs(lv) < 0.15) || (Math.abs(lu - 0.1) < 0.03 && Math.abs(lv - 0.05) < 0.1);
        if (inLogo) col = [40, 100, 190];
      }
    }
    return col;
  }

  function shade(col, n, u, v) {
    const nd = Math.max(0, -(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]));
    let k = ambient + diffuse * nd;
    let s = 0;
    if (spec && n[2] < -0.5) s = spec.k * Math.exp(-((u - spec.u) ** 2 + (v - spec.v) ** 2) / (spec.r * spec.r));
    return linCol(col).map((c, i) => (c * k + s) * cast[i] * exposure);
  }

  function background(px, py) {
    if (hand) {
      const hx = W * 0.5 + t[0] * f / dist, hy = H * 0.5 + t[1] * f / dist + W * faceFrac * 0.65;
      const e = ((px - hx) / (W * 0.4)) ** 2 + ((py - hy) / (H * 0.25)) ** 2;
      if (e < 1) return linCol([225, 170, 140]).map((c) => c * (0.7 + 0.3 * (1 - e)) * exposure);
    }
    if (bgKind === 'clutter') {
      for (const c of clutter) if (px > c.x && px < c.x + c.w && py > c.y && py < c.y + c.h) return linCol(c.c).map((x) => x * exposure * 0.8);
    }
    if (bgKind === 'plain') return linCol([150, 140, 130]).map((c) => c * (0.6 + 0.4 * py / H) * exposure);
    // Sol carrelé : plan incliné.
    const d = [(px - W / 2) / f, (py - H / 2) / f, 1];
    const n = [0, -Math.cos(floorPitch), -Math.sin(floorPitch)];
    const p0 = [0, 0, floorDist];
    const den = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const tt = (p0[0] * n[0] + p0[1] * n[1] + p0[2] * n[2]) / den;
    if (tt <= 0 || !isFinite(tt)) return linCol([200, 200, 205]).map((c) => c * exposure);
    const hit = [d[0] * tt, d[1] * tt, d[2] * tt];
    const a = hit[0] / tileSize, b = (hit[2] * Math.cos(floorPitch) - hit[1] * Math.sin(floorPitch)) / tileSize;
    const fa = a - Math.floor(a), fb = b - Math.floor(b);
    const grout = fa < 0.03 || fa > 0.97 || fb < 0.03 || fb > 0.97;
    const tileVar = ((Math.floor(a) * 73856093) ^ (Math.floor(b) * 19349663)) % 10;
    const base = grout ? tileBase * 0.7 : tileBase + tileVar;
    return linCol([base, base, base * 1.02]).map((c) => c * exposure);
  }

  const lin = new Float32Array(W * H * 3);
  const mask = new Uint8Array(W * H);
  const Rt = R;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const x = px + (sx + 0.5) / ss, y = py + (sy + 0.5) / ss;
        const d = [(x - W / 2) / f, (y - H / 2) / f, 1];
        const o = mtv(Rt, [-t[0], -t[1], -t[2]]);
        const dd = mtv(Rt, d);
        // Intersection rayon / boîte [-1.5, 1.5]^3
        let tmin = -Infinity, tmax = Infinity, hitAxis = -1, hitSign = 0;
        for (let k = 0; k < 3; k++) {
          if (Math.abs(dd[k]) < 1e-12) { if (Math.abs(o[k]) > 1.5) { tmin = Infinity; } continue; }
          let t1 = (-1.5 - o[k]) / dd[k], t2 = (1.5 - o[k]) / dd[k];
          let s1 = -1;
          if (t1 > t2) { [t1, t2] = [t2, t1]; s1 = 1; }
          if (t1 > tmin) { tmin = t1; hitAxis = k; hitSign = s1; }
          if (t2 < tmax) tmax = t2;
        }
        let col;
        if (!noCube && tmin < tmax && tmin > 0 && hitAxis >= 0) {
          const p = [o[0] + dd[0] * tmin, o[1] + dd[1] * tmin, o[2] + dd[2] * tmin];
          const fi = FACES.findIndex((F) => F.axis === hitAxis && F.sign === hitSign);
          const F = FACES[fi];
          const u = p[0] * F.u[0] + p[1] * F.u[1] + p[2] * F.u[2];
          const v = p[0] * F.v[0] + p[1] * F.v[1] + p[2] * F.v[2];
          const nrm = [0, 0, 0]; nrm[hitAxis] = hitSign;
          col = shade(cubeColor(fi, u, v), mv(R, nrm), u, v);
          mask[py * W + px] = 1;
        } else {
          col = background(x, y);
        }
        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
      }
      const q = (py * W + px) * 3;
      lin[q] = acc[0] / (ss * ss); lin[q + 1] = acc[1] / (ss * ss); lin[q + 2] = acc[2] / (ss * ss);
    }
  }
  const data = new Uint8ClampedArray(W * H * 4);
  // Bruit gaussien (Box-Muller)
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = toSrgb(lin[i * 3 + c]) + gauss() * noise;
    data[i * 4 + 3] = 255;
  }

  // Vérité terrain : centres projetés des 9 cases de la face avant.
  const project = projectWith;
  const gtCenters = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) gtCenters.push(project([i - 1, j - 1, -1.5]));
  return {
    image: { width: W, height: H, data },
    gt: { mask: Buffer.from(mask).toString('base64'), colors: faces[0].slice(), centers: gtCenters, palette: pal, style, logo, solvedFace, bgKind, grooveDark },
  };
}
