-- Familles dont la caisse ne précise pas le modèle (ex. Tampons : « Tampon unité », sans motif).
-- Un nom de caisse peut être relié à une telle famille (« Tampons, modèle non précisé » × 4)
-- au lieu d'un article ; c'est ce qui compte les tampons vendus (thermomètre). Pas d'effet sur le stock :
-- chaque motif se suit par les comptages. Remplace l'ancien article « générique ».

ALTER TABLE famille ADD COLUMN modele_non_precise INTEGER NOT NULL DEFAULT 0;

CREATE TABLE correspondance_famille (
  cle        TEXT NOT NULL REFERENCES correspondance(cle) ON DELETE CASCADE,
  famille_id INTEGER NOT NULL REFERENCES famille(id),
  quantite   INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
  PRIMARY KEY (cle, famille_id)
);

-- Reprise : les liens vers un article générique deviennent des liens vers sa famille.
INSERT OR IGNORE INTO correspondance_famille (cle, famille_id, quantite)
  SELECT cp.cle, p.famille_id, cp.quantite FROM correspondance_piece cp JOIN piece p ON p.id = cp.piece_id WHERE p.suivi = 'generique';
UPDATE famille SET modele_non_precise = 1 WHERE id IN (SELECT famille_id FROM piece WHERE suivi = 'generique');
DELETE FROM correspondance_piece WHERE piece_id IN (SELECT id FROM piece WHERE suivi = 'generique');

-- Thermomètre : désigné par une famille.
INSERT OR IGNORE INTO reglage (cle, valeur)
  SELECT 'famille_thermometre', p.famille_id FROM reglage r JOIN piece p ON p.id = CAST(r.valeur AS INTEGER) WHERE r.cle = 'article_thermometre';
DELETE FROM reglage WHERE cle = 'article_thermometre';

-- Les articles génériques disparaissent (s'ils ne sont référencés nulle part ailleurs).
DELETE FROM piece WHERE suivi = 'generique'
  AND NOT EXISTS (SELECT 1 FROM mouvement m WHERE m.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM etape_utilise x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM etape_donne x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM etape_choix x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM objectif x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM bilan_article x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM commande x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM question x WHERE x.piece_id = piece.id)
  AND NOT EXISTS (SELECT 1 FROM correspondance_piece x WHERE x.piece_id = piece.id);
DELETE FROM piece_lot WHERE piece_id NOT IN (SELECT id FROM piece);
DELETE FROM achat_ajustement WHERE piece_id NOT IN (SELECT id FROM piece);
