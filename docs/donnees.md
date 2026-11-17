# Structure des données (base D1)

Proposition pour la première version complète (ex-V1 + V2). À valider avant le code.
Rien de métier n'est codé en dur : tout ce qui suit est saisi et modifié dans l'outil.

## Principe : un journal, pas un chiffre
Le stock d'une pièce n'est pas stocké : c'est la **somme de ses mouvements** (vente, étape faite, comptage, réception d'achat, remboursement).
Un comptage n'écrase rien : il ajoute la différence entre le compté et l'attendu, avec son motif.
Pourquoi : chaque chiffre doit pouvoir s'expliquer, et les sorties de tampons par motif se calculent entre deux comptages (« avant + fabriqué depuis − avant suivant »).

Quantités toujours **entières**. Une fraction (« 1/45 de feuille de stickers ») devient une étape (« imprimer une feuille → 45 stickers »).

## Catalogue et stock
**famille** — nom, ordre d'affichage, gabarit d'étapes pour les nouveaux articles (ex. mini-presse : nom + couleur), « la caisse ne précise pas le modèle » (ex. Tampons).

**piece** — tout ce qui a un stock.
- nom, famille, niveau : `a_vendre` / `fait_maison` / `achete` / `recup`
- état : en vente / fin de série (réversible)
- suivi : `quantite` (normal) · `sans_quantite` (peinture : seulement « pot presque vide »)
- achat (pièces achetées) : délai fournisseur (jours), mode `quantite` / `tout_le_disponible` (VersaFine) / `jamais` (récup : alerte « gardez des cartons »), drapeau « presque vide »

**piece_lot** — tailles de lot possibles d'une pièce achetée (contreplaqué : 30 / 80 / 160). Une réception de taille inconnue y est ajoutée.

**mouvement** — le journal : pièce, quantité (+/−), motif (`vente` (carte), `vente_especes`, `etape`, `comptage`, `reception`, `remboursement`), date, lien vers la source (ligne de vente, étape faite, comptage, commande).

