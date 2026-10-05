// Vidéo .y4m (fausse caméra) d'un 2x2 / 4x4 montré dans l'ordre du scan guidé.
// Usage : node tests/e2e/make-video-nxn.js <N> <état> <sortie.y4m> [style] [palette]
// RIGHT=1 : l'utilisateur tourne le cube vers la droite au lieu de la gauche.
import fs from 'node:fs';
import { generate } from '../lib/synth.js';

const [n, state, out, style = 'black', palette = 'classic'] = process.argv.slice(2);
const N = +n;
const COLOR = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const W = 480, H = 640, FPS = 10;

function toY4mFrame(img) {
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  const d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    Y[y * W + x] = Math.max(0, Math.min(255, 0.257 * d[p] + 0.504 * d[p + 1] + 0.098 * d[p + 2] + 16));
  }
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = ((2 * y + dy) * W + 2 * x + dx) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; }
    r /= 4; g /= 4; b /= 4;
    U[y * (W / 2) + x] = Math.max(0, Math.min(255, -0.148 * r - 0.291 * g + 0.439 * b + 128));
    V[y * (W / 2) + x] = Math.max(0, Math.min(255, 0.439 * r - 0.368 * g - 0.071 * b + 128));
  }
  return Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
}

const fd = fs.openSync(out, 'w');
fs.writeSync(fd, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
const common = { width: W, height: H, style, palette, tilt: 4, faceFrac: 0.45, background: 'tiles', hand: true, noise: 2, n: N };
const sides = process.env.RIGHT ? ['F', 'L', 'B', 'R'] : ['F', 'R', 'B', 'L'];
const views = [...sides.map((f) => [f, 'U']), ['U', 'B'], ['D', 'F']];
let seed = 2000;
const blank = toY4mFrame(generate(seed++, { ...common, noCube: true }).image);
for (let k = 0; k < 40; k++) fs.writeSync(fd, blank);
for (const [front, top] of views) {
  for (let v = 0; v < 6; v++) {
    const cube = { state, front, top, colorOfSlot: COLOR };
    const frame = toY4mFrame(generate(seed, { ...common, cube, poseSeed: v }).image);
    for (let r = 0; r < 4; r++) fs.writeSync(fd, frame);
  }
  seed++;
  for (let k = 0; k < 10; k++) fs.writeSync(fd, blank);
  process.stdout.write(front + ' ');
}
fs.closeSync(fd);
console.log('->', out);
