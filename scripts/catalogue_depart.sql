-- Catalogue de départ d'après docs/spec.md §6 (sans les prints ni les articles en fin de série,
-- créés depuis les questions SumUp). Aucune quantité, aucune recette. Rejouable sans doublon.
-- Usage : npx wrangler d1 execute stock-hervine --remote --file scripts/catalogue_depart.sql

INSERT OR IGNORE INTO famille (nom, ordre) VALUES
  ('Mini-presses', 1), ('Tampons', 2), ('Prints', 3), ('Kits', 4), ('Canards', 5),
  ('Scarabées', 6), ('Carnets', 7), ('Encreurs', 8), ('Fournitures communes', 9);

-- (famille, nom, niveau, suivi)
INSERT OR IGNORE INTO piece (nom, famille_id, niveau, suivi)
  SELECT v.column2, f.id, v.column3, v.column4 FROM (VALUES
  -- Mini-presses
  ('Mini-presses', 'Mini-presse Baba Yaga', 'a_vendre', 'quantite'),
  ('Mini-presses', 'Mini-presse Crâne', 'a_vendre', 'quantite'),
  ('Mini-presses', 'Mini-presse Grenouille', 'a_vendre', 'quantite'),
  ('Mini-presses', 'Mini-presse Sauge', 'a_vendre', 'quantite'),
  ('Mini-presses', 'Mini-presse Timbre', 'a_vendre', 'quantite'),
  ('Mini-presses', 'Planchette Baba Yaga', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Planchette Crâne', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Planchette Grenouille', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Planchette Sauge', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Planchette Timbre', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Bande de buvard', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Carton de presse', 'fait_maison', 'quantite'),
  ('Mini-presses', 'Feuille de buvard Canson', 'achete', 'quantite'),
  ('Mini-presses', 'Élastique', 'achete', 'quantite'),
  ('Mini-presses', 'Planche de carton', 'recup', 'quantite'),
  -- Tampons
  ('Tampons', 'Tampon (caisse)', 'a_vendre', 'generique'),
  ('Tampons', 'Tampon Miaou', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Coin', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Wouf', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Bulle cœur', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Grenouille magicienne sommeil', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Grenouille café', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Grenouille cœur', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Grenouille magicienne', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Grenouille qui tire la langue', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Canard « … »', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Canard blasé', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Canard-cœur', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Honk', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Patte', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Yeux ronds', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Tête chat blanc', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Arrière chat blanc', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Tête corgi', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Arrière corgi', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Tête chat noir', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Arrière chat noir', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Tête teckel', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Arrière teckel', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Corps blanc', 'a_vendre', 'quantite'),
  ('Tampons', 'Tampon Corps noir', 'a_vendre', 'quantite'),
  ('Tampons', 'Gomme gravée', 'fait_maison', 'quantite'),
  ('Tampons', 'Sticker rond', 'fait_maison', 'quantite'),
  ('Tampons', 'Feuille de gomme A4', 'achete', 'quantite'),
  ('Tampons', 'Cube en bois', 'achete', 'quantite'),
  ('Tampons', 'Emballage lot', 'achete', 'quantite'),
  ('Tampons', 'Feuille de stickers à imprimer', 'achete', 'quantite'),
  -- Prints (les articles se créent depuis les questions)
  ('Prints', 'Feuille print A3', 'achete', 'quantite'),
  ('Prints', 'Carton A5', 'achete', 'quantite'),
  ('Prints', 'Carton A4', 'achete', 'quantite'),
  ('Prints', 'Carton A3', 'achete', 'quantite'),
  ('Prints', 'Pochette A5', 'achete', 'quantite'),
  ('Prints', 'Pochette A4', 'achete', 'quantite'),
  ('Prints', 'Pochette A3', 'achete', 'quantite'),
  -- Kits
  ('Kits', 'Kit Maison', 'a_vendre', 'quantite'),
  ('Kits', 'Kit Serre', 'a_vendre', 'quantite'),
  ('Kits', 'Jeu de planchettes Maison', 'fait_maison', 'quantite'),
  ('Kits', 'Jeu de planchettes Serre', 'fait_maison', 'quantite'),
  ('Kits', 'Livret Maison', 'fait_maison', 'quantite'),
  ('Kits', 'Livret Serre', 'fait_maison', 'quantite'),
  ('Kits', 'Pochette de kit', 'fait_maison', 'quantite'),
  ('Kits', 'Feuille kraft A4', 'achete', 'quantite'),
  ('Kits', 'Feuille A3 pour pochette', 'achete', 'quantite'),
  ('Kits', 'Boîtier de pile', 'achete', 'quantite'),
  ('Kits', 'Pile CR2032', 'achete', 'quantite'),
  ('Kits', 'Mini LED', 'achete', 'quantite'),
  -- Canards
  ('Canards', 'Canard de poche', 'a_vendre', 'quantite'),
  ('Canards', 'Canard découpé', 'fait_maison', 'quantite'),
  ('Canards', 'Cartonnette', 'fait_maison', 'quantite'),
  ('Canards', 'Feuille pour cartonnettes', 'achete', 'quantite'),
  ('Canards', 'Attache', 'achete', 'quantite'),
  ('Canards', 'Pochette plastique', 'achete', 'quantite'),
  -- Scarabées
  ('Scarabées', 'Scarabée', 'a_vendre', 'quantite'),
  ('Scarabées', 'Jeu scarabée', 'fait_maison', 'quantite'),
  ('Scarabées', 'Cerclage', 'fait_maison', 'quantite'),
  ('Scarabées', 'Papier print A4', 'achete', 'quantite'),
  -- Carnets
  ('Carnets', 'Carnet', 'a_vendre', 'quantite'),
  ('Carnets', 'Carnet vierge', 'achete', 'quantite'),
  -- Encreurs
  ('Encreurs', 'Encreur VersaFine', 'a_vendre', 'quantite'),
  -- Fournitures communes
  ('Fournitures communes', 'Plaque MDF A3', 'achete', 'quantite'),
  ('Fournitures communes', 'Contreplaqué A3', 'achete', 'quantite'),
  ('Fournitures communes', 'Peinture orange', 'achete', 'sans_quantite'),
  ('Fournitures communes', 'Peinture noire', 'achete', 'sans_quantite'),
  ('Fournitures communes', 'Peinture vert clair', 'achete', 'sans_quantite'),
  ('Fournitures communes', 'Peinture vert foncé', 'achete', 'sans_quantite'),
  ('Fournitures communes', 'Peinture bleue', 'achete', 'sans_quantite'),
  ('Fournitures communes', 'Peinture blanche', 'achete', 'sans_quantite'),
  ('Fournitures communes', 'Peinture vert brillant Lefranc Bourgeois', 'achete', 'sans_quantite')
  ) AS v JOIN famille f ON f.nom = v.column1;

UPDATE piece SET mode_achat = 'jamais' WHERE nom = 'Planche de carton';

-- Tailles de lot connues (spec §6).
INSERT OR IGNORE INTO piece_lot (piece_id, taille)
  SELECT p.id, v.column2 FROM (VALUES ('Contreplaqué A3', 30), ('Contreplaqué A3', 80), ('Contreplaqué A3', 160),
    ('Feuille de buvard Canson', 12), ('Cube en bois', 90), ('Emballage lot', 50), ('Boîtier de pile', 10), ('Mini LED', 10)) AS v
  JOIN piece p ON p.nom = v.column1;
