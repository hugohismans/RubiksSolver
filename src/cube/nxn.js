// Modèle générique d'un cube N×N×N (2x2, 3x3, 4x4…), en facettes.
//
// Même convention que cube.js (Kociemba) : faces dans l'ordre U R F D L B,
// N×N cases chacune en ordre de lecture ; U vu de dessus (B en haut), D vu de
// dessous (F en haut), R F L B vues de face avec U en haut.
//
// Coordonnées « doublées » (entiers) : les cubies sont centrés en
// -(N-1), …, N-3, N-1 et la surface est à ±N.

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const FACE_AXIS = { U: [1, 1], D: [1, -1], R: [0, 1], L: [0, -1], F: [2, 1], B: [2, -1] };
export const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

// Quart de tour horaire (vu de l'extérieur de la face d'axe `axis`, signe `sign`).
function rotQuarter(v, axis, sign) {
  const [x, y, z] = v;
  if (axis === 0) return sign > 0 ? [x, z, -y] : [x, -z, y];
  if (axis === 1) return sign > 0 ? [-z, y, x] : [z, y, -x];
  return sign > 0 ? [y, -x, z] : [-y, x, z];
}

const cache = new Map();

export function puzzle(N) {
  if (cache.has(N)) return cache.get(N);
  const n2 = N * N, size = 6 * n2;
  const t = (k) => 2 * k - (N - 1);
  const geometry = [];
  const add = (fn, normal) => {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const pos = fn(r, c);
      const cubie = pos.map((v) => (Math.abs(v) === N ? Math.sign(v) * (N - 1) : v));
      geometry.push({ pos, normal, cubie, r, c });
    }
  };
  add((r, c) => [t(c), N, t(r)], [0, 1, 0]); // U
  add((r, c) => [N, -t(r), -t(c)], [1, 0, 0]); // R
  add((r, c) => [t(c), -t(r), N], [0, 0, 1]); // F
  add((r, c) => [t(c), -N, -t(r)], [0, -1, 0]); // D
  add((r, c) => [-N, -t(r), t(c)], [-1, 0, 0]); // L
  add((r, c) => [-t(c), -t(r), -N], [0, 0, -1]); // B
  const key = (p, n) => `${p.join(',')}|${n.join(',')}`;
  const indexOf = new Map(geometry.map((g, i) => [key(g.pos, g.normal), i]));

  // Quart de tour d'une seule couche : perm[i] = destination de la facette i.
  // Couche 1 = la face elle-même, couche N = la face opposée.
  const layerPerm = {};
  for (const f of FACES) {
    const [axis, sign] = FACE_AXIS[f];
    layerPerm[f] = [];
    for (let L = 1; L <= N; L++) {
      const coord = sign * (N + 1 - 2 * L);
      layerPerm[f][L] = geometry.map((g, i) => {
        if (g.cubie[axis] !== coord) return i;
        return indexOf.get(key(rotQuarter(g.pos, axis, sign), rotQuarter(g.normal, axis, sign)));
      });
    }
  }

  // Permutation d'un mouvement : couches lo..hi de la face, `turns` quarts.
  const permCache = new Map();
  function movePerm(face, lo, hi, turns) {
    const k = `${face}${lo}-${hi}:${turns}`;
    if (permCache.has(k)) return permCache.get(k);
    let perm = geometry.map((_, i) => i);
    for (let q = 0; q < ((turns % 4) + 4) % 4; q++) {
      for (let L = lo; L <= hi; L++) {
        const p = layerPerm[face][L];
        perm = perm.map((d) => p[d]);
      }
    }
    permCache.set(k, perm);
    return perm;
  }

  // Notation : R, R', R2 (face), Rw / 3Rw (bloc de 2 / 3 couches), 2R (seule
  // la 2e couche), r = Rw, x y z (cube entier).
  function parse(str) {
    return (str || '').trim().split(/\s+/).filter(Boolean).map((tok) => {
      const m = tok.match(/^(\d*)([URFDLBurfdlbxyz])(w?)(2|'|’|2'|’2)?$/);
      if (!m) throw new Error(`Mouvement inconnu : ${tok}`);
      const [, num, letter, w, suf] = m;
      const turns = suf && suf.startsWith('2') ? 2 : suf ? 3 : 1;
      if ('xyz'.includes(letter)) {
        const face = { x: 'R', y: 'U', z: 'F' }[letter];
        return { face, lo: 1, hi: N, turns, text: tok };
      }
      const face = letter.toUpperCase();
      const wide = !!w || letter !== face;
      const k = num ? parseInt(num, 10) : wide ? 2 : 1;
      const lo = wide ? 1 : k, hi = Math.min(N, k);
      return { face, lo, hi, turns, text: tok };
    });
  }

  function apply(state, moves) {
    let s = typeof state === 'string' ? state.split('') : state.slice();
    for (const m of typeof moves === 'string' ? parse(moves) : moves) {
      const perm = movePerm(m.face, m.lo, m.hi, m.turns);
      const out = new Array(size);
      for (let i = 0; i < size; i++) out[perm[i]] = s[i];
      s = out;
    }
    return typeof state === 'string' ? s.join('') : s;
  }

  // Pièces : facettes regroupées par cubie.
  const byCubie = new Map();
  geometry.forEach((g, i) => {
    const k = g.cubie.join(',');
    if (!byCubie.has(k)) byCubie.set(k, []);
    byCubie.get(k).push(i);
  });
  const corners = [], edges = [], centers = [];
  for (const list of byCubie.values()) {
    if (list.length === 3) corners.push(list);
    else if (list.length === 2) edges.push(list);
    else centers.push(list[0]);
  }
  // Coins dans l'ordre de cube.js (URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB),
  // facettes dans le sens horaire en commençant par U/D.
  const at = (f, r, c) => FACES.indexOf(f) * n2 + r * N + c;
  const E = N - 1;
  const CORNERS = [
    [at('U', E, E), at('R', 0, 0), at('F', 0, E)],
    [at('U', E, 0), at('F', 0, 0), at('L', 0, E)],
    [at('U', 0, 0), at('L', 0, 0), at('B', 0, E)],
    [at('U', 0, E), at('B', 0, 0), at('R', 0, E)],
    [at('D', 0, E), at('F', E, E), at('R', E, 0)],
    [at('D', 0, 0), at('L', E, E), at('F', E, 0)],
    [at('D', E, 0), at('B', E, E), at('L', E, 0)],
    [at('D', E, E), at('R', E, E), at('B', E, 0)],
  ];

  // Arêtes : orbites sous les mouvements. Pour N pair, chaque « aile » a
  // un sens fixe : on oriente chaque emplacement de façon cohérente avec les
  // mouvements (la facette 0 va toujours sur la facette 0).
  const gens = [];
  for (const f of FACES) for (let L = 1; L <= N; L++) gens.push(layerPerm[f][L]);
  const edgeOrbits = orbitsOf(edges.map((e) => e.slice()), gens);
  const centerOrbits = orbitsOf(centers.map((c) => [c]), gens).map((o) => o.map((x) => x[0]));

  const solved = FACES.map((f) => f.repeat(n2)).join('');
  const P = {
    N, n2, size, geometry, solved, faces: FACES, at, corners: CORNERS, edgeOrbits, centerOrbits,
    parse, apply, movePerm, layerPerm,
    faceOf: (i) => FACES[Math.floor(i / n2)],
    invert(str) {
      return parse(str).reverse().map((m) => (/['’]$/.test(m.text) ? m.text.slice(0, -1) : m.text.endsWith('2') ? m.text : `${m.text}'`)).join(' ');
    },
    isSolved(state) {
      for (let f = 0; f < 6; f++) for (let k = 1; k < n2; k++) if (state[f * n2 + k] !== state[f * n2]) return false;
      return true;
    },
  };
  cache.set(N, P);
  return P;
}

// Orbites des pièces (listes ordonnées de facettes) sous les générateurs,
// avec une orientation cohérente : l'image de la facette k d'une pièce est
// la facette k de la pièce d'arrivée.
function orbitsOf(pieces, gens) {
  const owner = new Map();
  pieces.forEach((p, k) => p.forEach((f) => owner.set(f, k)));
  const oriented = new Array(pieces.length).fill(null);
  const orbits = [];
  for (let s = 0; s < pieces.length; s++) {
    if (oriented[s]) continue;
    oriented[s] = pieces[s];
    const orbit = [s], queue = [s];
    while (queue.length) {
      const k = queue.shift();
      for (const g of gens) {
        const img = oriented[k].map((f) => g[f]);
        const j = owner.get(img[0]);
        if (!oriented[j]) { oriented[j] = img; orbit.push(j); queue.push(j); }
      }
    }
    orbits.push(orbit.map((k) => oriented[k]));
  }
  return orbits;
}