## Recettes
**etape** — rangée dans une **famille** (une étape peut servir à plusieurs articles : « graver une feuille de gomme » donne des gommes de plusieurs motifs ; l'Atelier retrouve une étape par ce qu'elle **donne**) : nom, `par_matiere` ou `a_la_piece`, temps (par pièce ou par matière entière), ordre. Les étapes propres à un modèle (plaque d'une couleur) sont des étapes distinctes, créées depuis le gabarit de la famille.

**etape_utilise** — pièce + quantité consommée.

**etape_donne** — pièce + quantité produite (valeur de départ ; affinée par les quantités déclarées à « C'est fait »).
- Sortie **au choix** : une capacité (ex. 4 quarts de feuille A3) répartie à « C'est fait » entre plusieurs pièces pondérées (print A5 = 1, A4 = 2, A3 = 4). Sert aux prints : on indique quels dessins sont sortis.

**etape_faite** — date, étape, quantités réellement utilisées et produites (→ mouvements).

## Ventes SumUp
**vente** — transaction SumUp **réussie** : identifiant SumUp, date, montant, salon (déduit des dates, corrigeable).

**vente_ligne** — nom et description tels que SumUp les donne, quantité, prix.

**correspondance** — clé = nom + description nettoyés (espaces, casse) → ce qu'une vente représente :
- des articles avec quantité (`correspondance_piece`), retirés du stock ; éventuellement une fourniture utilisée à la vente (emballage d'un lot) ;
- et/ou une famille « modèle non précisé » avec quantité (`correspondance_famille`) : « Tampon lot » → Tampons × 4. Pas d'effet sur le stock ; sert au comptage des tampons (thermomètre = famille réglable) ;
- ou « ne pas suivre ».

**import_etat** — dernière transaction traitée (import par tranches de ~40, limite de 50 appels du Worker gratuit).

**question** — en attente sur l'écran Questions : `vente_impossible`, `nom_inconnu`, `remboursement`, `etape_depasse_stock` ; pièce, détail, date, réponse, date de réponse.

## Salons et préparations
**salon** — nom, type, date de début, nombre de jours, fréquentation attendue, tampons prévus, montant espèces (saisi au bilan), `regroupe_avec_precedent` (oui / non / vide = proposition automatique).

Les **préparations ne sont pas stockées** : elles se déduisent des dates et du seuil (écart entre la fin d'un salon et le début du suivant < seuil → préparés ensemble), corrigées par le choix manuel de chaque salon. Pas de données à resynchroniser quand une date change. Une préparation est désignée par son premier salon. La marge est un réglage.

**objectif** — salon, article : conseillé (calcul conservé pour l'affichage), retenu. Objectif d'une préparation = somme des retenus de ses salons, + marge.

**comptage** — date, type (`libre`, `avant`), salon (comptage avant : premier salon de la préparation).
**comptage_ligne** — pièce, attendu, compté (→ mouvement de la différence).

**bilan_article** — salon, article : « mal exposé ou épuisé » (exclut de la recommandation) ; 
**vente_especes** — salon, **nom de caisse** (clé de correspondance), quantité : recopié de la table manuscrite au bilan. Passe par les mêmes correspondances que les ventes carte (un « Tampon lot » en espèces retire son emballage et compte 4 tampons) → mouvements `vente_especes`.

## Achats
**commande** — pièce, quantité, taille de lot, date, `commande` → `recu` (→ mouvement de réception).
**achat_ajustement** — « Modifier » sur une ligne À acheter : quantité et date « à commander avant » choisies à la main.

## Réglages
**reglage** — clé / valeur : regroupement auto, seuil (14 j), marge (30 %), marge unique par préparation, temps de travail, contrôle des tampons.

## Produits à variantes (migration 0004, validé le 17/11/2026)
- `produit` (famille, nom) regroupe des variantes ; chaque variante est une ligne `piece` (stock, comptage, ventes, recettes à part) avec `produit_id` et `variante`. Son nom complet reste dans `piece.nom` (« La salamandre A4 ») : le reste de l'outil lit toujours ce nom.
- `famille.variantes` (JSON) : variantes proposées à la création d'un produit de la famille (Prints : A3, A4, A5 ; Kits : Maison, Serre). On peut en retirer à la création, en ajouter ensuite (« + variante »).
- Renommer un produit renomme ses variantes.
- Regroupement de départ : `scripts/regroupement_variantes.sql` (Tampon → petits noms ; prints → formats ; Kit, Jeu de planchettes, Livret → Maison/Serre ; Mini-presse et Planchette → motifs ; Peinture → couleurs ; fusion de « Plouf- Print Fine Art » dans Piou plouf et des deux Carnet ; famille Canards renommée Pins ; famille Carnets supprimée).

## Retirer / supprimer (migration 0005, validé le 17/11/2026)
- Depuis le Stock ou le comptage (« ⋯ ») : **Fin de série** d'un clic ; **Supprimer** :
  - jamais vendu (aucun mouvement de vente) : vraiment supprimé, comptages compris ;
  - déjà vendu : `piece.retire = 1` — absent du stock, du comptage, des achats, de l'Atelier et des objectifs à venir ; ventes gardées pour les bilans ; « Remettre dans le stock » depuis Réglages ;
  - dans les deux cas, enlevé des étapes où il apparaît, après une alerte qui les nomme.
- Fin de série sans stock : plus « à compter » (ni dans « pas encore comptés », ni dans le jalon Comptage avant).
- Encreurs : famille « la caisse ne précise pas le modèle » (comme Tampons) ; produit Encreur VersaFine, 9 couleurs au nom inscrit sur l'encreur (mini VersaFine) ; les noms de caisse avec couleur sont reliés à « Encreurs, couleur non précisée » (`scripts/encreurs_versafine.sql`).

## Recettes par produit (migration 0006, validé le 17/11/2026)
- Page **Recettes** (menu) : une recette appartient à un produit (vaut pour toutes ses variantes), à un article simple, ou à toute une famille (« Tous les prints » : une feuille donne au choix 1 A3, 2 A4 ou 4 A5).
- `recette_etape` (nom, mode, durée, ordre) + `recette_ligne` (utilise / donne ; un élément, ou « <produit> de la même variante ») + `recette_format` (recette commune : combien de chaque variante en une fois).
- Les étapes concrètes (`etape`, utilisées par l'Atelier et « C'est fait ») sont **générées** : une par variante quand l'étape cite « même variante » (« Coller · Miaou »), une seule sinon (« Graver »). Régénérées à chaque modification de recette ou du catalogue ; une étape déjà faite qui n'a plus lieu d'être est gardée inerte pour l'historique.
