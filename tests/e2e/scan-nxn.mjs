// Scan guidé d'un 2x2 / 4x4 avec une fausse caméra, puis résolution.
// Usage : node tests/e2e/scan-nxn.mjs <N> <video.y4m> <état>
import { chromium } from 'playwright';
import path from 'node:path';

const [n, video, expected] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.resolve(video)}`, '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.click(`#puzzles button[data-n="${n}"]`);
await page.waitForTimeout(500);
await page.click('#btn-scan');
const t0 = Date.now();
let shot = 0;
while (Date.now() - t0 < 120000) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    done: document.getElementById('review').classList.contains('active'),
    hint: document.getElementById('hint').textContent,
    k: window.__app.scan.nxn ? window.__app.scan.nxn.scans.length : -1,
  }));
  if (shot++ % 6 === 3) await page.screenshot({ path: `tests/out/e2e-nxn-scan-${n}-${shot}.png` });
  process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(0)}s ${st.k} faces] ${st.hint}\n`);
  if (st.done) break;
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `tests/out/e2e-nxn-review-${n}.png` });
const got = await page.evaluate(() => window.__app.review.facelets && window.__app.review.facelets.join(''));
const m = {};
let same = !!got && got.length === expected.length;
for (let i = 0; same && i < expected.length; i++) { if (m[expected[i]] === undefined) m[expected[i]] = got[i]; else if (m[expected[i]] !== got[i]) same = false; }
if (!same) {
  const dump = await page.evaluate(() => window.__app.scan.nxn.scans.map((s) => s.labs));
  (await import('node:fs')).writeFileSync('tests/out/nxn-scans.json', JSON.stringify(dump));
}
console.log(same ? 'SCAN EXACT ✓' : `scan différent\n attendu ${expected}\n obtenu  ${got}`);
if (same) {
  await page.click('#review-solve');
  await page.waitForFunction(() => /coups/.test(document.getElementById('solve-title').textContent), null, { timeout: 60000 });
  console.log('solution :', await page.textContent('#solve-title'));
}
console.log('erreurs:', errors.length ? errors : 'aucune');
await browser.close();
process.exit(same ? 0 : 1);
