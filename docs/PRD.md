# PRD : Slopcut, extension Chrome "LinkedIn en une phrase"

Version 1.0 ; 2026-09-29 ; destiné à un agent de développement autonome.
Objectif de livraison : extension stable, chargeable en "Load unpacked", en une journée.

> Document d'origine, conservé tel quel. Les écarts assumés à l'implémentation sont listés dans le README.

---

## 0. Consignes à l'agent

- Lis ce document en entier avant d'écrire une ligne.
- Zéro dépendance npm, zéro bundler, zéro build. Vanilla JS (ES2022), Manifest V3. Le dossier du repo se charge tel quel dans `chrome://extensions`.
- Tout ce qui est marqué **MVP** est obligatoire. Tout ce qui est marqué **V1.1** est hors périmètre aujourd'hui, ne l'implémente pas, ne le prépare pas.
- Les sélecteurs LinkedIn sont volatils : ils vivent dans un seul fichier (`src/selectors.js`), jamais ailleurs.
- Aucun appel réseau. Aucune télémétrie. Aucune clé API. Tout tourne en local via Gemini Nano.
- Commentaires et noms de variables en anglais. Textes UI en français.
- Chaque fonctionnalité MVP est validée par la checklist de la section 12 avant de déclarer terminé.

---

## 1. Pitch produit

LinkedIn est devenu une plateforme de slop : posts de 800 mots pour dire une chose, storytelling creux, "je suis ravi d'annoncer". Slopcut, une fois activée, remplace le corps de chaque publication textuelle du fil par **une seule phrase** générée localement par Gemini Nano. L'original reste accessible en un clic.

Ton : ironique et assumé dans le marketing et l'UI ("Respecte ton temps. LinkedIn a été fait pour ça."). Le résumé lui-même est **sec et fidèle** : on ne déforme pas ce que dit l'auteur, on enlève le gras.

Promesse : "Le fil LinkedIn, lu en 30 secondes."

---

## 2. Contraintes techniques vérifiées (état au 2026-09-29)

Sources : documentation Chrome for Developers (Prompt API, mise à jour 2026-08-26 ; Summarizer API ; Built-in AI APIs status) et repos publics d'extensions LinkedIn de septembre 2026.

### 2.1 IA intégrée Chrome (Gemini Nano)

| Point | Valeur |
|---|---|
| Prompt API (`LanguageModel`) dans les extensions | Stable depuis Chrome 138 |
| Prompt API sur le web (pages linkedin.com) | Stable depuis Chrome 148 |
| Summarizer API (`Summarizer`) | Stable depuis Chrome 138 (extensions et web) |
| Langues acceptées (`expectedInputs`/`expectedOutputs`) | `en`, `ja`, `es`, `de`, `fr` |
| Contextes d'extension avec accès à `LanguageModel` | Service worker, popup, side panel (aucune permission manifest requise) |
| Web Workers | Non supporté |
| Sampling (`temperature`, `topK`, `LanguageModel.params()`) | Disponible uniquement dans les extensions ; il faut passer les deux ou aucun |
| `responseConstraint` (JSON Schema) | Disponible sur `prompt()` |
| Session | `contextUsage` / `contextWindow`, `clone()`, `destroy()`, event `contextoverflow`, `QuotaExceededError` |
| Téléchargement du modèle | Déclenché par `create()` ; la doc demande une activation utilisateur (`navigator.userActivation.isActive`) ; ~4 Go ; suivre `monitor` → `downloadprogress` |
| `availability()` | `'available'`, `'downloadable'`, `'downloading'`, `'unavailable'` |
| Matériel requis | Windows 10/11, macOS 13+, Linux, ChromeOS Chromebook Plus ; 22 Go libres ; GPU > 4 Go VRAM ou CPU 16 Go RAM + 4 cœurs ; connexion non limitée pour le premier téléchargement |
| Vie privée | Aucune donnée envoyée à Google après téléchargement du modèle |
| Ancienne permission `aiLanguageModelOriginTrial` | Expirée, ne pas la déclarer |

