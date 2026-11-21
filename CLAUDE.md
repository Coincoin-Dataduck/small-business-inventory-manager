# Stock Hervine — outil de gestion de stock d'une boutique de créatrice

Outil web pour Hervine (artiste qui vend sur des salons, caisse et boutique en ligne SumUp)
et Clément (qui fabrique et développe). Il sert à savoir quoi fabriquer, quoi acheter,
ce qu'il y a en réserve, avec le moins de saisie possible.

La conception a été faite et validée en amont, dans une conversation sur claude.ai. Tout est dans `docs/` :
- `docs/spec.md` : la spécification de référence (modèle de stock, salons, recommandation, catalogue, recettes)
- `docs/historique-salons.md` : les ventes réelles par salon et les ratios qui fondent la recommandation
- `docs/maquette.md` : les écrans validés, avec le lien vers la maquette interactive ; sources dans `docs/maquette/`
- `docs/decisions.md` : ce qui a été écarté et pourquoi (à ne pas reproposer)

## Règles de travail (demandées explicitement par Clément)
- **Ne pas coder avant d'avoir validé le besoin.** En cas de doute sur le fonctionnement réel de l'atelier, demander. Une erreur de modèle passée : traiter les pièces faites maison comme un « en cours » de fournée, alors que ce sont des réserves durables.
- **Ne jamais combler une information manquante par une hypothèse présentée comme acquise.** Signaler ce qui est supposé.
- Quand un mécanisme est affirmé, montrer le calcul ou la chaîne causale, et le niveau de confiance des chiffres.
- Contredire quand c'est justifié ; ne pas aller trop vite dans son sens.
- Réponses en français, ton direct, sans remplissage. Ne jamais commenter le temps écoulé entre deux messages.
- Interface pour non-initiés : vocabulaire terrain, choix par défaut assumés. Mots à l'écran : Article / à vendre, Fourniture maison (préparée d'avance), Fourniture achetée, Récup, Objectif, Préparation, Compter. Jamais : pièce (au sens d'élément de stock ; « à la pièce » = à l'unité reste correct), SKU, nomenclature, fournée, encours, réappro.
- L'ordinateur est l'usage principal ; le téléphone est un sous-ensemble (À faire, Compter, Questions).

## Mise en ligne : toujours vérifier avant (demandé par Clément, 21/11/2026)
- **Déployer uniquement avec `npm run deploy`**, jamais `wrangler deploy` directement : la commande lance d'abord `scripts/verifier.sh` et ne déploie rien si elle échoue.
- `scripts/verifier.sh` (= `npm run verifier`) : types TypeScript, base locale neuve (migrations + `scripts/verifier/donnees.sql`, données fictives), serveur local, puis `scripts/verifier/pages.cjs` ouvre chaque page dans un navigateur (directement et via le menu), fait quelques saisies de Préparation, et échoue à la moindre erreur JavaScript, réponse d'API en erreur ou message d'erreur affiché.
- Nouvelle page ou nouvel écran : l'ajouter à `PAGES` dans `scripts/verifier/pages.cjs`. Route d'API supprimée : chercher ses appels dans `public/app.js` (deux pannes passées : Accueil après l'Atelier, Réglages après `/etapes`).
- Ne jamais annoncer « c'est en ligne » sans que la vérification soit passée.

## Architecture retenue
- **Cloudflare (gratuit)** : un Worker (API + pages), base **D1** (SQLite), **Cron Trigger** pour importer les ventes SumUp, accès protégé par **Cloudflare Access**.
- Déploiement : `wrangler` avec `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` (variables d'environnement de la session), ou Workers Builds branché sur ce dépôt.
- Secrets : `SUMUP_API_KEY` en secret du Worker (`wrangler secret put`), **jamais dans le dépôt**. En session cloud : secret réseau de l'environnement, injecté par le proxy (lancer les scripts avec `SUMUP_API_KEY=proxy-injected`). En local : variable d'environnement.
- Rien n'est codé en dur côté métier : articles, familles, étapes, rendements, temps, salons sont des données éditables (écran Réglages).

## Première tâche
1. Lancer `python3 scripts/test_sumup.py` (lecture seule, lit `SUMUP_API_KEY`). Il écrit `sumup_test_resultat.json`.
2. Répondre à partir du résultat :
   - le détail des articles sort-il pour les ventes en caisse **et** en ligne ? depuis la transaction complète, le reçu, ou les deux ?
   - les articles ont-ils un identifiant stable, ou seulement un nom (→ table de correspondance nom ↔ article) ?
   - comment apparaissent remises et remboursements ?
3. Présenter les conséquences sur la conception **avant** d'écrire l'application.
4. Ne pas committer `sumup_test_resultat.json` s'il contient des données de vente (l'ajouter au `.gitignore`).

## Ensuite (ordre convenu)
- **Une seule version complète** (décision de Clément, 16/11/2026 : l'ex-V2 fait partie du minimum utile) : catalogue + recettes, stock à trois niveaux + Compter, import SumUp + questions, Atelier, À acheter, Salons (préparations, objectifs recommandés, bilan, « mal exposé »), cohérence tampons, temps de travail.
- Structure des données : `docs/donnees.md`.
- Les données de départ (inventaire, rendements, lots, délais) se saisissent **dans l'outil** une fois la V1 en ligne, pas avant.
