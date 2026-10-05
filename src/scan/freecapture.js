// Capture des faces en mode libre, pensée pour une vraie main qui bouge.
//
// - Plusieurs faces suivies en même temps (vue de coin : 2 ou 3 faces).
// - Stabilité mesurée par rapport à la moyenne récente du suivi (et non à
//   l'image précédente) : 7 cases sur 9 suffisent, quelques images ratées
//   sont tolérées.
// - Une face n'est « déjà vue » que si son MOTIF correspond à une capture
//   (sous l'une des 4 rotations), pas seulement la couleur de son centre :
//   sous une lumière chaude, rouge et orange se ressemblent beaucoup.
// - L'étiquette de couleur est choisie parmi les couleurs pas encore vues.

import { labDist, chroma, hueDeg } from '../vision/color.js';
import { rotateGrid } from '../cube/cube.js';

const COLORS = ['W', 'Y', 'R', 'O', 'B', 'G'];
const HUE = { R: 25, O: 55, Y: 92, G: 140, B: 265 };

function medianLabs(frames) {
  return Array.from({ length: 9 }, (_, k) => [0, 1, 2].map((c) => {
    const v = frames.map((f) => f[k][c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  }));
}

// Nombre de cases qui concordent entre deux grilles, sous la meilleure des
// 4 rotations (une face revue sous un autre angle ou dans un autre sens).
// Deux cases sont « pareilles » si elles ont la même teinte (la saturation et
// la luminosité varient beaucoup avec l'angle et l'éclairage), ou si elles
// sont toutes deux peu saturées (blanc).
export function sameSticker(p, q) {
  const cp = chroma(p), cq = chroma(q);
  if (cp < 24 || cq < 24) return cp < 30 && cq < 30;
  const d = Math.abs(hueDeg(p) - hueDeg(q));
  return Math.min(d, 360 - d) < 16;
}

export function patternMatch(a, b) {
  let best = 0;
  for (let k = 0; k < 4; k++) {
    const g = rotateGrid(a, k);
    let n = 0;
    for (let i = 0; i < 9; i++) if (sameSticker(g[i], b[i])) n++;
    best = Math.max(best, n);
  }
  return best;
}

// Ressemblance d'un centre avec chaque couleur (plus petit = plus proche).
export function colorScore(lab, color) {
  const c = chroma(lab), h = hueDeg(lab);
  if (color === 'W') return c < 30 ? c : 60 + c;
  if (c < 18) return 80;
  const d = Math.abs(h - HUE[color]);
  return Math.min(d, 360 - d);
}

export class FreeCapture {
  constructor({ stableFrames = 5, stableMs = 550, minSquareness = 0.33 } = {}) {
    this.opts = { stableFrames, stableMs, minSquareness };
    this.tracks = [];
    this.captures = {}; // couleur -> { labs }
  }

  get count() { return Object.keys(this.captures).length; }
  get done() { return this.count === 6; }
  missing() { return COLORS.filter((c) => !this.captures[c]); }

  // Capture existante dont le motif correspond (ou null).
  seenAs(labs) {
    for (const [color, cap] of Object.entries(this.captures)) {
      if (sameSticker(cap.labs[4], labs[4]) && patternMatch(cap.labs, labs) >= 7) return color;
    }
    return null;
  }

  // Couleur à donner à une nouvelle face : la plus proche parmi celles
  // qui n'ont pas encore été capturées.
  chooseLabel(center) {
    const free = this.missing();
    if (!free.length) return null;
    return free.slice().sort((a, b) => colorScore(center, a) - colorScore(center, b))[0];
  }

  add(color, labs) {
    this.captures[color] = { labs };
  }

  remove(color) {
    delete this.captures[color];
  }

  // faces : faces détectées dans l'image. Renvoie les captures faites et
  // l'état du suivi le plus avancé (pour la consigne et la jauge).
  update(faces, now) {
    const captured = [], seen = [];
    const usable = faces.filter((f) => (f.members >= 5 || f.solid || f.neighborOf) && f.squareness >= this.opts.minSquareness);
    for (const f of usable) {
      const labs = f.cells.map((c) => c.lab);
      const already = this.seenAs(labs);
      if (already) { seen.push(already); continue; }
      const center = labs[4];
      let tr = this.tracks.find((t) => sameSticker(center, t.center) && t.updated !== now);
      if (!tr) {
        tr = { center, frames: [labs], t0: now, last: now, bad: 0, face: f };
        this.tracks.push(tr);
      } else {
        const med = medianLabs(tr.frames);
        const ok = labs.filter((l, k) => sameSticker(l, med[k])).length >= 7;
        if (ok) {
          tr.frames.push(labs);
          if (tr.frames.length > 12) tr.frames.shift();
          tr.bad = 0;
        } else if (++tr.bad > 3) {
          tr.frames = [labs];
          tr.t0 = now;
          tr.bad = 0;
        }
        tr.center = medianLabs(tr.frames)[4];
        tr.last = now;
        tr.face = f;
      }
      tr.updated = now;
    }
    // Suivis abandonnés (face disparue).
    this.tracks = this.tracks.filter((t) => now - t.last < 800);
    let best = null;
    for (const tr of this.tracks) {
      const progress = Math.min(1, tr.frames.length / this.opts.stableFrames, (now - tr.t0) / this.opts.stableMs);
      if (progress >= 1) {
        const labs = medianLabs(tr.frames);
        if (!this.seenAs(labs)) {
          const color = this.chooseLabel(labs[4]);
          if (color) { this.add(color, labs); captured.push({ color, labs }); }
        }
        tr.done = true;
        continue;
      }
      if (!best || progress > best.progress) best = { progress, guess: this.chooseLabel(tr.center), face: tr.face };
    }
    this.tracks = this.tracks.filter((t) => !t.done);
    return { captured, seen, tracking: best };
  }
}