Décision : **Prompt API** plutôt que Summarizer API. Le Summarizer `type: 'headline'` donne 12 mots mais impose un style "titre d'article" et ne laisse pas piloter le ton ni la langue de sortie finement. Le Prompt API avec system prompt donne le contrôle éditorial nécessaire. Summarizer reste le fallback si `LanguageModel` est indisponible mais `Summarizer` disponible (rare, même modèle sous-jacent ; à gérer en 10 lignes, pas plus).

Décision : l'inférence tourne dans le **service worker de l'extension** (contexte documenté, accès aux paramètres de sampling, version minimale Chrome 138). Le content script ne touche jamais à `LanguageModel`.

### 2.2 DOM LinkedIn (septembre 2026)

LinkedIn déploie **par compte** un nouveau front React. Les deux markups coexistent dans la nature. Constats vérifiés dans des repos publics mis à jour en septembre 2026 :

| Élément | Nouveau markup (React) | Ancien markup (legacy) |
|---|---|---|
| Conteneur du fil | `[data-testid="mainFeed"]` | `.scaffold-finite-scroll__content` |
| Carte de post | `[data-testid="mainFeed"] [role="listitem"]` | `div[data-urn^="urn:li:activity"]`, `[data-id^="urn:li:activity"]`, `.feed-shared-update-v2` |
| Corps texte | `[data-testid="expandable-text-box"]` | `.update-components-text`, `.feed-shared-inline-show-more-text` |
| Identifiant stable de post | **Absent** (`data-sdui-anchor-id` change à chaque rechargement) | `data-urn` / `data-id` |
| Classes CSS | Obfusquées, non fiables | Semi-stables |

