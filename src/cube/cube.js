// Modèle du cube en facettes, convention Kociemba :
//   chaîne de 54 lettres, faces dans l'ordre U R F D L B, 9 cases chacune
//   en ordre de lecture. U vu de dessus (B en haut), D vu de dessous
//   (F en haut), R F L B vues de face avec U en haut.

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const SOLVED = FACES.map((f) => f.repeat(9)).join('');

// Position 3D (x droite, y haut, z avant) et normale de chaque facette.
export const FACELET_GEOMETRY = (() => {
  const out = [];
  const add = (fn, normal) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push({ pos: fn(r, c), normal });
  };
  add((r, c) => [c - 1, 1, r - 1], [0, 1, 0]); // U
  add((r, c) => [1, 1 - r, 1 - c], [1, 0, 0]); // R
  add((r, c) => [c - 1, 1 - r, 1], [0, 0, 1]); // F
  add((r, c) => [c - 1, -1, 1 - r], [0, -1, 0]); // D
  add((r, c) => [-1, 1 - r, c - 1], [-1, 0, 0]); // L
  add((r, c) => [1 - c, 1 - r, -1], [0, 0, -1]); // B
  return out;
})();

const FACE_AXIS = { U: [1, 1], D: [1, -1], R: [0, 1], L: [0, -1], F: [2, 1], B: [2, -1] };

// Rotation d'un quart de tour horaire (vu de l'extérieur de la face).
function rotQuarter(v, axis, sign) {
  const [x, y, z] = v;
  // Rotation de -90° autour de l'axe sortant (sign * e_axis).
  if (axis === 0) return sign > 0 ? [x, z, -y] : [x, -z, y];
  if (axis === 1) return sign > 0 ? [-z, y, x] : [z, y, -x];
  return sign > 0 ? [y, -x, z] : [-y, x, z];
}

const key = (p, n) => `${p.join(',')}|${n.join(',')}`;
const INDEX_OF = new Map(FACELET_GEOMETRY.map((g, i) => [key(g.pos, g.normal), i]));

// Permutation d'un quart de tour : perm[i] = destination de la facette i.
const QUARTER = {};
for (const f of FACES) {
  const [axis, sign] = FACE_AXIS[f];
  QUARTER[f] = FACELET_GEOMETRY.map((g, i) => {
    if (g.pos[axis] !== sign) return i;
    const j = INDEX_OF.get(key(rotQuarter(g.pos, axis, sign), rotQuarter(g.normal, axis, sign)));
    return j;
  });
}

export function parseMoves(str) {
  return (str || '').trim().split(/\s+/).filter(Boolean).map((t) => {
    const m = t.match(/^([URFDLB])(2|'|’)?$/);
    if (!m) throw new Error(`Mouvement inconnu : ${t}`);
    return { face: m[1], turns: m[2] === '2' ? 2 : m[2] ? 3 : 1, text: t };
  });
}

export function applyMove(state, face, turns = 1) {
  let s = state;
  for (let k = 0; k < ((turns % 4) + 4) % 4; k++) {
    const out = new Array(54);
    const perm = QUARTER[face];
    for (let i = 0; i < 54; i++) out[perm[i]] = s[i];
    s = out.join('');
  }
  return s;
}

export function applyMoves(state, moves) {
  for (const m of typeof moves === 'string' ? parseMoves(moves) : moves) state = applyMove(state, m.face, m.turns);
  return state;
}

export function invertMoves(str) {
  return parseMoves(str).reverse().map((m) => m.face + (m.turns === 2 ? '2' : m.turns === 1 ? "'" : '')).join(' ');
}

// --- Pièces ---------------------------------------------------------------
const idx = (face, n) => FACES.indexOf(face) * 9 + n - 1;
export const CORNERS = [
  [idx('U', 9), idx('R', 1), idx('F', 3)],
  [idx('U', 7), idx('F', 1), idx('L', 3)],
  [idx('U', 1), idx('L', 1), idx('B', 3)],
  [idx('U', 3), idx('B', 1), idx('R', 3)],
  [idx('D', 3), idx('F', 9), idx('R', 7)],
  [idx('D', 1), idx('L', 9), idx('F', 7)],
  [idx('D', 7), idx('B', 9), idx('L', 7)],
  [idx('D', 9), idx('R', 9), idx('B', 7)],
];
export const EDGES = [
  [idx('U', 6), idx('R', 2)], [idx('U', 8), idx('F', 2)], [idx('U', 4), idx('L', 2)], [idx('U', 2), idx('B', 2)],
  [idx('D', 6), idx('R', 8)], [idx('D', 2), idx('F', 8)], [idx('D', 4), idx('L', 8)], [idx('D', 8), idx('B', 8)],
  [idx('F', 6), idx('R', 4)], [idx('F', 4), idx('L', 6)], [idx('B', 6), idx('L', 4)], [idx('B', 4), idx('R', 6)],
];
// Couleurs (= faces) de chaque pièce à l'état résolu.
export const CORNER_COLORS = CORNERS.map((c) => c.map((i) => FACES[Math.floor(i / 9)]));
export const EDGE_COLORS = EDGES.map((e) => e.map((i) => FACES[Math.floor(i / 9)]));

function permParity(p) {
  let parity = 0;
  const seen = new Array(p.length).fill(false);
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = p[j]) { seen[j] = true; len++; }
    parity ^= (len - 1) & 1;
  }
  return parity;
}

