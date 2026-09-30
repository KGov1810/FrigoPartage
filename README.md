# Frigo partagé (application web)

Application pour deux personnes, installée sur l'écran d'accueil de chaque iPhone depuis Safari. **Elle n'expire jamais** et ne demande ni Mac ni compte développeur Apple.

- **Ajout de produits** : scan du code-barres (base Open Food Facts), photo analysée par Claude, **ticket de caisse** (toutes les courses d'un coup), lecture de la date sur l'emballage, ou saisie manuelle.
- **Alertes** : les produits à consommer vite sont mis en avant à chaque ouverture, avec une pastille sur l'icône (voir les limites plus bas).
- **Recettes** : l'app montre d'abord vos recettes déjà enregistrées réalisables avec le frigo actuel (gratuit). Sinon, Claude en propose 5 nouvelles qui utilisent d'abord les produits qui vont périmer, complétés par le frigo et la liste de courses. Filtres : nombre de personnes, végétarien ou vegan, léger, difficulté, temps total, batch cooking. Calories estimées par portion, quantités recalculables selon le nombre de portions.
- **Recettes toujours à jour** : un produit racheté est reconnu dans les anciennes recettes grâce à son code-barres (ou, à défaut, à son nom).
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
- **Nombre et poids** : dans la fiche, **Nombre** (boutons − et +) indique combien d'unités vous avez, **Poids ou contenance** la taille de chacune. Deux sachets de 2 kg de pommes de terre : nombre 2, poids « 2 kg », affiché « 2 × 2 kg » avec une pastille ×2. Un pack scanné « 4 x 125 g » est compris comme 4 pots de 125 g.
- **Scanner un produit déjà au frigo** : l'app le signale et propose de l'ajouter au produit existant (même date de péremption) plutôt que d'en créer un second.
- **Ticket de caisse** : **+** → *Scanner un ticket de caisse*. Photographiez le ticket (plusieurs photos de haut en bas s'il est long, ou une capture de commande en ligne) → **Lire le ticket**. Vérifiez la liste : corrigez un nom, le nombre ou le poids, décochez ce qui ne va pas au frigo, puis **Ajouter**. Les produits arrivent dans la section **Date à compléter** (compteur « ? ») : touchez-les pour indiquer la date, ou « Lire la date » pour la photographier. Les articles de la liste de courses retrouvés sur le ticket en sont retirés. Nécessite une clé Claude.
- **Consommé** : touchez le rond à gauche d'un produit. S'il y en a plusieurs, une seule unité est retirée (« il en reste 1 ») ; le produit disparaît à la dernière. Un bouton **Annuler** apparaît quelques secondes. Pour tout retirer d'un coup : fiche du produit → *Consommé : retirer du frigo*.
- **Racheter** : dans la fiche d'un produit, *Ajouter à la liste de courses*.
- **Recettes** : choisissez **pour combien de personnes** (choix mémorisé), et si besoin **Végétarien**, **Vegan** ou **Léger** (500 kcal maximum par portion, seuil réglable dans Réglages → Recettes). Les produits à consommer vite sont présélectionnés (*Choisir les produits* pour changer). La section **Déjà dans vos recettes** liste les recettes enregistrées réalisables avec le frigo actuel (au plus deux ingrédients à se procurer), celles qui utilisent les produits à consommer vite en premier. Si aucune ne convient, **Proposer 5 nouvelles recettes**. Dans une recette : ajouter aux courses ce qui manque, favori (étoile), partager, **J'ai cuisiné cette recette** (retire une unité de chaque produit utilisé).
- **Dans une recette**, les boutons **Portions** − et + recalculent les quantités (les temps de cuisson restent indicatifs) ; « ajouter aux courses » et « partager » suivent ce nombre. Les calories sont une **estimation** de Claude par portion.
- Chaque ingrédient indique où il se trouve : *Au frigo* (le produit d'origine), *Au frigo (même code-barres)* (produit racheté), *Au frigo (produit similaire)* (retrouvé par son nom, à vérifier), *Sur la liste de courses*, *Placard* ou *À acheter*. Pour profiter du rapprochement par code-barres, ajoutez vos produits en les scannant.
- **Courses** : tapez l'article et, si besoin, la quantité à acheter (« 2 kg », « 3 », « 2 paquets »…). Touchez le rond pour cocher, touchez le nom pour modifier la quantité. Ajouter un article déjà présent avec une nouvelle quantité met simplement sa quantité à jour. Une fois acheté, l'icône frigo le range au frigo : « 2 paquets de 1 kg » devient nombre 2, poids « 1 kg ».

## Mettre à jour l'app

1. Sur GitHub, ouvrez le dépôt `frigo` → **Add file → Upload files**.
2. Glissez **tous les fichiers** de la nouvelle version (ils remplacent les anciens), puis **Commit changes**.
3. Attendez une à deux minutes, puis sur chaque iPhone fermez complètement l'app (balayez-la vers le haut dans le sélecteur d'apps) et rouvrez-la. Si l'ancienne version s'affiche encore, recommencez une fois.

Aucune donnée n'est perdue : ni le frigo, ni les recettes, ni la clé Claude.

## Limites connues

- **Pas de notification quand l'app est fermée** (limite des applications web sans serveur) : voir l'étape 6. Une vraie notification quotidienne serait possible plus tard, avec une petite automatisation gratuite sur GitHub, au prix d'une configuration plus technique.
- **Scanner** : un peu moins rapide que l'appareil photo natif. Visez bien, avec de la lumière, le code à l'horizontale dans le cadre. À défaut : *Photographier le code-barres* ou taper les chiffres.
- **Rapprochement par le nom** : utile mais pas infaillible (« Pommes » peut retrouver « Pommes de terre »). Il est signalé *produit similaire* ; la confirmation de « J'ai cuisiné » liste les produits retirés.
- **Synchronisation après une pause** : quand l'app revient au premier plan, elle rétablit sa connexion (« Actualisation… » pendant une seconde). Si l'autre iPhone a fait une modification alors qu'il était hors ligne, elle n'arrive qu'une fois qu'il a retrouvé le réseau et été rouvert.
- **Lecture de date sans Claude** : l'outil gratuit (téléchargé au premier usage, quelques Mo) est fiable sur les dates bien imprimées, beaucoup moins sur les dates embossées ou au jet d'encre. Avec une clé Claude, c'est Claude qui lit la date, bien plus fiable.
- **Open Food Facts** : base collaborative, certains produits sont absents ou incomplets.
- **Calories** : estimation de Claude, à environ 20 % près. Les recettes créées avant cette fonction n'ont ni calories ni régime : elles sont masquées quand un filtre Végétarien, Vegan ou Léger est actif.
- **Ticket de caisse** : pas de date de péremption sur un ticket, ni de code-barres (le rapprochement avec les anciennes recettes se fait alors par le nom). La photo est envoyée à Claude pour être lue (environ 1 à 3 centimes) ; elle peut contenir le nom du magasin et les derniers chiffres de la carte bancaire, et n'est pas conservée dans l'app.
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
| « Accès à la caméra refusé » | Réglages de l'iPhone → Safari → Caméra → Autoriser (ou Demander), puis « Réessayer ». |
| Écran noir ou « La caméra ne s'affiche pas » dans le scanner | Touchez **Démarrer la caméra**, puis **Réessayer**. Si l'image reste noire : fermez complètement l'app (balayez-la vers le haut) et rouvrez-la ; vérifiez aussi qu'aucune autre app (appel vidéo, appareil photo) n'utilise la caméra. En attendant : **Photographier le code-barres** ou tapez les chiffres. |
| Une modification de l'autre iPhone n'apparaît pas | Réglages → **Se reconnecter**. Vérifiez que l'autre iPhone a du réseau et que l'app y a été rouverte (l'indication sous le titre doit être « Synchronisé », pas « Envoi en cours… »). |
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
