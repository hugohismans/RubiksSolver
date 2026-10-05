// 2x2 / 4x4 : choix du cube, vérification d'un état mélangé, solution jouée jusqu'au bout.
import { chromium } from 'playwright';
import { puzzle } from '../../src/cube/nxn.js';
import { scramble } from '../test-nxn.js';

const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForTimeout(1200);
for (const n of [2, 4]) {
  await page.click(`#puzzles button[data-n="${n}"]`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `tests/out/e2e-home-${n}.png` });
}
let seed = 3;
const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (const n of [2, 4]) {
  const state = scramble(n, r);
  await page.goto(base + '?state=' + state);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `tests/out/e2e-review-${n}.png` });
  await page.click('#review-solve');
  await page.waitForFunction(() => /coups/.test(document.getElementById('solve-title').textContent), null, { timeout: 60000 });
  const title = await page.textContent('#solve-title');
  await page.waitForTimeout(1500);
  await page.click('#ctl-next');
  await page.click('#ctl-next');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `tests/out/e2e-solve-${n}.png` });
  // Lecture rapide jusqu'au bout : le cube 3D doit être résolu.
  await page.evaluate(() => { window.__app.stage.cube.speed = 8; });
  await page.click('#ctl-play');
  await page.waitForFunction(() => !document.getElementById('celebrate').hidden, null, { timeout: 120000 });
  const solved = await page.evaluate(() => { const c = window.__app.stage.cube; return c.P.isSolved(c.state); });
  console.log(`${n}x${n}: ${title} — cube 3D résolu : ${solved}`);
  await page.screenshot({ path: `tests/out/e2e-solved-${n}.png` });
}
console.log('erreurs:', errors.length ? errors : 'aucune');
await browser.close();
