# Fiche Chrome Web Store : textes à copier-coller

## Informations sur le produit

**Nom** (repris du manifest) : Slopcut : résumés en une phrase pour LinkedIn

**Résumé** (132 caractères max, repris du manifest) :
Résume chaque post du fil en une phrase, 100 % en local avec Gemini Nano. Aucune donnée ne quitte ta machine.

**Catégorie** : Productivité > Outils
**Langue** : Français

**Description** :

Le fil LinkedIn, lu en 30 secondes.

Slopcut remplace chaque publication longue de ton fil LinkedIn par une seule phrase qui dit ce que l'auteur annonce, demande ou affirme vraiment. Le storytelling, les « je suis ravi d'annoncer » et les questions d'engagement disparaissent. L'information reste.

Fonctionnement
• Chaque post au-dessus d'un seuil de longueur (220 caractères par défaut) est résumé en une phrase.
• Le post original reste à un clic : « Voir le slop » le réaffiche, « Recouper » le replie.
• Les publications sponsorisées sont repliées.
• Les commentaires ne sont jamais modifiés.

100 % local
Les résumés sont générés par Gemini Nano, le modèle d'IA intégré à Chrome, directement sur ton ordinateur. Aucun serveur, aucune clé API, aucune télémétrie : aucun post ne quitte ta machine.

Réglages
• Langue du résumé : français, anglais, espagnol, allemand, japonais.
• Ton : sec (par défaut) ou cynique (nomme le procédé rhétorique).
• Seuil de longueur ajustable, activation en un clic.

Compteur inclus : posts coupés, mots évités, minutes de vie récupérées.

Prérequis
Chrome 138 ou plus récent, Windows 10/11, macOS 13+, Linux ou Chromebook Plus, 22 Go d'espace libre, et un GPU avec plus de 4 Go de VRAM (ou 16 Go de RAM et 4 cœurs). Le modèle (~4 Go) est téléchargé une seule fois par Chrome, depuis le popup de l'extension.

Gratuit, fait par Senzu (https://senzu.tech/).

Slopcut n'est ni affilié à LinkedIn ni approuvé par LinkedIn.

## Éléments graphiques

- Icône 128×128 : `icons/icon128.png`
- Captures 1280×800 : `store/screenshots/screenshot-1.png` à `screenshot-4.png`
- Petite vignette promotionnelle 440×280 : `store/screenshots/promo-tile-440x280.png`
- Vidéo promotionnelle : URL YouTube de la vidéo (la fiche n'accepte pas d'upload direct)

## Onglet « Confidentialité »

**Objectif unique** :
Résumer en une phrase, localement, les publications textuelles du fil LinkedIn affiché par l'utilisateur, avec un accès en un clic au texte original.

**Justification de la permission `storage`** :
Enregistre localement les réglages de l'utilisateur (activation, langue, seuil, ton), un cache des résumés déjà générés pour éviter de recalculer, et deux compteurs d'usage affichés dans le popup.

**Justification de l'autorisation d'hôte `https://www.linkedin.com/*`** :
Le script de contenu doit lire le texte des publications affichées sur linkedin.com et y insérer le résumé à la place du corps du post. L'extension n'agit sur aucun autre site.

**Code distant** : Non, je n'utilise pas de code distant. (Tout le JavaScript est dans le paquet ; aucun `eval`, aucun script chargé depuis Internet.)

**Utilisation des données** :
- Cocher : **Contenu du site Web** (le texte des posts est lu pour être résumé, uniquement en local).
- Ne rien cocher d'autre.
- Cocher les trois attestations : pas de vente à des tiers, pas d'usage sans rapport avec l'objectif unique, pas d'usage pour évaluer la solvabilité.

**URL des règles de confidentialité** : https://github.com/edouard-claude/slopcut/blob/main/PRIVACY.md

## Notes pour l'examinateur (champ « Instructions de test »)

Pas de compte requis côté extension. Il faut un compte LinkedIn et une machine compatible Gemini Nano (Chrome 138+). Ouvrir le popup, cliquer sur « Télécharger Gemini Nano » si demandé, puis ouvrir https://www.linkedin.com/feed/ : les posts de plus de 220 caractères affichent une barre « ✂ TL;DR » avec une phrase de résumé et un bouton « Voir le slop ».
