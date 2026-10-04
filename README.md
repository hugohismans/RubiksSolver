# Rubik's Solver

Web app mobile : on montre son Rubik's Cube à la caméra, face par face. L'app
reconnaît le cube et ses couleurs, vérifie qu'il est cohérent, puis donne une
solution courte en notation standard (`R U R' F2 …`), animée en 3D.

Aucune installation : la page tourne dans le navigateur du téléphone (Chrome,
Safari). La caméra exige une page en **HTTPS** (GitHub Pages convient).

## Utilisation

1. **Scanner mon cube** : autorise la caméra.
2. Blanc en haut, montre les faces **rouge, bleue, orange, verte** (dans
   n'importe quel ordre). Puis la face **blanche** et la face **jaune**, avec
   le bleu en haut. Le petit cube 3D montre comment tenir le cube.
3. Tiens la face immobile une demi-seconde : elle est capturée toute seule
   (vibration + bip).
4. Vérifie les couleurs : un toucher sur une case permet de la corriger. Les
   cases douteuses clignotent.
5. **Résoudre** : solution immédiate (≤ 22 coups), puis l'app cherche plus
   court pendant quelques secondes. Lecture coup par coup en 3D.

Pas de caméra ? « Importer une photo » (une photo par face) ou « Saisir les
couleurs à la main ».

## Comment marche la détection

Le détecteur (`src/vision/detector.js`) ne repose **pas** sur les bords noirs.
Il fonctionne aussi bien sur les cubes sans stickers que sur les cubes
classiques.

1. Image → espace Lab, carte de gradient couleur, plus un détecteur de
   « rainures » sombres (la fine ombre entre deux pièces de même couleur sur
   un cube sans stickers).
2. Segmentation en régions homogènes, à plusieurs seuils. Chaque région en
   forme de quadrilatère (vu en perspective) devient un candidat sticker.
3. Les candidats voisins (même taille, même orientation, à un pas de réseau)
   sont assemblés en réseau. Une **homographie** réseau → image est ajustée et
   tolère la perspective. Les cases manquantes (logo, reflet, centre rond)
   sont retrouvées par prédiction.
4. Un réseau qui continue au-delà de 3×3 (carrelage, clavier…) est rejeté. Une
   face unie (cube sans stickers résolu) est reconnue grâce aux petits creux
   sombres aux jonctions des pièces.
5. Couleur de chaque case : échantillonnage robuste (médiane, anneau autour du
   logo du centre, rejet des reflets).

Les couleurs finales ne sont pas décidées case par case. L'app affecte à
chaque emplacement de coin et d'arête une **vraie pièce** du cube (algorithme
hongrois), ce qui garantit 9 cases par couleur et des pièces qui existent.
Elle corrige au besoin torsion, retournement et parité, et calibre les
couleurs sur les centres. Cela règle la confusion rouge/orange. Une face
montrée dans le mauvais sens est remise d'aplomb automatiquement, car seule
la bonne orientation donne un cube possible.

Résolution : algorithme deux phases de Kociemba ([cubejs](https://github.com/ldez/cubejs)),
dans des Web Workers.

## Développement

```sh
npm install
npm run serve        # http://localhost:8080 (la caméra marche aussi en localhost)
npm test             # tests unitaires + détecteur (photo réelle et images synthétiques)
```

Outils de test (`tests/`) :

- `lib/synth.js` : générateur d'images synthétiques réalistes (lancer de
  rayons). Cubes à bords noirs ou sans stickers, logos, carrelage en
  perspective, main, reflets, bruit.
- `eval-synth.js` / `eval-par.sh` : taux de détection sur N images.
- `debug-image.js <photo>` : détecteur sur une vraie photo, image annotée dans
  `tests/out/`.
- E2E avec fausse caméra (Chrome lit une vidéo `.y4m`) :

  ```sh
  node tests/e2e/make-video.js <état54> tests/out/cam.y4m [stickerless|black] [neon|classic|pastel]
  node tests/e2e/scan.mjs tests/out/cam.y4m <état54>
  ```

  Variables : `TILT=1` (cube incliné), `WRONG=1` (blanc et jaune montrés à
  l'envers).

Ajoute `?debug=1` à l'URL pour voir les candidats et le temps d'analyse.

## Déploiement

Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur
`main`. À activer une fois : *Settings → Pages → Source : GitHub Actions*.
