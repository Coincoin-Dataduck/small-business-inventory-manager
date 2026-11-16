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
- Interface pour non-initiés : vocabulaire terrain, choix par défaut assumés. Mots à l'écran : Prêt / à vendre, Fait maison, Acheté, Objectif, Préparation, Compter. Jamais : SKU, nomenclature, fournée, encours, réappro.
- L'ordinateur est l'usage principal ; le téléphone est un sous-ensemble (À faire, Compter, Questions).

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
- **V1** (utilisable au prochain salon) : catalogue + recettes, stock à trois niveaux + Compter, import SumUp + question anti-oubli, Atelier (étapes à faire, « C'est fait »).
- **V2** : À acheter, Salons (préparations, objectifs recommandés par les tampons, bilan, case « mal exposé »), cohérence tampons, temps de travail.
- Les données de départ (inventaire, rendements, lots, délais) se saisissent **dans l'outil** une fois la V1 en ligne, pas avant.
