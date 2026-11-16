-- Rétro-planning de la préparation en cours (écran Accueil).
-- Jalons standards : une ligne seulement si la date a été déplacée (sinon date par défaut calculée).
-- Jalons « perso » : ajoutés à la main (nom, date, fait).
CREATE TABLE jalon (
  id       INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,  -- premier salon de la préparation
  type     TEXT NOT NULL CHECK (type IN ('objectifs','commandes','fabrication_debut','fabrication_fin','comptage','bilan','perso')),
  nom      TEXT,
  date     TEXT NOT NULL,          -- AAAA-MM-JJ
  fait     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX jalon_standard ON jalon(salon_id, type) WHERE type <> 'perso';
