# Maquette validée

Maquette interactive (Claude, privée au compte de Clément) : https://claude.ai/artifact/QY8tQqq22y82NUvtFoYJNc
Sources copiées ici : `docs/maquette/ordinateur.dc.html`, `docs/maquette/telephone.dc.html`
(format « Design Component » : HTML + logique JS dans la balise `<script type="text/x-dc">`, utile comme référence du comportement attendu ; pas du code à déployer tel quel).

Toutes les quantités, les salons de décembre et les temps sont des **exemples**. Les ratios et l'historique des salons sont réels.

**Mise à jour du 18/11/2026** : Atelier et Objectifs sont remplacés par l'**écran de préparation** (maquette validée : https://claude.ai/artifact/3gyi4HfmXJAw5WhoBF2U6K, spec §3). Les descriptions Atelier / À faire / recettes par étapes ci-dessous sont caduques.

## Ordinateur (usage principal) — menu latéral
- Encart permanent « On prépare » : préparation en cours, date limite, J-x.
- **Stock** : tableau par famille ; chaque ligne marquée À vendre / Fait maison / Acheté / Récup ; filtres par famille ; bouton par ligne « Compter » ; bouton « Faire un comptage » (colonne « compté », écarts en direct, enregistrer). Bandeau anti-oubli : « SumUp a vendu 2 X alors qu'il n'en restait plus. Combien en aviez-vous vraiment ? »
- **Atelier** : bandeau (préparation, date limite, travail restant). Une carte par article qui manque : objectif (détaillé par salon), prêts, il en manque, réserve faite maison ; **étapes numérotées dans l'ordre où les faire**, chacune avec ce qu'elle utilise (✓ en stock, ↑ fait juste avant, ⚠ manque → À acheter), ce qu'elle donne (et ce qui ira en réserve), son temps, et « C'est fait… » (quantité ; avertissement sous le champ si une pièce limite ; si on déclare plus que le stock : « combien en aviez-vous vraiment ? »).
- **À acheter** : tableau (pièce, calcul, à commander, avant le) ; Commandé / J'en ai déjà / Modifier ; section Commandé → Reçu.
- **Salons** : timeline des prochains salons avec l'écart entre chaque, Séparer / Regrouper, « Revenir à la proposition » ; préparation en cours (Objectifs → Comptage avant → Bilan ; plus de comptage au retour, décision du 16/11/2026) ; tableau des salons passés avec tampons / 1 000 visiteurs et bouton Bilan.
- **Objectifs** : 1) tampons prévus par salon (salons comparables, calcul affiché) ; 2) par article : ratio pour 100 tampons au meilleur salon, part du modèle, conseillé et retenu par salon (− / +), total à avoir.
- **Bilan** : CA par jour, espèces (saisie des quantités par article), tampons, vérification tampons (caisse vs comptage avant suivant), par article : vendus, pour 100 tampons, « mal exposé ou épuisé ? » (exclut des recommandations).
- **Réglages** : Fonctionnement (regroupement auto, seuil, marge, marge unique par préparation, temps de travail, contrôle tampons) ; Familles et recettes (étapes : utilise / donne / à la pièce ou par matière entière / temps ; ajouter une étape ; articles de la famille ; ajouter un article ; article inconnu vu dans SumUp → choisir la famille) ; Fournitures.

## Téléphone (à l'atelier et au stand) — 3 onglets
- **À faire** : les étapes de l'Atelier, « C'est fait… ».
- **Compter** : par famille, − / +, écarts soulignés.
- **Questions** : questions anti-oubli.
Achats, salons, objectifs, réglages : ordinateur uniquement.
