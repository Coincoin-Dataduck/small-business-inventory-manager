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
- Ventes importées automatiquement depuis **SumUp**. Ko-fi abandonné.
  - **V1 : caisse au stand uniquement.** La boutique en ligne n'est pas encore ouverte ; le format de ses commandes est inconnu (à vérifier par une commande test à l'ouverture).
  - **Espèces : hors SumUp** (fonction payante non prise) ; notées sur une table manuscrite, **quantités par article**. Elles se **saisissent dans l'outil** après chaque salon (écran Bilan) : c'est ce qui les décompte du stock. Tant qu'elles ne sont pas saisies, une question le rappelle.
  - **Pas de comptage au retour de salon** (décision de Clément, 16/11/2026, pour simplifier). Ventes d'un article sur un salon = carte (SumUp) + espèces (saisies). Dons, pertes et vols ne sont pas captés : ils restent dans le stock jusqu'au prochain comptage (le **comptage avant** chaque préparation, maintenu — validé — les recale).
- Une vente (carte) décrémente le stock « à vendre ».
- Seuls les paiements **réussis** (`SUCCESSFUL`) comptent : les paiements refusés arrivent aussi avec leurs articles.
- **Correspondance SumUp ↔ article** : SumUp ne donne aucun identifiant d'article, seulement un nom et parfois une description (variante, ex. « Boucles d'oreilles » / « GRANDES » ; ailleurs la variante est dans le nom : « Mini-presse à fleurs - Sauge »). Clé = nom + description nettoyés (espaces, casse). Table de correspondance éditable ; « Tampon unité » et « Tampon lot » → article générique des tampons ; les articles en fin de série sont reliés aussi.
- **Options de couleur à la caisse** (« Tampon unité • vert ») : la couleur est celle d'un **encreur vendu avec** l'article. Couleur non suivie (validé 16/11/2026) : une variante à 1 couleur = l'article + 1 encreur, à 2 couleurs = + 2 encreurs. Les variantes sont regroupées par nombre de couleurs, pas par couleur.
- **Remboursement** : pose une question (« l'article est-il revenu en stock ? »), pas de remise en stock automatique. Remises et remboursements jamais observés dans SumUp : format à vérifier au premier cas réel.
- **Import par tranches** : le détail des articles demande un appel par transaction, et le Worker gratuit est limité à 50 appels externes par exécution. L'import traite ~40 ventes par passage et reprend où il s'est arrêté.
- **Une seule façon de corriger un chiffre : Compter** (« combien en avez-vous vraiment ? »), déclenchée :
  - par un comptage (global ou d'une famille) ;
  - par une **vente impossible** (SumUp vend un article à stock 0 → question anti-oubli : « vous en avez sûrement fabriqué sans le noter, combien en aviez-vous ? ») ;
  - par une étape qui utilise plus de pièces que le stock (« selon l'outil il ne restait que 3 attaches ; combien en aviez-vous vraiment ? »).
- **Comment on compte** (validé le 17/11/2026) :
  - deux façons, avec les mêmes filtres (famille, type) : **chercher** (on part de l'objet qu'on a en main : quelques lettres, l'article, la quantité) ou **suivre la liste** ;
  - **chaque ligne est enregistrée dès qu'on la valide** (Entrée, ✓ ou 0), comme partout ailleurs : rien ne se perd ; ↺ annule la ligne (le chiffre d'avant revient) ; « Terminer le comptage » ferme simplement l'écran (décision du 17/11/2026) ;
  - la case affiche toujours un chiffre (l'attendu, ou ce qui a déjà été compté) : « 12 » remplace, « +5 » / « -2 » ajoute ou retire au chiffre de la case ; Entrée ou ✓ = compté ; bouton « 0 » = compté, il n'y en a pas ;
  - un article absent de la liste se crée depuis le comptage (ou depuis le Stock) ; la quantité tapée est son premier comptage ;
  - ce qui n'est pas compté reste tel quel ; « pas encore compté » = pas de comptage depuis le début de la préparation en cours (lendemain du dernier salon passé ; sans salon passé saisi : aujourd'hui), d'où qu'on ait compté ; visible partout : ligne hachurée vermillon « pas compté depuis <salon> », avancement par famille, filtre « Pas encore comptés » ; on peut compter en plusieurs fois ;
  - jalon « Comptage avant » de l'Accueil : avancement « comptés / total » sur les articles à vendre suivis (hors fin de série) ; fait quand tous le sont.
- **Tampons** : la caisse ne précise pas le motif. Famille Tampons marquée « la caisse ne précise pas le modèle » ; « Tampon unité » est relié à « Tampons, modèle non précisé » × 1, « Tampon lot » × 4, « Collection » × 20 (pas d'article fictif, pas d'effet sur le stock). La famille Tampons est le thermomètre (réglage) ; le total vendu est connu (unités + 4 × lots + 20 × collections, carte + espèces). Le suivi **par motif** ne vient que des comptages : sans comptage au retour, il se déduit au **comptage avant de la préparation suivante** : sorties d'un motif = comptage avant (N) + fabriqué depuis − comptage avant (N+1). Ce chiffre inclut dons, pertes, gachapon, et mélange les salons regroupés dans une même préparation. Vérification : total des sorties par motif ≈ tampons vendus (caisse) + gachapon. (Validé.)
- Nom inconnu vu dans SumUp → « quel article est-ce ? » (article existant, nouvel article d'une famille, ou « ne pas suivre ») ; la réponse est mémorisée dans la correspondance.

## 3. Salons et préparations
- **Tout tourne autour des salons** : pas de stock minimum hors salon.
- Un salon = nom, type, dates, nombre de jours, fréquentation attendue.
- Salons trop rapprochés pour refaire du stock entre eux (écart < seuil, 14 jours par défaut) sont **proposés** dans une même **préparation** ; Séparer / Regrouper à la main, retour possible à la proposition.
- Objectif par article et par salon ; objectif de la préparation = somme ; marge (30 % par défaut) appliquée **une seule fois** par préparation.
- Étapes d'une préparation : Objectifs → Comptage avant → Bilan (ventes carte automatiques + saisie des espèces par article).
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
| Tampon lot | composé au moment de la vente (pas de stock de lots tout faits, validé) : 4 tampons + 1 emballage + 1/45 feuille de stickers ronds (imprimés à la demande) |
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
- Prints : à « C'est fait », on indique quels dessins sont sortis de la feuille (validé).
- Temps réels par étape ; délais fournisseurs.
- Test API SumUp (16/11/2026, 100 transactions, caisse uniquement) : détail des articles **oui** en caisse (transaction complète et reçu identiques) ; **pas d'identifiant** d'article ; catalogue non accessible par l'API (404). Restent inconnus : commandes en ligne, remises, remboursements.
- Nettoyage SumUp (indépendant de l'outil) : article à prix fixe « tampon + encreur » et lots à prix fixes (plus de saisie libre), retirer l'option « Encreur » de la Collection, stocks négatifs à recaler au premier comptage.
