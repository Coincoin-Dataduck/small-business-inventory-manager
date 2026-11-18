# Décisions et pistes écartées

À ne pas reproposer sans élément nouveau.

| Sujet | Décision | Pourquoi |
|---|---|---|
| Outil existant (InvenTree, Odoo…) | Écarté, développement sur mesure | Trop « logistique » pour une non-initiée ; l'outil doit partir du terrain. |
| Hébergement | Cloudflare gratuit, pas le NAS Synology | Le NAS impose un port dans l'URL et coince avec le relais privé iCloud : pannes probables sur le téléphone d'Hervine. |
| Ko-fi | Abandonné | La boutique passe sur SumUp ; une seule source de ventes. |
| Encours / « chaîne d'étapes » d'une fournée | **Remplacé** par des stocks à plusieurs niveaux + étapes de transformation | Les pièces faites maison (ex. 40 canards découpés) sont des réserves qui durent des mois ; on n'en monte qu'une partie selon le besoin. Le modèle « fournée en cours » faisait perdre la trace de ces réserves. |
| « Lancer / Terminer » une fournée avec réservation | Écarté | Même problème : on ne sait plus pourquoi des pièces sont réservées. |
| Stock cible fixé à la main | Remplacé par : l'outil **recommande**, Hervine/Clément **fixent** | — |
| Recommandation proportionnelle à la fréquentation | Écartée | Le stand sature : ~5 tampons / 1 000 visiteurs sur les gros salons contre ~20 sur les petits. |
| Recommandation = moyenne des salons passés | Écartée au profit du **meilleur** ratio passé | Les ventes d'un article dépendent de sa mise en avant ; la moyenne mélange salons bien et mal exposés. |
| Regroupement des salons proches | Gardé (proposition auto + Séparer / Regrouper à la main) | Interface jugée efficace par Clément. |
| Multiples façons de corriger un stock | Fusionnées en une seule : **Compter** | Six mécanismes disaient la même chose (« le chiffre est faux, tapez le vrai »). |
| Stock et Atelier affichant tous deux « il en manque » | Stock = inventaire pur ; Atelier = quoi faire | Une information, une seule page. |
| Bouton « Pas maintenant » dans les achats | Remplacé par « J'en ai déjà » (= compter) et « Modifier » + date « à commander avant » | Une ligne repoussée réapparaît sans qu'on sache pourquoi. |
| Encre d'imprimante, encre de linogravure | Hors suivi | EcoTank ; consommation non mesurable par pièce. |
| Peinture | Pas de quantité ; liée à la couleur du modèle, bouton « pot presque vide » | Consommation trop petite et variable. |
| Gachapon | Non suivi comme produit | Contient surtout des tampons, captés par les comptages. |
| Tampons à la caisse | Un seul article générique ; sorties par motif = écart entre deux comptages avant préparation, + fabriqué | Les clients se servent ; saisir le motif à la caisse serait trop lourd. |
| Comptage au retour de salon | Supprimé (16/11/2026) | Trop lourd ; ventes = carte + espèces saisies. Prix : dons/pertes/vols invisibles jusqu'au comptage suivant, tampons par motif connus seulement par préparation. |
| Suivi des étapes de fabrication (Atelier : étapes numérotées, ordre, temps par étape, « C'est fait » par étape ; éditeur de recettes en établi) | **Remplacé** (18/11/2026) par l'écran de préparation : quoi produire → fournitures à vérifier → checklist de ce qu'on a produit → comptage avant | Clément : « on n'a pas besoin de suivre les étapes ». Le besoin est de savoir quoi produire, ce qu'il faut vérifier avant de commander, et de cocher ce qui est fait. La saisie des étapes était devenue un chantier à elle seule. |
| Quantité exacte à acheter calculée sur le stock théorique des fournitures | Remplacée par une **liste de vérification** (chaque ligne vérifiée, puis commande) | Le stock des fournitures achetées dérive (autres usages, bouts de feuille entamés) ; l'outil signale et fait vérifier, il n'affirme pas. |
| Charge de travail en heures | Abandonnée (18/11/2026) : une préparation dure 15 jours avant le salon | Inutile en pratique. |
| Saisie des données de départ avant le développement | Écartée | Elles se saisissent dans l'outil, sinon on saisit deux fois. |