Conséquences :
- La clé de cache est un **hash du texte normalisé + auteur**, jamais un URN.
- Les sélecteurs sont des chaînes de fallback ordonnées, testées dans l'ordre, dans `src/selectors.js`.
- Un mode diagnostic loggue la structure DOM (noms d'attributs uniquement) si aucun post n'est détecté 6 s après l'arrivée sur `/feed/`.

---

## 3. Périmètre

### MVP (aujourd'hui)

1. Détection des posts du fil LinkedIn (`/feed/`) et de toute page contenant des cartes de post (profil "Activité", page d'un post).
2. Pour chaque post dont le texte dépasse un seuil (défaut 220 caractères) : masquer le corps, afficher une phrase générée par Gemini Nano, bouton pour révéler l'original.
3. Toggle global ON/OFF depuis le popup (icône dans la barre) ; état persistant.
4. Onboarding modèle dans le popup : vérification `availability()`, bouton de téléchargement avec progression, messages d'erreur matériel.
5. Cache des résumés (session + local, borné).
6. Compteur ironique dans le popup : nombre de posts coupés, mots évités, "minutes de vie récupérées" (mots / 200).
7. Réglages : langue de sortie (fr/en/es/de/ja, défaut = langue du navigateur si supportée, sinon `fr`), seuil de longueur, ton (`sec` par défaut, `cynique`).

### V1.1 (ne pas implémenter)

- Score de slop 0 à 100 avec JSON Schema et badge coloré.
- Résumé des commentaires.
- Statistiques par auteur ("top slopeurs de ta semaine").
- Publication Chrome Web Store (icônes 128 px, captures, politique de confidentialité).
- Support Edge.

### Hors périmètre définitif

- Toute automatisation d'action sur LinkedIn (like, commentaire, clic "voir plus" automatique).
- Toute sortie réseau.
- Résumé d'images, vidéos, sondages, documents.

---

## 4. Architecture

```
slopcut/
├── manifest.json
├── src/
│   ├── background.js      # service worker : session Gemini Nano, file d'attente, cache
│   ├── content.js         # content script linkedin.com : détection, extraction, injection UI
│   ├── selectors.js       # SEUL endroit où vivent les sélecteurs LinkedIn (importé par content.js via chrome.runtime.getURL)
│   ├── prompt.js          # system prompt + post-traitement de la sortie
│   ├── hash.js            # hash de clé de cache
│   └── ui.css             # styles injectés dans le Shadow DOM
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── icons/
│   ├── icon16.png, icon48.png, icon128.png
└── README.md
```

Note : un content script ne peut pas être un module ESM directement. `content.js` est un script classique qui charge les modules via `import(chrome.runtime.getURL('src/selectors.js'))` ; ces fichiers doivent être listés dans `web_accessible_resources`.

### 4.1 Flux nominal

```
content.js                          background.js (SW)
   │ MutationObserver détecte carte      │
   │ extrait {key, author, text, lang}   │
   │ masque le corps, affiche skeleton   │
   ├── sendMessage {type:'SUMMARIZE'} ──►│ cache hit ? → réponse immédiate
   │                                     │ sinon enqueue (priorité viewport)
   │                                     │ session.clone() → prompt() → destroy()
   │◄── {type:'SUMMARY', key, hook} ─────┤ post-traitement, mise en cache
   │ remplace skeleton par le hook       │
   │ incrémente compteurs (storage)      │
```

### 4.2 Responsabilités

**content.js**
- Observe `document.body` (`childList`, `subtree`). Débounce 150 ms. Traite uniquement les cartes non marquées (`data-slopcut="1"`).
- Filtre : texte ≥ seuil, pas déjà traité, pas un post sponsorisé (détection locale : texte "Sponsorisé"/"Promoted"/"Sponsored" dans l'en-tête de la carte ; ces posts sont masqués entièrement avec le libellé "Pub. Coupée.").
- Extraction : `innerText` du conteneur texte, normalisation (espaces, suppression du libellé "…plus"/"…more"/"See more" en fin de chaîne, suppression des hashtags en fin de post). Ne clique jamais sur "voir plus" ; le texte tronqué visuellement est en général présent dans le DOM, on prend ce qu'on a.
- Priorité : `IntersectionObserver` avec `rootMargin: '600px'` ; les cartes proches du viewport partent en premier (`priority: 1`), les autres en `priority: 0`.
- Injection UI dans un `<div>` hôte avec Shadow DOM (isolation CSS totale vis-à-vis de LinkedIn).
- Réagit au toggle global : si OFF, restaure tous les corps masqués et arrête l'observation ; si ON, redémarre.
- Keepalive : tant que des requêtes sont en attente, envoie `{type:'PING'}` toutes les 20 s pour éviter l'arrêt du service worker (arrêt après 30 s d'inactivité).
- Diagnostic : si `/feed/` et 0 carte détectée après 6 s, `console.info('[slopcut] DIAGNOSTIC', ...)` avec la liste des attributs `data-*` distincts présents sous `main` (noms uniquement, jamais de contenu).

**background.js**
- Possède une unique session de base `LanguageModel` (system prompt, `expectedInputs: [{type:'text', languages:['fr','en','es','de','ja']}]`, `expectedOutputs: [{type:'text', languages:[outputLang]}]`, `temperature: 0.3`, `topK: params.defaultTopK`). Recréée si `outputLang` ou `tone` change.
- Par post : `const s = await base.clone(); const out = await s.prompt(userPrompt, {signal}); s.destroy();`. Jamais de prompt sur la session de base (le contexte ne doit pas s'accumuler).
- File d'attente FIFO à deux niveaux (priorité 1 puis 0), **un seul prompt en vol à la fois**. Taille max 40 ; au-delà, les entrées de priorité 0 les plus anciennes sont abandonnées et le content script reçoit `{type:'SUMMARY', key, error:'dropped'}` (il restaure l'original).
- Timeout par prompt : 15 s via `AbortController` ; en cas d'échec, une seule nouvelle tentative, puis erreur renvoyée.
- Cache : `Map` en mémoire + `chrome.storage.local` clé `cache` (LRU, 500 entrées max, valeur `{hook, ts}`). Chargé au démarrage du SW, écrit en batch toutes les 5 s si modifié.
- Gestion `availability()` : expose `{type:'STATUS'}` → `{availability, modelReady, queueSize, chromeVersion}`.
- Téléchargement : le SW ne déclenche jamais `create()` si `availability() === 'downloadable'`. C'est le popup qui le fait sur clic utilisateur (activation utilisateur). Une fois `'available'`, le SW crée sa session librement.
- Compteurs : `chrome.storage.local` clés `stats.posts`, `stats.words`. Incrémentés par le SW à chaque résumé réussi (pas de cache hit).

**popup.js**
- Affiche l'état : "Gemini Nano prêt" / "Modèle à télécharger (~4 Go)" bouton / "Téléchargement 42 %" / "Ton matériel ne passe pas" avec les prérequis / "Chrome trop ancien (min 138)".
- Toggle ON/OFF (`chrome.storage.local` clé `enabled`, défaut `true`).
- Compteurs ironiques.
- Réglages (langue, seuil, ton) ; tout changement est diffusé aux onglets LinkedIn via `chrome.tabs.sendMessage`.
- Bouton "Vider le cache".

---

## 5. manifest.json

```json
{
  "manifest_version": 3,
  "name": "Slopcut : LinkedIn en une phrase",
  "version": "1.0.0",
  "minimum_chrome_version": "138",
  "description": "Chaque post LinkedIn résumé en une phrase, en local, par Gemini Nano. Respecte ton temps.",
  "permissions": ["storage"],
  "host_permissions": ["https://www.linkedin.com/*"],
  "background": { "service_worker": "src/background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["https://www.linkedin.com/*"],
    "js": ["src/content.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": ["src/selectors.js", "src/hash.js", "src/ui.css"],
    "matches": ["https://www.linkedin.com/*"]
  }],
  "action": { "default_popup": "popup/popup.html", "default_icon": "icons/icon48.png" },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

Aucune autre permission. Pas de `tabs`, pas de `scripting`, pas de `offscreen`.

---

## 6. Sélecteurs (`src/selectors.js`)

```js
// Ordered fallback chains. First selector that yields elements wins for the whole page.
export const POST_SELECTORS = [
  '[data-testid="mainFeed"] [role="listitem"]',      // React front end (2026-09)
  'div[data-urn^="urn:li:activity"]',                 // legacy
  '[data-id^="urn:li:activity"]',                     // legacy
  '.feed-shared-update-v2',                           // legacy
];

export const TEXT_SELECTORS = [
  '[data-testid="expandable-text-box"]',
  '.update-components-text',
  '.feed-shared-inline-show-more-text',
  '.feed-shared-text',
];

export const AUTHOR_SELECTORS = [
  '[data-testid="actor-name"]',
  '.update-components-actor__title',
  '.update-components-actor__name',
  'a[href*="/in/"] span[aria-hidden="true"]',
];

export const SPONSORED_MARKERS = ['Sponsorisé', 'Promoted', 'Sponsored'];
export const SEE_MORE_LABELS = ['…plus', '… plus', 'voir plus', '…more', '… more', 'see more'];
```

Règle de sélection : on tente chaque `POST_SELECTORS[i]` ; le premier qui retourne ≥ 1 élément devient le sélecteur actif jusqu'au prochain changement d'URL. Idem pour le texte, mais évalué **à l'intérieur de la carte**.

---

## 7. Clé de cache (`src/hash.js`)

```js
// FNV-1a 32-bit over normalized text; sync, dependency-free, good enough for a local cache.
export function postKey(author, text) {
  const norm = (author + '\u0000' + text).normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 600);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
```

---

## 8. Prompt (`src/prompt.js`)

### 8.1 System prompt (ton `sec`, sortie `fr`)

```
Tu es un compresseur de texte. On te donne une publication LinkedIn.
Tu réponds avec UNE SEULE phrase, en français, de 25 mots maximum, qui dit ce que l'auteur annonce, demande ou affirme réellement.
Règles :
- Fidèle au contenu. N'invente rien. Pas d'opinion.
- Style plat et direct. Pas d'emphase, pas de superlatif, pas d'emoji, pas de hashtag, pas de guillemets.
- Commence directement par le sujet. Pas de préambule du type "L'auteur dit que".
- Si le post ne dit rien de concret, réponds exactement : Ce post ne dit rien.
Réponds uniquement avec la phrase.
```

Ton `cynique` : mêmes règles, avec en plus "Tu peux nommer sobrement le procédé rhétorique si le post en use (auto-promotion, storytelling, question d'engagement), en 5 mots maximum, entre parenthèses, à la fin."

Sortie `en`/`es`/`de`/`ja` : traduire le system prompt dans la langue cible (l'agent rédige les 4 versions ; les règles ne changent pas).

### 8.2 User prompt

```
Auteur : {author}
Publication :
"""
{text tronqué à 3000 caractères}
"""
```

### 8.3 Post-traitement (obligatoire, le modèle n'est pas fiable sur la forme)

1. Trim, suppression des guillemets et astérisques en bordure.
2. Garder uniquement la première phrase (coupe au premier `.`, `!`, `?` suivi d'un espace ou fin de chaîne ; les parenthèses du ton cynique sont conservées si elles suivent immédiatement).
3. Supprimer emojis et `#mots`.
4. Si > 200 caractères : couper à 197 et ajouter `…`.
5. Si vide ou < 8 caractères : erreur `empty`, restaurer l'original.

---

## 9. UI injectée (Shadow DOM)

Composant `slopcut-bar`, inséré **à la place** du conteneur texte (le conteneur original reçoit `hidden` via attribut, jamais supprimé du DOM).

```
┌──────────────────────────────────────────────────────────┐
│ ✂ TL;DR   Il a levé 2 M€ et recrute deux commerciaux.    │
│                                    [ Voir le slop (412 mots) ] │
└──────────────────────────────────────────────────────────┘
```

États :
- `loading` : "✂ Coupe en cours…" (texte gris, pas d'animation lourde).
- `done` : le hook. Bouton "Voir le slop (N mots)". Clic → réaffiche l'original, le bouton devient "Recouper".
- `error` : restauration silencieuse de l'original, aucun message (le produit ne doit jamais dégrader la lecture).
- `sponsored` : "✂ Pub. Coupée." + bouton "Voir quand même".

Style : police système, 14 px, fond `#f3f6f8` clair / `#1b1f23` sombre (`prefers-color-scheme`), bordure gauche 3 px `#0a66c2`, radius 6 px, padding 8 px 12 px. Aucune image, aucune police externe.

Accessibilité : le bouton est un `<button>`, `aria-expanded` reflète l'état.

---

## 10. Popup

Trois blocs, dans l'ordre :

1. **En-tête** : nom, toggle ON/OFF, état du modèle (voir §4.2 popup.js). Si `downloadable` : bouton "Télécharger Gemini Nano (~4 Go, une seule fois)" ; au clic, `LanguageModel.create({monitor})` dans le popup avec barre de progression ; le popup peut être fermé, le téléchargement continue côté Chrome.
2. **Compteurs** :
   - "Posts coupés : 148"
   - "Mots évités : 61 204"
   - "Minutes de vie récupérées : 306" (mots / 200, arrondi)
   - Ligne ironique statique : "LinkedIn a été conçu pour respecter ton temps. On l'aide."
3. **Réglages** : langue de sortie (select), seuil de longueur (number, 80 à 1000), ton (radio sec/cynique), bouton "Vider le cache".

Toute la logique popup tient dans `popup.js` ; pas de framework.

---

## 11. Cas limites à gérer (MVP)

| Cas | Comportement |
|---|---|
| Chrome < 138 | Popup : "Chrome 138 minimum" ; content script inactif |
| `availability() === 'unavailable'` | Popup : prérequis matériels ; content script inactif |
| Modèle en téléchargement | Content script inactif ; popup affiche la progression |
| Post < seuil | Non touché |
| Post repartagé avec commentaire | Résumer uniquement le commentaire du reposteur si ≥ seuil ; le post repartagé imbriqué est traité comme une carte à part si les sélecteurs le remontent, sinon ignoré |
| Post sans texte (image/vidéo seule) | Non touché |
| Post sponsorisé | Masqué entièrement, libellé "Pub. Coupée." |
| LinkedIn re-rend la carte (React) | La clé de cache donne le hook instantanément ; la barre est réinjectée |
| Navigation SPA (feed → profil → feed) | L'observer reste actif ; l'état des sélecteurs est réévalué à chaque changement d'URL (`popstate` + patch de `history.pushState`) |
| Utilisateur désactive pendant une file en cours | Vider la file, restaurer les originaux |
| `QuotaExceededError` | Retenter avec le texte tronqué à 1500 caractères, puis erreur |
| Service worker arrêté pendant un prompt | Le content script n'a pas de réponse au bout de 20 s → restaure l'original et renvoie la demande une fois |
| Page non-feed avec cartes (post unique, activité profil) | Traité comme le feed |
| Commentaires | Jamais touchés |

---

## 12. Critères d'acceptation (checklist de fin)

- [ ] `chrome://extensions` → Load unpacked sur le dossier : aucune erreur, aucun warning manifest.
- [ ] Popup à froid sur une machine sans modèle : état `downloadable`, bouton, progression visible, passage à `available` sans recharger l'extension.
- [ ] Sur `/feed/` avec le nouveau markup React : ≥ 90 % des posts de plus de 220 caractères affichent un hook en moins de 8 s après entrée dans la zone `rootMargin`.
- [ ] Même test sur l'ancien markup (à simuler en modifiant `POST_SELECTORS` si le compte de test n'a que le nouveau).
- [ ] Le hook est une phrase unique, ≤ 200 caractères, sans emoji ni hashtag, dans la langue configurée.
- [ ] "Voir le slop" restaure l'original exactement (aucun nœud DOM perdu), "Recouper" remasque.
- [ ] Scroll rapide de 50 posts : aucun freeze perceptible de l'onglet, file bornée, un seul prompt en vol (vérifiable via logs `[slopcut]` niveau verbose).
- [ ] Reload de la page : les posts déjà vus s'affichent avec leur hook sans nouvel appel modèle (cache hit loggé).
- [ ] Toggle OFF : tout l'original revient, plus aucun log d'inférence. Toggle ON : reprise.
- [ ] Changement de langue de sortie dans le popup : le prochain post est résumé dans la nouvelle langue.
- [ ] Post sponsorisé : masqué avec "Pub. Coupée.", aucun appel modèle.
- [ ] Aucune requête réseau initiée par l'extension (onglet Network filtré sur l'extension : vide).
- [ ] Console LinkedIn sans erreur non catchée provenant de l'extension.
- [ ] `README.md` : installation, prérequis matériels, comment mettre à jour les sélecteurs, où lire le diagnostic.

---

## 13. Plan de réalisation suggéré (ordre)

1. `manifest.json`, icônes placeholder (carrés unis générés en PNG), squelette des fichiers. Load unpacked OK.
2. `background.js` : `STATUS`, session de base, `SUMMARIZE` sans file ni cache, test depuis la console du SW avec un texte en dur.
3. `popup` : état modèle + téléchargement + toggle.
4. `selectors.js` + `content.js` : détection, extraction, log des textes extraits (sans UI).
5. UI Shadow DOM, états loading/done/error, "Voir le slop".
6. File à priorité, timeout, retry, keepalive.
7. Cache local, compteurs, réglages, diffusion aux onglets.
8. Cas limites §11, diagnostic, README, checklist §12.

---

## 14. Références

- Prompt API : https://developer.chrome.com/docs/ai/prompt-api
- Session management : https://developer.chrome.com/docs/ai/session-management
- Structured output : https://developer.chrome.com/docs/ai/structured-output-for-prompt-api
- Summarizer API : https://developer.chrome.com/docs/ai/summarizer-api
- Statut des APIs : https://developer.chrome.com/docs/ai/built-in-apis
- Extensions et IA : https://developer.chrome.com/docs/extensions/ai
- Exemple officiel Prompt API en extension : https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-on-device
- Typages TypeScript (optionnels, pour l'IDE uniquement) : `@types/dom-chromium-ai`
- Sélecteurs LinkedIn 2026-09 (référence terrain) : https://github.com/stefw/lkclean
