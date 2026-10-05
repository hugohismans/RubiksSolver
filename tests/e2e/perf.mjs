// Mesure de la consommation : temps CPU du fil principal, images 3D rendues,
// durée de détection — à l'accueil, pendant le scan, sur la solution.
// CPU=4 : processeur ralenti 4× (téléphone d'entrée de gamme).
// Usage : node tests/e2e/perf.mjs <video.y4m>
import { chromium } from 'playwright';
import path from 'node:path';

const [video] = process.argv.slice(2);
const slow = +(process.env.CPU || 1);
const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.resolve(video)}`, '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
if (slow > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

async function measure(label, seconds = 8) {
  const a = await metrics();
  const f0 = await page.evaluate(() => window.__app.stage.renderer.info.render.frame);
  const d0 = await page.evaluate(() => (window.__app.scan.scanner ? window.__app.scan.scanner.frameId : 0));
  await page.waitForTimeout(seconds * 1000);
  const b = await metrics();
  const f1 = await page.evaluate(() => window.__app.stage.renderer.info.render.frame);
  const d = await page.evaluate(() => {
    const s = window.__app.scan.scanner;
    return s ? { id: s.frameId, ms: s.last && s.last.ms } : { id: 0, ms: 0 };
  });
  const busy = (b.TaskDuration - a.TaskDuration) / seconds;
  console.log(`${label.padEnd(10)} fil principal occupé ${(busy * 100).toFixed(0).padStart(3)}% · rendus 3D ${((f1 - f0) / seconds).toFixed(0).padStart(3)}/s · détections ${((d.id - d0) / seconds).toFixed(1)}/s (${d.ms ? d.ms.toFixed(0) : '-'} ms)`);
}

await page.goto(base);
await page.waitForTimeout(3000);
await measure('accueil');
await page.click('#btn-scan');
await page.waitForTimeout(4000);
await measure('scan');
await page.goto(base + '?state=' + 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB'.replace('UUUUUUUUURRR', 'UUUUUUURRRRR'));
await page.evaluate(() => window.__app.openSolve('DUUBULDBFRBFRRULLLBRDFFFBLURDBFDFDRFRULBLUFDURRBLBDUDL', { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' }));
await page.waitForTimeout(9000);
await measure('solution');
await browser.close();
