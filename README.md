# Frigo partagé (application web)

Application pour deux personnes, installée sur l'écran d'accueil de chaque iPhone depuis Safari. **Elle n'expire jamais** et ne demande ni Mac ni compte développeur Apple.

- **Ajout de produits** : scan du code-barres (base Open Food Facts), photo analysée par Claude, lecture de la date sur l'emballage, ou saisie manuelle.
- **Alertes** : les produits à consommer vite sont mis en avant à chaque ouverture, avec une pastille sur l'icône (voir les limites plus bas).
- **Recettes** : Claude propose 5 recettes qui utilisent d'abord les produits qui vont périmer, complétés par le frigo et la liste de courses. Filtres : difficulté, temps total, batch cooking.
- **Produits consommés** : le rond à gauche de chaque produit, la fiche du produit, ou « J'ai cuisiné cette recette ».
- **Partage en temps réel** entre les deux iPhone (frigo, liste de courses et recettes), via une base Firebase gratuite. Fonctionne aussi hors ligne.

Tout est gratuit, sauf les fonctions Claude (facultatives, quelques centimes par usage).

---

## Ce qu'il faut

- Un **compte Google** (pour Firebase) et un **compte GitHub** (pour héberger l'app), tous deux gratuits.
- Un ordinateur (Windows convient) est plus confortable pour les étapes 1 et 2, mais elles sont faisables depuis Safari sur iPhone.
- iOS 16.4 ou plus récent sur les deux iPhone.

Comptez environ 25 minutes, une seule fois.

---

## Étape 1 — Créer la base Firebase (≈ 10 min)

1. Allez sur [console.firebase.google.com](https://console.firebase.google.com) → **Créer un projet** (nom libre, ex. « frigo-partage »). Google Analytics est inutile : désactivez-le.
2. Sur la page du projet, cliquez sur l'icône **Web** `</>` (« Ajouter une application »). Donnez un surnom (ex. « frigo »), **ne cochez pas** Firebase Hosting, puis **Enregistrer**.
3. Firebase affiche un bloc qui commence par `const firebaseConfig = {`. **Copiez tout ce bloc** et gardez-le (dans Notes, par exemple). Vous le collerez dans l'app à l'étape 3.
4. Menu **Créer → Authentication** → *Commencer* → onglet *Mode de connexion* → **Anonyme** → *Activer* → *Enregistrer*.
5. Menu **Créer → Firestore Database** → *Créer une base de données* → emplacement `eur3 (europe-west)` → **mode production** → *Créer*.
6. Onglet **Règles** de Firestore : effacez tout, collez le contenu du fichier `firestore.rules` fourni, puis **Publier**.

L'offre gratuite « Spark » suffit largement et ne demande aucune carte bancaire.

## Étape 2 — Mettre l'app en ligne avec GitHub Pages (≈ 10 min)

1. Créez un compte sur [github.com](https://github.com) si besoin.
2. En haut à droite : **+** → **New repository**. Nom : `frigo`. Laissez **Public** (obligatoire pour GitHub Pages gratuit). Cliquez **Create repository**.
3. Sur la page suivante, cliquez le lien **uploading an existing file**.
4. Décompressez le zip, ouvrez le dossier `frigo-partage-web` et **glissez tous les fichiers qu'il contient** (pas le dossier lui-même) dans la zone. Cliquez **Commit changes**.
5. Onglet **Settings** → **Pages** (menu de gauche) → *Branch* : `main`, dossier `/ (root)` → **Save**.
6. Patientez une à deux minutes. L'adresse de l'app apparaît en haut de cette page, du type `https://votre-pseudo.github.io/frigo/`.

> Sur iPhone, si le lien « uploading an existing file » n'apparaît pas, touchez **aA** dans la barre d'adresse → **Demander le site pour ordinateur**. Pour décompresser le zip, touchez-le dans l'app Fichiers.

Aucun secret n'est publié : la configuration Firebase n'est saisie que dans l'app, et vos données sont protégées par le code du foyer.

## Étape 3 — Installer sur le premier iPhone

1. Ouvrez l'adresse de l'étape 2 dans **Safari**.
2. Touchez **Partager** (carré avec une flèche) → **Sur l'écran d'accueil** → **Ajouter**.
3. Ouvrez **Frigo** depuis l'écran d'accueil (pas depuis Safari : l'app installée garde ses propres données).
4. Collez le bloc `firebaseConfig` copié à l'étape 1.3 → **Continuer**.
5. Saisissez votre prénom → **Créer un foyer**.
6. Touchez **Envoyer** pour transmettre l'invitation à l'autre personne (Messages, WhatsApp, e-mail…), puis **Commencer**.

## Étape 4 — Installer sur le second iPhone

1. Ouvrez le lien contenu dans l'invitation reçue, dans **Safari**.
2. **Partager** → **Sur l'écran d'accueil** → **Ajouter**, puis ouvrez l'app depuis l'écran d'accueil.
3. Collez **le message d'invitation entier** (l'app retrouve toute seule le code `FRIGO1.…`) → **Continuer**.
4. Saisissez votre prénom → **Rejoindre le foyer**. Le frigo partagé apparaît aussitôt.

Gardez l'invitation quelque part (Notes) : elle permet de réinstaller l'app si elle est supprimée de l'écran d'accueil. Elle reste aussi disponible dans **Réglages → Foyer partagé**.

## Étape 5 — Clé Claude (facultatif, sur chaque iPhone)

1. Créez une clé sur [console.anthropic.com](https://console.anthropic.com) et ajoutez quelques euros de crédit.
2. Dans l'app : **Réglages → Recettes et photos** → collez la clé → **Enregistrer la clé**.

La clé reste sur l'iPhone où elle est saisie. Comptez quelques centimes pour 5 recettes, moins d'un centime par photo. Sans clé, le code-barres, la lecture de date (moins précise) et la saisie manuelle fonctionnent quand même, mais pas les recettes.

## Étape 6 — Rappel quotidien et pastille (recommandé)

Une application web ne peut pas envoyer de notification quand elle est fermée. Pour compenser :

- **Rappel quotidien** : dans l'app **Rappels** d'iOS, créez un rappel « Vérifier le frigo », avec une date, une heure (ex. 18 h) et **Répéter : tous les jours**. Chaque jour, ouvrez Frigo : les produits à consommer vite sont en haut, avec un bouton vers les recettes.
- **Pastille sur l'icône** : dans l'app, **Réglages → Alertes** → *Afficher sur l'icône le nombre de produits à consommer* → **Autoriser**. La pastille se met à jour à chaque ouverture de l'app.

Le nombre de jours de prévenance (0 à 7, 2 par défaut) se règle dans **Réglages → Alertes**.

---

## Utilisation au quotidien

- **Ajouter** : bouton **+** → *Scanner un code-barres*, *Prendre le produit en photo* ou *Saisir à la main*. Dans la fiche, **Lire la date** photographie la date de près. **Vérifiez toujours la date proposée.**
- **Consommé** : touchez le rond à gauche d'un produit. Un bouton **Annuler** apparaît quelques secondes.
- **Racheter** : dans la fiche d'un produit, *Ajouter à la liste de courses*.
- **Recettes** : les produits à consommer vite sont présélectionnés (*Choisir les produits* pour changer). Réglez les filtres, puis **Proposer 5 recettes**. Dans une recette : ajouter les ingrédients manquants aux courses, favori (étoile), partager, **J'ai cuisiné cette recette**.
- **Courses** : touchez un article pour le cocher. L'icône frigo le range au frigo avec sa date.

## Mettre à jour l'app

Remplacez les fichiers sur GitHub (**Add file → Upload files**, puis *Commit changes*). Chaque iPhone charge la nouvelle version à l'ouverture suivante, sans rien perdre.

## Limites connues

- **Pas de notification quand l'app est fermée** (limite des applications web sans serveur) : voir l'étape 6. Une vraie notification quotidienne serait possible plus tard, avec une petite automatisation gratuite sur GitHub, au prix d'une configuration plus technique.
- **Scanner** : un peu moins rapide que l'appareil photo natif. Visez bien, avec de la lumière. À défaut : *Photographier le code-barres* ou taper les chiffres.
- **Lecture de date sans Claude** : l'outil gratuit (téléchargé au premier usage, quelques Mo) est fiable sur les dates bien imprimées, beaucoup moins sur les dates embossées ou au jet d'encre. Avec une clé Claude, c'est Claude qui lit la date, bien plus fiable.
- **Open Food Facts** : base collaborative, certains produits sont absents ou incomplets.
- **DLC ou DDM** : l'app ne fait pas la différence. Claude a pour consigne de ne jamais utiliser un produit frais (viande, poisson, laitier, traiteur) dont la date est dépassée.
- **Sécurité** : toute personne qui possède l'invitation peut voir et modifier vos données. Ne la partagez qu'avec l'autre utilisateur.
- **Une app par iPhone** : la version ouverte dans Safari et celle de l'écran d'accueil ne partagent pas leurs réglages. Utilisez toujours celle de l'écran d'accueil.

## Dépannage

| Message ou symptôme | Solution |
|---|---|
| « Texte non reconnu » à la connexion | Collez le bloc `firebaseConfig` complet (étape 1.3), ou le message d'invitation entier. |
| « Activez la connexion Anonyme… » | Étape 1.4. |
| « Authentication n'est pas activé » | Étape 1.4 : cliquez d'abord sur *Commencer*. |
| « Base Firestore introuvable » | Étape 1.5. |
| « Accès refusé par Firebase » | Règles non publiées : étape 1.6. |
| « Aucun foyer ne correspond à ce code » | Renvoyez l'invitation depuis le premier iPhone (Réglages → Foyer partagé). |
| Page GitHub « 404 » | Attendez deux minutes après l'étape 2.5 ; vérifiez que `index.html` est à la racine du dépôt, pas dans un sous-dossier. |
| « Accès à la caméra refusé » | Réglages de l'iPhone → Safari → Caméra → Autoriser (ou Demander). |
| « Crédit Claude épuisé » | Ajoutez du crédit sur console.anthropic.com. |
| L'app affiche une ancienne version | Fermez-la complètement (glisser vers le haut dans le sélecteur d'apps) et rouvrez-la. |

**Autre hébergement possible** : [Netlify Drop](https://app.netlify.com/drop) (glisser le dossier dans la page, puis créer un compte gratuit pour garder le site en ligne).

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css` | Page et apparence |
| `app.js`, `ui.js` | Écrans et interactions |
| `store.js` | Données partagées (Firebase) et réglages |
| `services.js` | Dates, lecture de date, Open Food Facts, Claude, code-barres |
| `sw.js`, `manifest.json`, `icon-*.png` | Installation sur l'écran d'accueil, fonctionnement hors ligne |
| `config.js` | Facultatif : configuration Firebase pré-remplie pour les deux iPhone |
| `firestore.rules` | Règles de sécurité à coller dans Firebase (étape 1.6) |

Données produits : © les contributeurs d'Open Food Facts, licence ODbL.
