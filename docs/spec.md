# Spécification — outil de stock de la boutique d'Hervine

Validée question par question avec Clément (novembre 2026). Les « ? » sont des inconnues à remplir **dans l'outil** une fois en ligne.

## 1. Modèle de stock
- **Stocks à plusieurs niveaux**, tous comptables et corrigeables :
  - **À vendre** : articles prêts pour le stand ;
  - **Fait maison** : réserves préparées d'avance, qui peuvent rester des mois (ex. 40 canards peints et découpés, en boîte) ;
  - **Acheté** ou **récup** : fournitures.
- Fabriquer = **une étape qui transforme des stocks en un autre stock**, faite à son rythme :
  - certaines **par matière entière** (« peindre et découper une planche » → ~50 canards découpés) : une plaque/feuille est toujours consommée entière ;
  - d'autres **à la pièce** (« monter 10 canards »).
- **Planification** : pour l'objectif d'un article, partir de ce qui est déjà fait maison et **ne remonter à l'étape précédente que si la réserve ne suffit pas**. Proposer les étapes dans l'ordre où les faire. Ce qui dépasse le besoin part en réserve (et le dire).
- **Pas de réservation** de pièces.
- Pièces partagées entre familles (MDF A3 : mini-presses + canards ; contreplaqué A3 : kits + scarabées) : les besoins s'additionnent.
- **Temps** par étape (par pièce ou par matière entière) ; la charge affichée ne compte que ce qu'il reste à faire.
- Rendements variables (ex. gomme : ~150 tampons par feuille) : valeur de départ, affinée par les quantités réellement déclarées.

