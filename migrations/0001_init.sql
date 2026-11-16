-- Structure complète décrite dans docs/donnees.md.
-- Le stock d'une pièce = somme de ses mouvements (jamais stocké).

PRAGMA foreign_keys = ON;

-- ───────────── Catalogue et stock ─────────────
CREATE TABLE famille (
  id      INTEGER PRIMARY KEY,
  nom     TEXT NOT NULL UNIQUE,
  ordre   INTEGER NOT NULL DEFAULT 0,
  gabarit TEXT               -- JSON : étapes proposées à la création d'un article
);

CREATE TABLE piece (
  id           INTEGER PRIMARY KEY,
  nom          TEXT NOT NULL,
  famille_id   INTEGER NOT NULL REFERENCES famille(id),
  niveau       TEXT NOT NULL CHECK (niveau IN ('a_vendre','fait_maison','achete','recup')),
  suivi        TEXT NOT NULL DEFAULT 'quantite' CHECK (suivi IN ('quantite','sans_quantite','generique')),
  fin_de_serie INTEGER NOT NULL DEFAULT 0,
  delai_jours  INTEGER,                       -- pièces achetées : délai fournisseur
  mode_achat   TEXT CHECK (mode_achat IN ('quantite','tout_le_disponible','jamais')),
  presque_vide INTEGER NOT NULL DEFAULT 0,    -- pièces « sans quantité » (peinture)
  cree_le      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (famille_id, nom)
);

CREATE TABLE piece_lot (
  id       INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  taille   INTEGER NOT NULL CHECK (taille > 0),
  UNIQUE (piece_id, taille)
);

CREATE TABLE mouvement (
  id          INTEGER PRIMARY KEY,
  piece_id    INTEGER NOT NULL REFERENCES piece(id),
  quantite    INTEGER NOT NULL,
  motif       TEXT NOT NULL CHECK (motif IN ('vente','vente_especes','etape','comptage','reception','remboursement')),
  date        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source_type TEXT,      -- 'vente_ligne', 'etape_faite', 'comptage_ligne', 'commande', 'vente_especes', 'question'
  source_id   INTEGER
);
CREATE INDEX mouvement_piece ON mouvement(piece_id, date);

-- ───────────── Recettes ─────────────
CREATE TABLE etape (
  id         INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  nom        TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('par_matiere','a_la_piece')),
  temps_min  REAL,       -- par pièce ou par matière entière selon le mode
  ordre      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE etape_utilise (
  id       INTEGER PRIMARY KEY,
  etape_id INTEGER NOT NULL REFERENCES etape(id) ON DELETE CASCADE,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  quantite INTEGER NOT NULL CHECK (quantite > 0)
);

-- Sortie simple : piece_id + quantite.
-- Sortie au choix (prints) : au_choix = 1, piece_id NULL, quantite = capacité à répartir (etape_choix).
CREATE TABLE etape_donne (
  id       INTEGER PRIMARY KEY,
  etape_id INTEGER NOT NULL REFERENCES etape(id) ON DELETE CASCADE,
  piece_id INTEGER REFERENCES piece(id),
  quantite INTEGER NOT NULL CHECK (quantite > 0),
  au_choix INTEGER NOT NULL DEFAULT 0,
  CHECK ((au_choix = 0 AND piece_id IS NOT NULL) OR (au_choix = 1 AND piece_id IS NULL))
);

CREATE TABLE etape_choix (
  id             INTEGER PRIMARY KEY,
  etape_donne_id INTEGER NOT NULL REFERENCES etape_donne(id) ON DELETE CASCADE,
  piece_id       INTEGER NOT NULL REFERENCES piece(id),
  poids          INTEGER NOT NULL DEFAULT 1 CHECK (poids > 0),
  UNIQUE (etape_donne_id, piece_id)
);

CREATE TABLE etape_faite (
  id       INTEGER PRIMARY KEY,
  etape_id INTEGER NOT NULL REFERENCES etape(id),
  date     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  note     TEXT
);

-- ───────────── Salons et préparations ─────────────
CREATE TABLE preparation (
  id    INTEGER PRIMARY KEY,
  nom   TEXT,
  mode  TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manuel')),
  marge REAL
);

CREATE TABLE salon (
  id              INTEGER PRIMARY KEY,
  nom             TEXT NOT NULL,
  type            TEXT,
  date_debut      TEXT NOT NULL,     -- AAAA-MM-JJ
  nb_jours        INTEGER NOT NULL DEFAULT 1 CHECK (nb_jours > 0),
  frequentation   INTEGER,
  especes_montant REAL,
  preparation_id  INTEGER REFERENCES preparation(id)
);

