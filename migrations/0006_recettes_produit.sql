-- Recettes écrites par produit (valables pour toutes ses variantes), par article simple, ou communes à une famille
-- (prints : une feuille donne au choix 1 A3, 2 A4 ou 4 A5). L'outil en génère les étapes concrètes (table etape),
-- une par variante : l'Atelier et « C'est fait » continuent de travailler sur ces étapes.
CREATE TABLE recette_etape (
  id         INTEGER PRIMARY KEY,
  famille_id INTEGER NOT NULL REFERENCES famille(id),
  produit_id INTEGER REFERENCES produit(id),  -- recette d'un produit : vaut pour chaque variante
  piece_id   INTEGER REFERENCES piece(id),    -- recette d'un article simple
  commune    INTEGER NOT NULL DEFAULT 0,      -- recette commune à la famille (sortie au choix par variante)
  ordre      INTEGER NOT NULL DEFAULT 0,
  nom        TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('par_matiere','a_la_piece')),
  temps_min  REAL
);
CREATE TABLE recette_ligne (
  id               INTEGER PRIMARY KEY,
  recette_etape_id INTEGER NOT NULL REFERENCES recette_etape(id) ON DELETE CASCADE,
  sens             TEXT NOT NULL CHECK (sens IN ('utilise','donne')),
  piece_id         INTEGER REFERENCES piece(id),
  produit_id       INTEGER REFERENCES produit(id),  -- « <produit> de la même variante »
  quantite         INTEGER NOT NULL CHECK (quantite > 0),
  CHECK ((piece_id IS NULL) <> (produit_id IS NULL))
);
-- Recette commune : en une fois, combien de chaque variante (au choix).
CREATE TABLE recette_format (
  recette_etape_id INTEGER NOT NULL REFERENCES recette_etape(id) ON DELETE CASCADE,
  variante         TEXT NOT NULL,
  quantite         INTEGER NOT NULL CHECK (quantite > 0),
  PRIMARY KEY (recette_etape_id, variante)
);
ALTER TABLE etape ADD COLUMN recette_etape_id INTEGER REFERENCES recette_etape(id);
ALTER TABLE etape ADD COLUMN pour_piece_id INTEGER;  -- variante (ou article) visée ; 0 pour une recette commune
