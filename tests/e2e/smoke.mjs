// Test de fumée : accueil, vérification d'un état, solution animée.
import { chromium } from 'playwright';
import Cube from 'cubejs';

const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/out/e2e-home.png' });
const state = Cube.random().asString();
await page.goto(base + '?state=' + state);
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/out/e2e-review.png' });
await page.click('#review-solve');
await page.waitForFunction(() => /Solution en/.test(document.getElementById('solve-title').textContent), null, { timeout: 30000 });
const title1 = await page.textContent('#solve-title');
await page.waitForTimeout(6000);
const title2 = await page.textContent('#solve-title');
await page.click('#ctl-next');
await page.waitForTimeout(600);
await page.screenshot({ path: 'tests/out/e2e-solve.png' });
console.log(title1, '->', title2);
console.log('erreurs:', errors.length ? errors : 'aucune');
await browser.close();
