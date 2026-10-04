// Scan libre de bout en bout avec fausse caméra : on doit arriver à la
// solution avec l'état exact du cube.
// Usage : node tests/e2e/free-scan.mjs <video.y4m> <état54>
import { chromium } from 'playwright';
import path from 'node:path';

const [video, expected] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.resolve(video)}`, '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'], ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.click('#btn-scan');
const t0 = Date.now();
let shots = 0, state = null;
while (Date.now() - t0 < (+process.env.TIMEOUT || 120000)) {
  await page.waitForTimeout(1000);
  state = await page.evaluate(() => ({
    screen: document.querySelector('.screen.active').id,
    complete: document.getElementById('scan').classList.contains('complete'),
    hint: document.getElementById('hint').textContent,
    count: document.getElementById('mini-count').textContent,
  }));
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${state.screen} ${state.count} ${state.hint}`);
  if ([3, 6, 10].includes(++shots)) await page.screenshot({ path: `tests/out/free-${shots}.png` });
  if (state.complete) { await page.waitForTimeout(700); await page.screenshot({ path: 'tests/out/free-complete.png' }); }
  if (state.screen !== 'scan') break;
}
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/out/free-end.png' });
if (state.screen === 'scan') {
  // Diagnostic : état du modèle 3D.
  console.log(await page.evaluate(() => {
    const m = window.__app.scan.model;
    return [...m.faces.values()].map((f) => `${f.color} ${f.n} ` + [...Array(9).keys()].map((k) => {
      const e = m.cellEstimate(f, k);
      return (m.cellKnown(f, k) ? '■' : '□') + (e ? `${e.n}/${e.w.toFixed(1)}` : '0');
    }).join(' ')).join('\n');
  }));
}
const got = await page.evaluate(() => window.__app.review.facelets && window.__app.review.facelets.join(''));
console.log('écran final :', state.screen);
console.log('attendu :', expected);
console.log('obtenu  :', got);
console.log(got === expected ? 'SCAN LIBRE EXACT ✓' : 'différent');
console.log('erreurs:', errors.length ? errors : 'aucune');
await browser.close();
process.exit(got === expected ? 0 : 1);
