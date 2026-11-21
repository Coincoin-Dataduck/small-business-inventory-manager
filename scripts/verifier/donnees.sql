-- Petites données fictives pour scripts/verifier.sh (aucune donnée réelle).
INSERT INTO famille (nom, ordre) VALUES ('Famille test', 1);
INSERT INTO piece (nom, famille_id, niveau) VALUES
  ('Article test', (SELECT id FROM famille WHERE nom = 'Famille test'), 'a_vendre'),
  ('Article revendu test', (SELECT id FROM famille WHERE nom = 'Famille test'), 'a_vendre'),
  ('Fourniture test', (SELECT id FROM famille WHERE nom = 'Famille test'), 'achete'),
  ('Fourniture maison test', (SELECT id FROM famille WHERE nom = 'Famille test'), 'fait_maison');
INSERT INTO mouvement (piece_id, quantite, motif) SELECT id, 3, 'comptage' FROM piece WHERE nom = 'Article test';
INSERT INTO recette (piece_id, pour) SELECT id, 1 FROM piece WHERE nom = 'Article test';
INSERT INTO recette_element (recette_id, piece_id, quantite)
  SELECT r.id, (SELECT id FROM piece WHERE nom = 'Fourniture maison test'), 1 FROM recette r JOIN piece p ON p.id = r.piece_id WHERE p.nom = 'Article test';
INSERT INTO recette (piece_id, pour) SELECT id, 10 FROM piece WHERE nom = 'Fourniture maison test';
INSERT INTO recette_element (recette_id, piece_id, quantite)
  SELECT r.id, (SELECT id FROM piece WHERE nom = 'Fourniture test'), 1 FROM recette r JOIN piece p ON p.id = r.piece_id WHERE p.nom = 'Fourniture maison test';
INSERT INTO salon (nom, type, date_debut, nb_jours, frequentation) VALUES
  ('Salon passé test', 'Marché', date('now', '-30 day'), 1, 100),
  ('Salon à venir test', 'Marché', date('now', '+10 day'), 2, 100);
