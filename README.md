# Rubik's Solver

Web app mobile : on montre son Rubik's Cube à la caméra, face par face. L'app
reconnaît le cube et ses couleurs, vérifie qu'il est cohérent, puis donne une
solution courte en notation standard (`R U R' F2 …`), animée en 3D.

Aucune installation : la page tourne dans le navigateur du téléphone (Chrome,
Safari). La caméra exige une page en **HTTPS** (GitHub Pages convient).

## Utilisation

1. **Scanner mon cube** : autorise la caméra.
2. **Tourne ton cube devant la caméra, comme tu veux**, de préférence un peu
   en biais pour que je voie 2 ou 3 faces à la fois. Le mini-cube en haut à
   droite suit ton cube et se remplit au fur et à mesure. Une consigne
   t'indique quoi montrer ensuite (« Montre-moi le dessous », « Tourne vers la
   gauche… »).
3. Dès que les 54 cases sont connues et forment un cube valide, le mini-cube
   grandit, la caméra s'efface et la solution s'affiche.
4. Solution immédiate (≤ 22 coups), puis l'app cherche plus court pendant
   quelques secondes. Lecture coup par coup en 3D. Le bouton retour mène à la
   vérification des couleurs (correction d'une case au toucher).

Il existe aussi un **mode pas à pas** (une face après l'autre, avec consignes
d'orientation), l'import de photos, et la saisie manuelle des couleurs.

## Le scan libre (reconstruction 3D)

`src/scan/model.js` :

- **Repliage** : deux faces détectées qui partagent une arête à l'image ont
  une position relative entièrement déterminée sur le cube (les deux faces
  parcourent l'arête commune en sens opposés). On reconstruit ainsi une vue
  locale de 1 à 3 faces en 3D, sans calibrer la caméra.
- **Recalage** : la vue locale est confrontée au modèle sous les 24 rotations
  d'un cube. Les couleurs des centres et les stickers déjà vus désignent la
  bonne ; en cas d'ambiguïté réelle, l'image est ignorée.
- **Accumulation** : chaque case reçoit des mesures pondérées par l'angle de
  vue (médiane pondérée). Une case est « connue » après plusieurs mesures
  concordantes.
- **Consignes** : on sait quelles faces manquent et où elles se trouvent par
  rapport à la vue actuelle, d'où les indications de mouvement.
- Aucune hypothèse sur le schéma de couleurs ou sur l'orientation : U = la
  face blanche, F = la verte, et le reste découle de la géométrie observée.

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

- Scan libre : `node tests/free-scan-sim.js [style] [palette] [seed]` (simulation
  sans navigateur, trajectoire de rotation), `sh tests/free-scan-batch.sh`
  (16 cubes), et en E2E :

  ```sh
  node tests/e2e/make-free-video.js <état54> tests/out/free.y4m [style] [palette]
  node tests/e2e/free-scan.mjs tests/out/free.y4m <état54>
  ```

Ajoute `?debug=1` à l'URL pour voir les candidats et le temps d'analyse.

## Déploiement

GitHub Pages, « Deploy from a branch » : `main`, dossier `/ (root)`. Le site
est statique (aucune compilation) ; `.nojekyll` désactive le traitement Jekyll.
Adresse : https://hugohismans.github.io/RubiksSolver/
