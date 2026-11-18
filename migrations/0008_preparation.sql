-- Décision du 18/11/2026 : plus de suivi des étapes de fabrication.
-- Une recette dit « ce qu'il faut pour en faire » : pour en faire `pour` (1 pour un article ; 25 planchettes par plaque…),
-- il faut telles fournitures. Les anciennes tables (recette_etape, etape…) restent pour l'historique mais ne servent plus.
CREATE TABLE recette (
  id             INTEGER PRIMARY KEY,
  piece_id       INTEGER REFERENCES piece(id),     -- un article ou une fourniture maison précise
  produit_id     INTEGER REFERENCES produit(id),   -- un produit : vaut pour chacune de ses variantes
  famille_id     INTEGER REFERENCES famille(id),   -- toute une famille pour une variante (« tous les prints A5 »)
  variante       TEXT,
  pour           INTEGER CHECK (pour IS NULL OR pour > 0),  -- NULL = rendement inconnu (demandé à la première production)
  CHECK ((piece_id IS NOT NULL) + (produit_id IS NOT NULL) + (famille_id IS NOT NULL) = 1),
  CHECK ((famille_id IS NULL) = (variante IS NULL))
);
CREATE UNIQUE INDEX recette_piece ON recette(piece_id) WHERE piece_id IS NOT NULL;
CREATE UNIQUE INDEX recette_produit ON recette(produit_id) WHERE produit_id IS NOT NULL;
CREATE UNIQUE INDEX recette_famille ON recette(famille_id, variante) WHERE famille_id IS NOT NULL;
CREATE TABLE recette_element (
  id         INTEGER PRIMARY KEY,
  recette_id INTEGER NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  piece_id   INTEGER REFERENCES piece(id),
  produit_id INTEGER REFERENCES produit(id),        -- « de la même variante » (planchette du même modèle, carton du même format)
  quantite   REAL NOT NULL CHECK (quantite > 0),    -- décimale = partagée (¼ de feuille A3 par print A5 : les formats se mélangent)
  CHECK ((piece_id IS NULL) <> (produit_id IS NULL))
);
-- Seuil d'alerte d'une fourniture achetée : en dessous, « à vérifier ».
ALTER TABLE piece ADD COLUMN seuil INTEGER;
-- Préparation (identifiée par son premier salon) : ce qu'on décide de produire, ce qu'on a vérifié, ce qu'on a produit.
CREATE TABLE prep_production (
  prep_id    INTEGER NOT NULL,
  piece_id   INTEGER NOT NULL REFERENCES piece(id),
  a_produire INTEGER NOT NULL CHECK (a_produire >= 0),
  PRIMARY KEY (prep_id, piece_id)
);
CREATE TABLE prep_verif (
  prep_id  INTEGER NOT NULL,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  quantite INTEGER,                                 -- ce qu'on a trouvé (NULL : sans quantité, « il en reste »)
  le       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (prep_id, piece_id)
);
CREATE TABLE prep_fait (
  id       INTEGER PRIMARY KEY,
  prep_id  INTEGER NOT NULL,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  sens     TEXT NOT NULL CHECK (sens IN ('produit','utilise')),  -- produit : ajouté au stock ; utilise : feuilles partagées utilisées
  quantite INTEGER NOT NULL CHECK (quantite >= 0),
  le       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (prep_id, piece_id)
);
