-- Recettes « ce qu'il faut pour en faire » (décision du 18/11/2026), d'après la spec §6 et les réponses de Clément.
-- Appliqué une fois en prod, après la migration 0008. Identifiants = ceux de la base de prod au 18/11/2026.

-- Anciennes étapes (aucune n'a jamais été marquée « faite ») : vidées.
DELETE FROM etape_choix; DELETE FROM etape_utilise; DELETE FROM etape_donne; DELETE FROM etape;
DELETE FROM recette_format; DELETE FROM recette_ligne; DELETE FROM recette_etape;

-- « Planche de MDF A3 » : doublon de « Plaque MDF A3 » (fourniture commune), jamais vendu : supprimé.
DELETE FROM mouvement WHERE piece_id = 120;
DELETE FROM comptage_ligne WHERE piece_id = 120;
DELETE FROM piece_lot WHERE piece_id = 120;
DELETE FROM piece WHERE id = 120;
-- Intermédiaires du modèle par étapes, sans stock ni historique : plus utiles.
-- 130 Planche de MDF peinte, 42 Gomme gravée, 132 Cube gravé, 133 Planche de contreplaquée peinte, 147 Tirage A3.
DELETE FROM piece WHERE id IN (130, 42, 132, 133, 147)
  AND NOT EXISTS (SELECT 1 FROM mouvement m WHERE m.piece_id = piece.id);

-- Gomme : une feuille s'entame par morceaux → pas de quantité, « vérifier qu'il en reste ».
UPDATE piece SET suivi = 'sans_quantite' WHERE id = 44;

-- Kits : la lampe soudée (boîtier + pile + LED), épinglée dans le livret.
INSERT INTO piece (nom, famille_id, niveau, suivi) VALUES ('Lampe', 4, 'fait_maison', 'quantite');

-- Recettes. pour = combien on en fait avec les quantités indiquées (1 pour un article).
INSERT INTO recette (piece_id, produit_id, famille_id, variante, pour) VALUES
  (92,   NULL, NULL, NULL, 1),   -- 1  Carnet
  (NULL, 17,   NULL, NULL, 1),   -- 2  Mini-presse (toutes)
  (NULL, 18,   NULL, NULL, 25),  -- 3  Planchette : 25 par plaque (une plaque = un modèle)
  (11,   NULL, NULL, NULL, 3),   -- 4  Bande de buvard : 3 par feuille
  (12,   NULL, NULL, NULL, 2),   -- 5  Carton de presse : 2 par planche
  (NULL, 19,   NULL, NULL, 1),   -- 6  Tampon (tous)
  (43,   NULL, NULL, NULL, 45),  -- 7  Sticker rond : 45 par feuille
  (NULL, NULL, 3,    'A3', 1),   -- 8  Tous les prints A3
  (NULL, NULL, 3,    'A4', 1),   -- 9  Tous les prints A4
  (NULL, NULL, 3,    'A5', 1),   -- 10 Tous les prints A5
  (NULL, 22,   NULL, NULL, 1),   -- 11 Kit (Maison, Serre)
  (NULL, 21,   NULL, NULL, 1),   -- 12 Jeu de planchettes : 1 contreplaqué
  (NULL, 23,   NULL, NULL, 1),   -- 13 Livret : 1 feuille kraft
  ((SELECT id FROM piece WHERE nom = 'Lampe' AND famille_id = 4), NULL, NULL, NULL, 1), -- 14 Lampe
  (61,   NULL, NULL, NULL, 1),   -- 15 Pochette de kit : 1 feuille A3
  (73,   NULL, NULL, NULL, 1),   -- 16 Scarabée
  (74,   NULL, NULL, NULL, 16),  -- 17 Jeu scarabée : 4 contreplaqués → 16 jeux
  (75,   NULL, NULL, NULL, 5),   -- 18 Cerclage : 5 par feuille A4 (imprimée puis découpée au plotter)
  (67,   NULL, NULL, NULL, 1),   -- 19 Canard de poche
  (68,   NULL, NULL, NULL, 50),  -- 20 Canard découpé : ~50 par plaque MDF
  (69,   NULL, NULL, NULL, NULL);-- 21 Cartonnette : rendement inconnu

INSERT INTO recette_element (recette_id, piece_id, produit_id, quantite)
SELECT r.id, json_extract(x.value, '$[1]'), json_extract(x.value, '$[2]'), json_extract(x.value, '$[3]')
FROM recette r JOIN json_each('[
  ["p92", 78, null, 1],
  ["r17", null, 18, 2],
  ["r17", 11, null, 3],
  ["r17", 12, null, 2],
  ["r17", 14, null, 2],
  ["r17", 131, null, 1],
  ["r18", 80, null, 1],
  ["p11", 13, null, 1],
  ["p12", 15, null, 1],
  ["r19", 45, null, 1],
  ["r19", 44, null, 1],
  ["p43", 47, null, 1],
  ["fA3", 48, null, 1],
  ["fA3", null, 2, 1],
  ["fA3", null, 13, 1],
  ["fA4", 48, null, 0.5],
  ["fA4", null, 2, 1],
  ["fA4", null, 13, 1],
  ["fA5", 48, null, 0.25],
  ["fA5", null, 2, 1],
  ["fA5", null, 13, 1],
  ["r22", null, 21, 1],
  ["r22", null, 23, 1],
  ["r22", 61, null, 1],
  ["r22", 43, null, 1],
  ["r21", 81, null, 1],
  ["r23", 62, null, 1],
  ["lampe", 64, null, 1],
  ["lampe", 65, null, 1],
  ["lampe", 66, null, 1],
  ["p61", 63, null, 1],
  ["p73", 74, null, 1],
  ["p73", 75, null, 1],
  ["p74", 81, null, 4],
  ["p75", 76, null, 1],
  ["p67", 68, null, 1],
  ["p67", 69, null, 1],
  ["p67", 71, null, 1],
  ["p67", 72, null, 1],
  ["p68", 80, null, 1],
  ["p69", 70, null, 1]
]') x ON json_extract(x.value, '$[0]') = CASE
  WHEN r.famille_id IS NOT NULL THEN 'f' || r.variante
  WHEN r.produit_id IS NOT NULL THEN 'r' || r.produit_id
  WHEN r.piece_id = (SELECT id FROM piece WHERE nom = 'Lampe' AND famille_id = 4) THEN 'lampe'
  ELSE 'p' || r.piece_id END;
-- [clé de la recette, fourniture, produit « même variante », quantité]
-- La lampe dans le kit (la Lampe créée plus haut).
INSERT INTO recette_element (recette_id, piece_id, quantite)
SELECT id, (SELECT id FROM piece WHERE nom = 'Lampe' AND famille_id = 4), 1 FROM recette WHERE produit_id = 22;

-- Salons passés (docs/historique-salons.md), pour que le conseil s'appuie sur tout l'historique et pas seulement Art2Play.
-- Les ventes carte s'y rattachent par la date ; rien ne change dans le stock.
INSERT INTO salon (nom, type, date_debut, nb_jours, frequentation) VALUES
  ('Marché de Noël de Lucas', 'Marché', '2025-12-11', 1, 200),
  ('Festival de jeux de société', 'Festival', '2026-05-08', 3, 35000),
  ('Petit festival de musique', 'Festival', '2026-05-31', 1, 800),
  ('Marchés d''été du camping', 'Marché', '2026-07-07', 50, 900);
