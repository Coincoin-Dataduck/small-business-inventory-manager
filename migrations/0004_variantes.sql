-- Produits à variantes : un produit (ex. « La salamandre ») regroupe des variantes (A3, A4, A5),
-- chacune étant une ligne de stock (piece) suivie et comptée à part. Le nom complet de la variante
-- reste dans piece.nom (« La salamandre A4 ») pour que tout le reste de l'outil continue d'y lire son nom.
CREATE TABLE produit (
  id         INTEGER PRIMARY KEY,
  famille_id INTEGER NOT NULL REFERENCES famille(id),
  nom        TEXT NOT NULL,
  UNIQUE (famille_id, nom)
);
ALTER TABLE piece ADD COLUMN produit_id INTEGER REFERENCES produit(id);
ALTER TABLE piece ADD COLUMN variante TEXT;
-- Variantes proposées par défaut à la création d'un produit de la famille (JSON, ex. ["A3","A4","A5"]).
ALTER TABLE famille ADD COLUMN variantes TEXT;
