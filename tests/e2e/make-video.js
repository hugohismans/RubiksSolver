// Fabrique une vidéo .y4m (fausse caméra pour Chrome) montrant les 6 faces
// d'un cube donné, dans l'ordre et l'orientation demandés par l'app.
// Usage : node tests/e2e/make-video.js <état54> <sortie.y4m> [style] [palette]
import fs from 'node:fs';
import { generate } from '../lib/synth.js';
import { STEPS } from '../../src/scan/session.js';

const [state, out, style = 'stickerless', palette = 'neon'] = process.argv.slice(2);
const SLOT = { W: 'U', R: 'R', G: 'F', Y: 'D', O: 'L', B: 'B' };
const COLOR = Object.fromEntries(Object.entries(SLOT).map(([c, s]) => [s, c]));
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
const common = { width: W, height: H, style, palette, tilt: 4, faceFrac: 0.45, background: 'tiles', hand: true, noise: 2 };
// TILT=1 : cube incliné (le dessus est visible). WRONG=1 : blanc et jaune
// montrés avec le vert en haut au lieu du bleu (l'app doit le détecter).
const tilt = process.env.TILT ? [24, 12, 0] : [0, 0, 0];
const wrong = !!process.env.WRONG;
let seed = 1000;
// Transition : décor seul.
const blank = toY4mFrame(generate(seed++, { ...common, noCube: true }).image);
for (let k = 0; k < 8; k++) fs.writeSync(fd, blank);
for (const step of STEPS) {
  const slot = SLOT[step.color];
  const top = SLOT[wrong && step.group === 'cap' ? 'G' : step.top];
  for (let v = 0; v < 6; v++) {
    const cube = { state, front: slot, top, colorOfSlot: COLOR };
    const frame = toY4mFrame(generate(seed, { ...common, cube, pose: tilt, logo: true, poseSeed: v }).image);
    for (let r = 0; r < 4; r++) fs.writeSync(fd, frame);
  }
  seed++;
  for (let k = 0; k < 10; k++) fs.writeSync(fd, blank);
  process.stdout.write(step.color + ' ');
}
fs.closeSync(fd);
console.log('->', out);