// Vérifie qu'une chaîne de facettes est un cube résoluble. Messages en français.
export function validateFacelets(s) {
  const errors = [];
  if (s.length !== 54) return { ok: false, errors: ['Il faut 54 cases.'] };
  const counts = {};
  for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
  for (const f of FACES) {
    if (s[FACES.indexOf(f) * 9 + 4] !== f) errors.push('Les centres ne sont pas cohérents.');
    if ((counts[f] || 0) !== 9) errors.push(`La couleur ${f} apparaît ${counts[f] || 0} fois au lieu de 9.`);
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const cp = [], co = [], ep = [], eo = [];
  for (let i = 0; i < 8; i++) {
    const cols = CORNERS[i].map((k) => s[k]);
    const ori = cols.findIndex((c) => c === 'U' || c === 'D');
    if (ori < 0) { errors.push('Un coin n’a ni blanc ni jaune (ou la couleur du haut/bas).'); continue; }
    const c1 = cols[(ori + 1) % 3], c2 = cols[(ori + 2) % 3];
    const piece = CORNER_COLORS.findIndex((pc) => pc[0] === cols[ori] && pc[1] === c1 && pc[2] === c2);
    if (piece < 0) { errors.push(`Coin impossible : ${cols.join('')}.`); continue; }
    cp.push(piece); co.push(ori);
  }
  for (let i = 0; i < 12; i++) {
    const cols = EDGES[i].map((k) => s[k]);
    let piece = EDGE_COLORS.findIndex((pc) => pc[0] === cols[0] && pc[1] === cols[1]);
    let ori = 0;
    if (piece < 0) { piece = EDGE_COLORS.findIndex((pc) => pc[0] === cols[1] && pc[1] === cols[0]); ori = 1; }
    if (piece < 0) { errors.push(`Arête impossible : ${cols.join('')}.`); continue; }
    ep.push(piece); eo.push(ori);
  }
  if (errors.length) return { ok: false, errors };
  if (new Set(cp).size !== 8) errors.push('Un même coin apparaît deux fois.');
  if (new Set(ep).size !== 12) errors.push('Une même arête apparaît deux fois.');
  if (errors.length) return { ok: false, errors };
  if (co.reduce((a, b) => a + b, 0) % 3) errors.push('Un coin est tourné sur lui-même (torsion impossible).');
  if (eo.reduce((a, b) => a + b, 0) % 2) errors.push('Une arête est retournée (impossible sans démonter le cube).');
  if (permParity(cp) !== permParity(ep)) errors.push('Deux pièces sont échangées (parité impossible).');
  return { ok: errors.length === 0, errors };
}

// --- Orientation des scans -------------------------------------------------
// Voisins de chaque face dans sa vue canonique : haut, droite, bas, gauche.
export const CANONICAL_NEIGHBORS = {
  U: ['B', 'R', 'F', 'L'],
  R: ['U', 'B', 'D', 'F'],
  F: ['U', 'R', 'D', 'L'],
  D: ['F', 'R', 'B', 'L'],
  L: ['U', 'F', 'D', 'B'],
  B: ['U', 'L', 'D', 'R'],
};

// Rotation horaire d'une grille 3x3 (k quarts de tour).
export function rotateGrid(cells, k) {
  let g = cells.slice();
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) {
    const n = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) n[c * 3 + (2 - r)] = g[r * 3 + c];
    g = n;
  }
  return g;
}

// Convertit un scan (face `slot` vue de face, avec la face `top` en haut de
// l'image) vers l'ordre canonique de la chaîne Kociemba.
export function scanToCanonical(slot, top, cells) {
  const p = CANONICAL_NEIGHBORS[slot].indexOf(top);
  if (p < 0) throw new Error(`${top} n'est pas voisine de ${slot}`);
  return rotateGrid(cells, p);
}
