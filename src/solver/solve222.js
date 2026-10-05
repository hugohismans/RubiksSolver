// Solveur 2x2x2 optimal (nombre de mouvements minimal, ≤ 11).
// Le coin DBL reste fixe : seuls U, R et F sont utilisés. Recherche IDA*
// guidée par deux tables de distance (permutation et orientation des coins).

import { puzzle } from '../cube/nxn.js';

const P = puzzle(2);
const MOVES = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'"];
const FIXED = 6; // DBL
const SLOTS = [0, 1, 2, 3, 4, 5, 7];
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];

// Effet d'un mouvement sur les emplacements de coins : dest[i] et la
// position (0..2) où arrive chaque facette.
function cornerAction(perm) {
  const where = new Map();
  P.corners.forEach((c, j) => c.forEach((f, k) => where.set(f, [j, k])));
  return P.corners.map((c) => c.map((f) => where.get(perm[f])));
}
const ACTIONS = MOVES.map((m) => { const [mv] = P.parse(m); return cornerAction(P.movePerm(mv.face, mv.lo, mv.hi, mv.turns)); });

function applyAction(cp, co, act) {
  const np = cp.slice(), no = co.slice();
  for (let i = 0; i < 8; i++) {
    const [j, k] = act[i][co[i]];
    np[j] = cp[i];
    no[j] = k;
  }
  return [np, no];
}

function permIndex(cp) {
  const a = SLOTS.map((s) => cp[s]);
  let idx = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (a[j] < a[i]) smaller++;
    idx += smaller * FACT[6 - i];
  }
  return idx;
}
function permFromIndex(idx) {
  const pool = SLOTS.slice(), cp = new Array(8);
  cp[FIXED] = FIXED;
  for (let i = 0; i < 7; i++) {
    const f = FACT[6 - i], k = Math.floor(idx / f);
    idx %= f;
    cp[SLOTS[i]] = pool.splice(k, 1)[0];
  }
  return cp;
}
const twistIndex = (co) => SLOTS.reduce((t, s) => t * 3 + co[s], 0);
function twistFromIndex(idx) {
  const co = new Array(8).fill(0);
  for (let i = 6; i >= 0; i--) { co[SLOTS[i]] = idx % 3; idx = Math.floor(idx / 3); }
  return co;
}

let tables = null;
function init() {
  if (tables) return tables;
  const id = [0, 1, 2, 3, 4, 5, 6, 7], zero = new Array(8).fill(0);
  const pMove = Array.from({ length: 5040 }, (_, i) => {
    const cp = permFromIndex(i);
    return ACTIONS.map((a) => permIndex(applyAction(cp, zero, a)[0]));
  });
  const tMove = Array.from({ length: 2187 }, (_, i) => {
    const co = twistFromIndex(i);
    return ACTIONS.map((a) => twistIndex(applyAction(id, co, a)[1]));
  });
  const bfs = (n, mv, start) => {
    const d = new Int8Array(n).fill(-1);
    d[start] = 0;
    let frontier = [start];
    for (let depth = 0; frontier.length; depth++) {
      const next = [];
      for (const s of frontier) for (const t of mv[s]) if (d[t] < 0) { d[t] = depth + 1; next.push(t); }
      frontier = next;
    }
    return d;
  };
  tables = { pMove, tMove, pDist: bfs(5040, pMove, 0), tDist: bfs(2187, tMove, 0) };
  return tables;
}

// Lit l'état des coins (lettres URFDLB) ; null si impossible.
function readCorners(state) {
  const solvedCols = P.corners.map((c) => c.map((f) => P.solved[f]));
  const cp = new Array(8), co = new Array(8);
  for (let i = 0; i < 8; i++) {
    const cols = P.corners[i].map((f) => state[f]);
    const o = cols.findIndex((c) => c === 'U' || c === 'D');
    if (o < 0) return null;
    const piece = solvedCols.findIndex((sc) => sc[0] === cols[o] && sc[1] === cols[(o + 1) % 3] && sc[2] === cols[(o + 2) % 3]);
    if (piece < 0) return null;
    cp[i] = piece; co[i] = o;
  }
  if (new Set(cp).size !== 8 || cp[FIXED] !== FIXED || co[FIXED] !== 0) return null;
  if (co.reduce((a, b) => a + b, 0) % 3) return null;
  return { cp, co };
}

export function solve222(state) {
  const r = readCorners(state);
  if (!r) throw new Error('État 2x2 impossible');
  const { pMove, tMove, pDist, tDist } = init();
  const p0 = permIndex(r.cp), t0 = twistIndex(r.co);
  const path = [];
  const search = (p, t, depth, lastAxis) => {
    if (depth === 0) return p === 0 && t === 0;
    if (Math.max(pDist[p], tDist[t]) > depth) return false;
    for (let m = 0; m < 9; m++) {
      const axis = Math.floor(m / 3);
      if (axis === lastAxis) continue;
      path.push(m);
      if (search(pMove[p][m], tMove[t][m], depth - 1, axis)) return true;
      path.pop();
    }
    return false;
  };
  for (let depth = 0; depth <= 14; depth++) {
    if (search(p0, t0, depth, -1)) return path.map((m) => MOVES[m]).join(' ');
  }
  throw new Error('Pas de solution 2x2');
}

export { P as P222, readCorners };
