# Slopcut : politique de confidentialité

Dernière mise à jour : 29 septembre 2026.

## En résumé

Slopcut ne collecte, ne transmet et ne vend aucune donnée. Tout le traitement a lieu sur ton ordinateur.

## Données traitées

Pour produire un résumé, l'extension lit le texte et le nom de l'auteur des publications affichées sur linkedin.com. Ce texte est envoyé uniquement au modèle Gemini Nano intégré à Chrome, qui tourne en local sur ta machine. Il ne quitte jamais ton appareil.

## Données stockées localement

Via `chrome.storage.local`, sur ton appareil uniquement :

- tes réglages (activation, langue, seuil, ton) ;
- un cache des 500 derniers résumés (une empreinte du post et la phrase générée, pas le texte original) ;
- deux compteurs : nombre de posts résumés et nombre de mots évités.

Le bouton « Vider le cache » du popup efface le cache. Désinstaller l'extension efface tout.

## Aucune transmission

Slopcut n'effectue aucune requête réseau, n'utilise aucun serveur, aucune analyse d'audience, aucun cookie et aucune télémétrie. Aucune donnée n'est partagée avec des tiers, ni avec l'éditeur de l'extension.

Le premier téléchargement du modèle Gemini Nano est effectué par Chrome lui-même, selon les conditions de Google, à ta demande explicite depuis le popup.

## Liens vers senzu.tech

Les liens vers le site de Senzu présents dans l'extension (popup, page de l'extension) contiennent des paramètres UTM (`utm_source=slopcut`, etc.). Ils indiquent seulement que la visite vient de Slopcut ; aucune donnée personnelle ni aucun contenu LinkedIn n'y figure. Ils ne sont transmis que si tu cliques.

## Éditeur

Slopcut est un projet gratuit édité par [Senzu](https://senzu.tech/).

## Contact

Pour toute question : [senzu.tech](https://senzu.tech/) ou une issue sur ce dépôt.
