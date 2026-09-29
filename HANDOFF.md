# Passation : publication Chrome Web Store

Pour Thomas. L'extension est écrite, les visuels et les textes de la fiche sont prêts. Il reste à la tester pour de vrai et à la soumettre.

## État

| Élément | État |
|---|---|
| Code (MV3, vanilla JS, zéro build) | Fait |
| Tests unitaires du post-traitement, hash, prompts (Node) | OK |
| Test réel sur linkedin.com | **À faire** (jamais tourné sur le vrai site) |
| Icônes 16/48/128 | Fait (`icons/`, source `store/src/icon.html`) |
| Captures 1280×800 ×4 + vignette 440×280 | Fait (`store/screenshots/`, source `store/src/shots.html`) |
| Textes de la fiche, justifications, déclaration des données | Fait (`store/listing.md`) |
| Politique de confidentialité | Fait (`PRIVACY.md`) |
| Vidéo de présentation | Chez Édouard, à mettre sur YouTube |

## Étapes

1. **Tester sur LinkedIn** avec la checklist du PRD (`docs/PRD.md`, §12). Points à regarder en priorité :
   - les sélecteurs de `src/selectors.js` trouvent bien les posts sur ton compte (sinon, console de l'onglet : log `[slopcut] DIAGNOSTIC`) ;
   - le téléchargement du modèle depuis le popup ;
   - « Voir le slop » / « Recouper », toggle ON/OFF, posts sponsorisés.
   Logs détaillés : console au niveau **Verbose** (onglet LinkedIn et service worker de l'extension).
2. **Incrémenter la version** dans `manifest.json` si tu corriges quelque chose après un premier upload.
3. **Construire le zip** : `./store/build.sh` → `store/slopcut-<version>.zip` (le zip n'est pas versionné).
4. **Compte développeur** Chrome Web Store (5 $, une fois), idéalement au nom de Senzu.
5. **Nouvel élément** → upload du zip, puis remplir la fiche avec `store/listing.md` :
   - URL de la politique de confidentialité : `https://github.com/edouard-claude/slopcut/blob/main/PRIVACY.md`
   - URL de la vidéo : lien YouTube.
6. Soumettre. Visibilité au choix : publique, ou « non répertoriée » (installable seulement avec le lien).

## Régénérer les visuels

Les captures sont des maquettes HTML rendues par Chrome en mode headless :

```sh
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for s in 1 2 3 4; do "$CH" --headless --hide-scrollbars --window-size=1280,800 --screenshot=store/screenshots/screenshot-$s.png "file://$PWD/store/src/shots.html#$s"; done
"$CH" --headless --hide-scrollbars --window-size=440,280 --screenshot=store/screenshots/promo-tile-440x280.png "file://$PWD/store/src/shots.html#tile"
```

Une vraie capture du fil avec l'extension active peut remplacer `screenshot-1.png` : c'est plus sûr vis-à-vis de la règle Google « les captures doivent refléter le produit ».

## Risques de refus connus

- Nom : « … pour LinkedIn » est la forme tolérée pour une marque tierce ; ne pas mettre LinkedIn en premier mot ni utiliser son logo.
- La mention « Slopcut n'est ni affilié à LinkedIn ni approuvé par LinkedIn » doit rester dans la description.
- L'examinateur doit pouvoir faire tourner Gemini Nano : les instructions de test sont dans `store/listing.md`.
