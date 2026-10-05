// Changer de cube pendant un mouvement de la démo ne doit laisser aucune
// pièce de l'ancien cube (bug : « un cube dans le cube »).
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForTimeout(1500);
let bad = 0;
const expected = { 2: 8, 3: 26, 4: 56 };
for (let k = 0; k < 12; k++) {
  const n = [4, 2, 3][k % 3];
  // Attend qu'un mouvement de la démo soit en cours (une tranche dans un pivot).
  await page.waitForFunction(() => window.__app.stage.cube.cubiesGroup.children.some((c) => !c.userData.idx), null, { timeout: 5000 }).catch(() => {});
  await page.click(`#puzzles button[data-n="${n}"]`);
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => {
    const c = window.__app.stage.cube;
    const pieces = [];
    c.cubiesGroup.traverse((o) => { if (o.userData.idx) pieces.push(o); });
    return { N: c.N, count: pieces.length, foreign: pieces.filter((p) => !c.cubies.includes(p)).length, len: c.state.length };
  });
  if (st.count !== expected[n] || st.foreign || st.len !== 6 * n * n) { bad++; console.log('anomalie', n, st); }
}
await page.screenshot({ path: 'tests/out/e2e-switch.png' });
console.log(bad ? `${bad} anomalie(s)` : 'aucune pièce fantôme ✓', 'erreurs:', errors.length ? errors : 'aucune');
await browser.close();
process.exit(bad ? 1 : 0);
