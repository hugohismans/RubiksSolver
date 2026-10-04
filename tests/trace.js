// Trace interne du détecteur : node tests/trace.js <seed|image>
import fs from 'node:fs';
import { loadImage, resize } from './lib/image.js';
let src = fs.readFileSync('src/vision/detector.js', 'utf8');
src = src.replace(/from '\.\//g, "from '../src/vision/");
src = src.replace('const res = growLattice(cands, localStar(cands, adj, seed));', 'const star = localStar(cands, adj, seed); const res = growLattice(cands, star); console.log("graine", seed, "étoile", star.map(m=>m.idx+":"+m.i+","+m.j).join(" "), "->", res ? (res.grid ? "GRILLE " : "") + res.members.map(m=>m.idx+":"+m.i+","+m.j).join(" ") : "rien");');
src = src.replace("if (i1 - i0 < 2 || j1 - j0 < 2) return null;", 'if (i1 - i0 < 2 || j1 - j0 < 2) { console.log("  trop petit"); return null; }');
src = src.replace("if (outside >= 2) return null;", 'if (outside >= 2) { console.log("  hors fenêtre", outside); return null; }');
src = src.replace("if (!sane(H, W, Hh)) return null;", 'if (!sane(H, W, Hh)) { console.log("  pas sain"); return null; }');
fs.writeFileSync('tests/.trace-det.mjs', src);
const D = await import('./.trace-det.mjs');
fs.unlinkSync('tests/.trace-det.mjs');
const arg = process.argv[2];
const image = /^\d+$/.test(arg) ? (await import('./lib/synth.js')).generate(+arg).image : resize(loadImage(arg), 480);
const r = D.detectFaces(image);
if (process.argv[3]) r.candidates.forEach((c, i) => console.log(i, c.cx.toFixed(0), c.cy.toFixed(0), c.area, 'u', c.u.map((v) => v.toFixed(1)).join(','), 'v', c.v.map((v) => v.toFixed(1)).join(','), 'T', c.T));
console.log('faces', r.faces.length, r.faces.map((f) => f.members));
