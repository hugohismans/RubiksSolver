// Scan complet avec une fausse caméra (vidéo .y4m) : vérifie que l'état
// reconstruit est exactement celui du cube filmé.
// Usage : node tests/e2e/scan.mjs <video.y4m> <état54>
import { chromium } from 'playwright';
import path from 'node:path';

const [video, expected] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.resolve(video)}`,
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + (process.env.DEBUG ? '?debug=1' : ''));
await page.click('#btn-scan');
const t0 = Date.now();
let shot = 0;
while (Date.now() - t0 < 90000) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    done: document.getElementById('review').classList.contains('active'),
    hint: document.getElementById('hint').textContent,
    n: window.__app.scan.session ? window.__app.scan.session.history.map((c) => c + ':' + window.__app.scan.session.scans[c].top).join(',') : 0,
  }));
  if (shot++ % 5 === 2) await page.screenshot({ path: `tests/out/e2e-scan-${shot}.png` });
  process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(0)}s ${st.n} faces] ${st.hint}\n`);
  if (st.done) break;
}
await page.screenshot({ path: 'tests/out/e2e-scan-review.png' });
const got = await page.evaluate(() => window.__app.review.facelets && window.__app.review.facelets.join(''));
console.log('attendu :', expected);
console.log('obtenu  :', got);
const diff = got ? [...expected].filter((c, i) => c !== got[i]).length : 54;
console.log(got === expected ? 'SCAN EXACT ✓' : `différences : ${diff} cases`);
console.log('erreurs:', errors.length ? errors : 'aucune');
await browser.close();
process.exit(got === expected ? 0 : 1);
