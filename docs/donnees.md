# Structure des données (base D1)

Proposition pour la première version complète (ex-V1 + V2). À valider avant le code.
Rien de métier n'est codé en dur : tout ce qui suit est saisi et modifié dans l'outil.

## Principe : un journal, pas un chiffre
Le stock d'une pièce n'est pas stocké : c'est la **somme de ses mouvements** (vente, étape faite, comptage, réception d'achat, remboursement).
Un comptage n'écrase rien : il ajoute la différence entre le compté et l'attendu, avec son motif.
Pourquoi : chaque chiffre doit pouvoir s'expliquer, et les sorties de tampons par motif se calculent entre deux comptages (« avant + fabriqué depuis − avant suivant »).

Quantités toujours **entières**. Une fraction (« 1/45 de feuille de stickers ») devient une étape (« imprimer une feuille → 45 stickers »).

## Catalogue et stock
**famille** — nom, ordre d'affichage, gabarit d'étapes pour les nouveaux articles (ex. mini-presse : nom + couleur).

**piece** — tout ce qui a un stock.
- nom, famille, niveau : `a_vendre` / `fait_maison` / `achete` / `recup`
- état : en vente / fin de série (réversible)
- suivi : `quantite` (normal) · `sans_quantite` (peinture : seulement « pot presque vide ») · `generique` (« Tampon » de la caisse : ventes comptées, pas de stock)
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

**correspondance** — clé = nom + description nettoyés (espaces, casse) → ce qu'une vente décompte :
- une ou plusieurs pièces avec quantité (ex. « Tampon lot » → 1 emballage lot + 1 sticker rond, les tampons par motif étant rattrapés aux comptages)
- `equivalent_tampons` pour le contrôle de cohérence (unité 1, lot 4, collection 20)
- ou « ne pas suivre »

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
