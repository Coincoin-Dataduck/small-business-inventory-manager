-- Encreurs (validé par Clément le 17/11/2026) : la caisse ne précise pas la couleur, comme pour les tampons.
-- Le stock se suit par couleur, avec le nom écrit sur l'encreur (mini VersaFine) ; les ventes ne décomptent aucune couleur,
-- c'est le comptage qui recale. À appliquer une fois, après la migration 0005.

-- La famille Tampons reste le thermomètre (réglage explicite, puisque deux familles auront « modèle non précisé »).
INSERT OR IGNORE INTO reglage (cle, valeur) SELECT 'famille_thermometre', CAST(id AS TEXT) FROM famille WHERE nom = 'Tampons';
UPDATE famille SET modele_non_precise = 1, variantes = '["Crimson Red","Onyx Black","Majestic Blue","Deep Lagoon","Olympia Green","Imperial Purple","Habanero","Vintage Sepia","Spanish Moss"]'
  WHERE nom = 'Encreurs';

-- Les noms de caisse reliés à l'ancien « Encreur VersaFine » passent sur « Encreurs, couleur non précisée ».
INSERT OR IGNORE INTO correspondance_famille (cle, famille_id, quantite)
  SELECT cp.cle, (SELECT id FROM famille WHERE nom = 'Encreurs'), cp.quantite
  FROM correspondance_piece cp WHERE cp.piece_id = (SELECT id FROM piece WHERE nom = 'Encreur VersaFine' AND produit_id IS NULL);
DELETE FROM correspondance_piece WHERE piece_id = (SELECT id FROM piece WHERE nom = 'Encreur VersaFine' AND produit_id IS NULL);

-- L'ancien article sans couleur : retiré s'il a été vendu (gardé pour les bilans), sinon supprimé.
CREATE TABLE IF NOT EXISTS _ancien (id INTEGER PRIMARY KEY, vendu INTEGER);
DELETE FROM _ancien;
INSERT INTO _ancien SELECT id, EXISTS (SELECT 1 FROM mouvement m WHERE m.piece_id = piece.id AND m.motif IN ('vente', 'vente_especes'))
  FROM piece WHERE nom = 'Encreur VersaFine' AND produit_id IS NULL;
DELETE FROM objectif WHERE piece_id IN (SELECT id FROM _ancien) AND salon_id IN (SELECT id FROM salon WHERE date_debut >= date('now'));
DELETE FROM etape_utilise WHERE piece_id IN (SELECT id FROM _ancien);
DELETE FROM etape_choix WHERE piece_id IN (SELECT id FROM _ancien);
DELETE FROM etape_donne WHERE piece_id IN (SELECT id FROM _ancien);
UPDATE piece SET retire = 1, nom = 'Encreur VersaFine (ancien, sans couleur)' WHERE id IN (SELECT id FROM _ancien WHERE vendu = 1);
DELETE FROM mouvement WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM comptage_ligne WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM objectif WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM bilan_article WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM question WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM commande WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM achat_ajustement WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM piece_lot WHERE piece_id IN (SELECT id FROM _ancien WHERE vendu = 0);
DELETE FROM piece WHERE id IN (SELECT id FROM _ancien WHERE vendu = 0);
DROP TABLE _ancien;

-- Le produit et ses 9 couleurs.
INSERT OR IGNORE INTO produit (famille_id, nom) SELECT id, 'Encreur VersaFine' FROM famille WHERE nom = 'Encreurs';
INSERT OR IGNORE INTO piece (nom, famille_id, niveau, suivi, produit_id, variante)
  SELECT 'Encreur VersaFine ' || v.value, pr.famille_id, 'a_vendre', 'quantite', pr.id, v.value
  FROM produit pr JOIN famille f ON f.id = pr.famille_id AND f.nom = 'Encreurs', json_each(f.variantes) v
  WHERE pr.nom = 'Encreur VersaFine';