CREATE TABLE objectif (
  id             INTEGER PRIMARY KEY,
  preparation_id INTEGER NOT NULL REFERENCES preparation(id) ON DELETE CASCADE,
  salon_id       INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  piece_id       INTEGER NOT NULL REFERENCES piece(id),
  tampons_prevus INTEGER,
  conseille      INTEGER,
  calcul         TEXT,               -- JSON : détail affiché
  retenu         INTEGER,
  UNIQUE (salon_id, piece_id)
);

CREATE TABLE comptage (
  id             INTEGER PRIMARY KEY,
  date           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type           TEXT NOT NULL DEFAULT 'libre' CHECK (type IN ('libre','avant')),
  preparation_id INTEGER REFERENCES preparation(id)
);

CREATE TABLE comptage_ligne (
  id          INTEGER PRIMARY KEY,
  comptage_id INTEGER NOT NULL REFERENCES comptage(id) ON DELETE CASCADE,
  piece_id    INTEGER NOT NULL REFERENCES piece(id),
  attendu     INTEGER NOT NULL,
  compte      INTEGER NOT NULL CHECK (compte >= 0)
);

CREATE TABLE bilan_article (
  salon_id   INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  piece_id   INTEGER NOT NULL REFERENCES piece(id),
  mal_expose INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (salon_id, piece_id)
);

CREATE TABLE vente_especes (
  id       INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  quantite INTEGER NOT NULL CHECK (quantite >= 0),
  UNIQUE (salon_id, piece_id)
);

-- ───────────── Ventes SumUp ─────────────
CREATE TABLE vente (
  id               INTEGER PRIMARY KEY,
  sumup_id         TEXT NOT NULL UNIQUE,
  transaction_code TEXT,
  date             TEXT NOT NULL,
  montant          REAL NOT NULL,
  salon_id         INTEGER REFERENCES salon(id),
  salon_force      INTEGER NOT NULL DEFAULT 0   -- 1 = salon choisi à la main
);

CREATE TABLE vente_ligne (
  id          INTEGER PRIMARY KEY,
  vente_id    INTEGER NOT NULL REFERENCES vente(id) ON DELETE CASCADE,
  nom         TEXT NOT NULL,
  description TEXT,
  cle         TEXT NOT NULL,     -- nom + description nettoyés
  quantite    INTEGER NOT NULL,
  prix        REAL
);
CREATE INDEX vente_ligne_cle ON vente_ligne(cle);

CREATE TABLE correspondance (
  cle                TEXT PRIMARY KEY,
  nom_affiche        TEXT NOT NULL,
  ne_pas_suivre      INTEGER NOT NULL DEFAULT 0,
  equivalent_tampons INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE correspondance_piece (
  cle      TEXT NOT NULL REFERENCES correspondance(cle) ON DELETE CASCADE,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
  PRIMARY KEY (cle, piece_id)
);

CREATE TABLE import_etat (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  depuis       TEXT,      -- date de la plus ancienne transaction encore à traiter
  dernier_id   TEXT,
  maj_le       TEXT
);

CREATE TABLE question (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('vente_impossible','nom_inconnu','remboursement','etape_depasse_stock','especes_a_saisir')),
  piece_id   INTEGER REFERENCES piece(id),
  detail     TEXT,        -- JSON
  cree_le    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reponse    TEXT,
  repondu_le TEXT
);

-- ───────────── Achats ─────────────
CREATE TABLE commande (
  id          INTEGER PRIMARY KEY,
  piece_id    INTEGER NOT NULL REFERENCES piece(id),
  quantite    INTEGER NOT NULL CHECK (quantite > 0),
  taille_lot  INTEGER,
  commande_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  recu_le     TEXT,
  statut      TEXT NOT NULL DEFAULT 'commande' CHECK (statut IN ('commande','recu'))
);

CREATE TABLE achat_ajustement (
  piece_id INTEGER PRIMARY KEY REFERENCES piece(id) ON DELETE CASCADE,
  quantite INTEGER,
  avant_le TEXT
);

-- ───────────── Réglages ─────────────
CREATE TABLE reglage (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

-- Valeurs par défaut de la spec (modifiables dans Réglages).
INSERT INTO reglage (cle, valeur) VALUES
  ('regroupement_auto', '1'),
  ('seuil_jours', '14'),
  ('marge', '0.30'),
  ('marge_unique', '1'),
  ('temps_travail', '1'),
  ('controle_tampons', '1');
