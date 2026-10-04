// Orientation d'une face scannée à partir des faces voisines visibles.
//
// Quand le cube est un peu incliné, le détecteur voit souvent une deuxième
// face qui touche la face principale par une arête. Sa couleur (centre) et
// le côté où elle se trouve (haut, droite, bas, gauche dans l'image) suffisent
// à savoir quelle couleur est « en haut » : on peut alors vérifier la consigne
// et même accepter une face tenue dans n'importe quel sens.

import { CANONICAL_NEIGHBORS } from '../cube/cube.js';

const SLOT_OF = { W: 'U', R: 'R', G: 'F', Y: 'D', O: 'L', B: 'B' };
const COLOR_OF = Object.fromEntries(Object.entries(SLOT_OF).map(([c, s]) => [s, c]));

// Faces qui partagent une arête avec `main`. side : 0 haut, 1 droite,
// 2 bas, 3 gauche (coins de `main` en ordre de lecture HG, HD, BD, BG).
export function adjacentFaces(main, faces) {
  const out = [];
  const mc = main.corners;
  const side = Math.sqrt(Math.abs(main.area)) || 1;
  for (const f of faces) {
    if (f === main) continue;
    // Seules les faces voisines bien formées comptent (évite les faux réseaux
    // mêlant des stickers et le décor).
    if (f.solid || f.members < 6 || (f.residual ?? 0) > 0.08) continue;
    let best = null;
    for (let e = 0; e < 4; e++) {
      const a = mc[e], b = mc[(e + 1) % 4];
      for (let k = 0; k < 4; k++) {
        const c = f.corners[k], d = f.corners[(k + 1) % 4];
        // Arête commune : extrémités proches (dans un sens ou dans l'autre).
        const dist = Math.min(
          Math.max(Math.hypot(a[0] - c[0], a[1] - c[1]), Math.hypot(b[0] - d[0], b[1] - d[1])),
          Math.max(Math.hypot(a[0] - d[0], a[1] - d[1]), Math.hypot(b[0] - c[0], b[1] - c[1])),
        );
        if (!best || dist < best.dist) best = { dist, side: e };
      }
    }
    // La face voisine doit être de l'autre côté de l'arête.
    if (best && best.dist < 0.15 * side) {
      const a = mc[best.side], b = mc[(best.side + 1) % 4];
      // L'arête commune a la même longueur des deux côtés.
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lb = Math.min(...[0, 1, 2, 3].map((k) => {
        const c = f.corners[k], d = f.corners[(k + 1) % 4];
        return Math.abs(Math.hypot(d[0] - c[0], d[1] - c[1]) - la);
      }));
      if (lb > 0.15 * la) continue;
      const nx = b[1] - a[1], ny = -(b[0] - a[0]); // normale (sens dépend de l'ordre)
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const toMain = (main.center[0] - mid[0]) * nx + (main.center[1] - mid[1]) * ny;
      const toOther = (f.center[0] - mid[0]) * nx + (f.center[1] - mid[1]) * ny;
      if (toMain * toOther < 0) out.push({ face: f, side: best.side });
    }
  }
  return out;
}

// Couleur en haut de l'image déduite d'une voisine de couleur `nColor` vue
// du côté `side` de la face `mainColor`. null si incohérent.
export function topFromNeighbor(mainColor, nColor, side) {
  const S = SLOT_OF[mainColor], T = SLOT_OF[nColor];
  if (!S || !T) return null;
  const N = CANONICAL_NEIGHBORS[S];
  const q = N.indexOf(T);
  if (q < 0) return null; // pas voisine (opposée ou identique) : erreur de lecture
  const r = (((q - side) % 4) + 4) % 4;
  return COLOR_OF[N[r]];
}