## 2. Ventes et corrections
- Ventes importées automatiquement depuis **SumUp** (caisse au stand + boutique en ligne). Ko-fi abandonné.
- Une vente décrémente le stock « à vendre ».
- **Une seule façon de corriger un chiffre : Compter** (« combien en avez-vous vraiment ? »), déclenchée :
  - par un comptage (global ou d'une famille) ;
  - par une **vente impossible** (SumUp vend un article à stock 0 → question anti-oubli : « vous en avez sûrement fabriqué sans le noter, combien en aviez-vous ? ») ;
  - par une étape qui utilise plus de pièces que le stock (« selon l'outil il ne restait que 3 attaches ; combien en aviez-vous vraiment ? »).
- **Tampons** : un seul article générique à la caisse ; le suivi par motif se fait par comptage avant / après salon. Ventes d'un motif = avant + fabriqué − après. Vérification : unités + 4 × lots + 20 × collections + tampons des gachapons ≈ écart compté.
- Nouvel article vu dans SumUp → « dans quelle famille le mettre ? » (ou « ne pas suivre »).

## 3. Salons et préparations
- **Tout tourne autour des salons** : pas de stock minimum hors salon.
- Un salon = nom, type, dates, nombre de jours, fréquentation attendue.
- Salons trop rapprochés pour refaire du stock entre eux (écart < seuil, 14 jours par défaut) sont **proposés** dans une même **préparation** ; Séparer / Regrouper à la main, retour possible à la proposition.
- Objectif par article et par salon ; objectif de la préparation = somme ; marge (30 % par défaut) appliquée **une seule fois** par préparation.
- Étapes d'une préparation : Objectifs → Comptage avant → Comptages au retour (un par salon) → Bilan (automatique).
- **Recommandation** : voir `historique-salons.md` (tampons comme thermomètre, meilleur ratio passé, case « mal exposé ou épuisé » au bilan). L'outil recommande, Hervine/Clément fixent.

## 4. Achats
- Chaque ligne détaille son calcul (« il en faut X − Y en stock − Z en route ») et une date « à commander avant le … » (premier salon − délai fournisseur).
- Boutons : Commandé / J'en ai déjà (= compter) / Modifier. Puis Commandé → Reçu (à la réception, la taille de lot inconnue est notée).
- Tailles de lot multiples possibles (contreplaqué : 30 / 80 / 160).
- Encreurs VersaFine : le fournisseur se vide avant les festivals → « prendre tout le disponible » plutôt qu'une quantité.
- Carton de récup : jamais en achat, alerte « gardez des cartons ».
- Peinture : pas de quantité ; bouton « pot presque vide ».

## 5. Réglages
- Rien codé en dur : articles, familles, étapes, rendements, temps, salons = données éditables.
- **Familles** porteuses des étapes ; un nouvel article hérite de sa famille (nouveau print = un nom ; nouvelle mini-presse = nom + couleur).
- Fonctionnement (interrupteurs) : regroupement auto des salons, seuil, marge, marge unique par préparation, temps de travail, contrôle de cohérence des tampons.
- Arrêter un produit : « Fin de série » (réversible) : le stock restant se vend, plus de fabrication ni d'achat de ses pièces.

## 6. Catalogue (articles actifs) et étapes
| Article | Étapes (matière → fait maison → article) |
|---|---|
| Prints (11 dessins × A5 / A4 / A3) | imprimer : 1 feuille print A3 → 1 A3 / 2 A4 / 4 A5 (dessins mélangés, jamais de perte) → découper/emballer : + 1 carton et 1 pochette du format |
| Mini-presses (5 modèles) | peindre+découper : 1 plaque MDF A3 d'une couleur → 23 planchettes (2 par presse, une plaque = un seul modèle) ; buvard : 1 feuille Canson → 3 bandes ; carton : 1 planche de carton (récup) → ? cartons ; monter : 2 planchettes + 3 bandes + 2 cartons + 2 élastiques |
| Tampons (25 motifs) | graver : 1 feuille gomme A4 → ~150 gommes ; coller : 1 gomme + 1 cube en bois (acheté) |
| Tampon lot | 4 tampons + 1 emballage + 1/45 feuille de stickers ronds (imprimés à la demande) |
| Collection | 20 tampons (emballage non suivi) |
| Encreur VersaFine petit format | acheté-revendu, couleurs non suivies |
| Kit Maison / Kit Serre | découper : 1 contreplaqué A3 → 1 jeu de 4 planchettes ; livret : 1 feuille kraft A4 ; pochette : 1 feuille A3 (kraft ?) ; lampe : 1 boîtier + 1 pile CR2032 + 1 mini LED ; assembler + 1/45 feuille de stickers |
| Canard de poche | peindre (blanc)+découper : 1 plaque MDF A3 → ~50 canards ; cartonnettes : imprimées, ? par feuille ; monter : 1 canard + 1 attache + 1 cartonnette + 1 pochette plastique |
| Scarabée | peindre+découper : 4 contreplaqués A3 (2 noir, 1 vert brillant Lefranc Bourgeois, 1 blanc) → 16 jeux ; cerclage : papier print A4, 5 par feuille ; monter |
| Carnet | 1 carnet vierge acheté + linogravure |

Couleurs des mini-presses : Baba Yaga orange, Crâne noir, Grenouille vert clair, Sauge vert foncé, Timbre bleu.

### Motifs de tampons (25)
- Bulles : Miaou, Coin, Wouf, Bulle cœur
- Grenouilles : Grenouille magicienne sommeil, Grenouille café, Grenouille cœur, Grenouille magicienne, Grenouille qui tire la langue
- Canards : Canard « … », Canard blasé, Canard-cœur, Honk
- Divers : Patte, Yeux ronds
- Animaux longs (chaque morceau vendu séparément) : Tête + Arrière pour Chat blanc, Corgi, Chat noir, Teckel (8) ; Corps blanc (chat blanc / corgi) ; Corps noir (chat noir / teckel)

### Fin de série
Lanternes (Animaux timides, Maisons secrètes, Oiseaux), boucles d'oreille ×4, pins ×4, 16 Lueurs d'Hiver, 61 Feuilles d'Automne.

### Fournitures — lots connus
Contreplaqué A3 : 30 / 80 / 160 · feuilles buvard Canson : 12 · cubes bois : 90 · emballage lot : 50 · boîtiers de pile : 10 · mini LED : 10 · stickers ronds : 45 par feuille.
Inconnus : papier print A3/A4, cartons et pochettes A5/A4/A3, MDF, élastiques, gomme, kraft, papier A3 kit, CR2032, attaches, pochettes plastique, carnets vierges.

## 7. Hors suivi
Encre d'imprimante (EcoTank ET8550), encre de linogravure, emballage de la Collection, gachapon (contient surtout des tampons).

## 8. Points ouverts
- Rendements : planche de carton → combien de cartons ? cartonnettes par feuille ?
- Pochette du kit : kraft ou autre papier ?
- Temps réels par étape ; délais fournisseurs.
- Résultats du test API SumUp (détail des articles en ligne ? identifiants ? remises / remboursements ?).
- Nettoyage SumUp (indépendant de l'outil) : article à prix fixe « tampon + encreur » et lots à prix fixes (plus de saisie libre), retirer l'option « Encreur » de la Collection, stocks négatifs à recaler au premier comptage.
