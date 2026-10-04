// Vidéo .y4m d'un cube qui tourne librement (scan libre).
// Usage : node tests/e2e/make-free-video.js <état54> <sortie.y4m> [style] [palette]
import fs from 'node:fs';
import { generate } from '../lib/synth.js';
import { trajectory } from '../free-scan-sim.js';

const [state, out, style = 'stickerless', palette = 'neon'] = process.argv.slice(2);
const COLOR = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const W = 480, H = 640, FPS = 10;

function toY4mFrame(img) {
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  const d = img.data;
  for (let i = 0; i < W * H; i++) Y[i] = Math.max(0, Math.min(255, 0.257 * d[i * 4] + 0.504 * d[i * 4 + 1] + 0.098 * d[i * 4 + 2] + 16));
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
const poses = trajectory(10);
poses.forEach((pose, k) => {
  const { image } = generate(77, { width: W, height: H, style, palette, cube: { state, front: 'F', top: 'U', colorOfSlot: COLOR }, pose, tilt: 3, faceFrac: 0.4, logo: true, poseSeed: k, hand: true, background: 'tiles', noise: 2 });
  const f = toY4mFrame(image);
  fs.writeSync(fd, f); fs.writeSync(fd, f); fs.writeSync(fd, f);
});
fs.closeSync(fd);
console.log(`${poses.length} poses ->`, out);
