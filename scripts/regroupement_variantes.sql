-- Regroupement du catalogue en produits à variantes (validé par Clément le 17/11/2026).
-- À appliquer une fois, après la migration 0004. Conserve les identifiants : stock, historique et correspondances restent.

-- 1. Fusions : la source disparaît, tout ce qui la référence passe sur la cible.
--    Plouf- Print Fine Art A4 → Piou plouf A4 ; Plouf- Print Fine Art A5 → Piou plouf A5 ; Carnet (famille Carnets) → Carnet (Mini-presses).
CREATE TABLE IF NOT EXISTS _fusion (source INTEGER PRIMARY KEY, cible INTEGER NOT NULL);
DELETE FROM _fusion;
INSERT INTO _fusion (source, cible)
SELECT s.id, c.id FROM piece s JOIN piece c ON s.nom = 'Plouf- Print Fine Art A4' AND c.nom = 'Piou plouf A4'
UNION ALL SELECT s.id, c.id FROM piece s JOIN piece c ON s.nom = 'Plouf- Print Fine Art A5' AND c.nom = 'Piou plouf A5'
UNION ALL SELECT s.id, c.id FROM piece s JOIN famille fs ON fs.id = s.famille_id AND fs.nom = 'Carnets'
  JOIN piece c ON c.nom = 'Carnet' JOIN famille fc ON fc.id = c.famille_id AND fc.nom = 'Mini-presses' WHERE s.nom = 'Carnet';

UPDATE mouvement SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE OR IGNORE piece_lot SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE etape_utilise SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE etape_donne SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE OR IGNORE etape_choix SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE OR IGNORE objectif SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE comptage_ligne SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE OR IGNORE bilan_article SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE OR IGNORE correspondance_piece SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE question SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE commande SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
UPDATE OR IGNORE achat_ajustement SET piece_id = (SELECT cible FROM _fusion WHERE source = piece_id) WHERE piece_id IN (SELECT source FROM _fusion);
-- Doublons restés sur la source (déjà présents sur la cible) : on garde ceux de la cible.
DELETE FROM piece_lot WHERE piece_id IN (SELECT source FROM _fusion);
DELETE FROM etape_choix WHERE piece_id IN (SELECT source FROM _fusion);
DELETE FROM objectif WHERE piece_id IN (SELECT source FROM _fusion);
DELETE FROM bilan_article WHERE piece_id IN (SELECT source FROM _fusion);
DELETE FROM correspondance_piece WHERE piece_id IN (SELECT source FROM _fusion);
DELETE FROM achat_ajustement WHERE piece_id IN (SELECT source FROM _fusion);
DELETE FROM piece WHERE id IN (SELECT source FROM _fusion);
DROP TABLE _fusion;

-- 2. Rangements et noms.
UPDATE piece SET famille_id = (SELECT id FROM famille WHERE nom = 'Prints') WHERE nom = 'L’ombre A5';
UPDATE piece SET famille_id = (SELECT id FROM famille WHERE nom = 'Mini-presses')
  WHERE nom = 'Carnet vierge' AND famille_id = (SELECT id FROM famille WHERE nom = 'Carnets');
DELETE FROM famille WHERE nom = 'Carnets' AND NOT EXISTS (SELECT 1 FROM piece p WHERE p.famille_id = famille.id);
UPDATE famille SET nom = 'Pins' WHERE nom = 'Canards';
UPDATE piece SET nom = 'La salamandre A3' WHERE nom = 'Print Salamandre A3';
UPDATE piece SET nom = 'Les Corgis fantômes A3' WHERE nom = 'Corgi Fantome A3';
UPDATE piece SET nom = 'Les Corgis fantômes A5' WHERE nom = 'Les Corgis fantome A5';

-- 3. Produits à variantes.
-- Prints : « <motif> A3|A4|A5 » (prints à vendre, cartons, pochettes, feuilles).
INSERT OR IGNORE INTO produit (famille_id, nom)
  SELECT DISTINCT famille_id, substr(nom, 1, length(nom) - 3) FROM piece
  WHERE famille_id = (SELECT id FROM famille WHERE nom = 'Prints') AND nom GLOB '* A[345]';
UPDATE piece SET produit_id = (SELECT pr.id FROM produit pr WHERE pr.famille_id = piece.famille_id AND pr.nom = substr(piece.nom, 1, length(piece.nom) - 3)),
  variante = substr(nom, -2)
  WHERE famille_id = (SELECT id FROM famille WHERE nom = 'Prints') AND nom GLOB '* A[345]';
UPDATE famille SET variantes = '["A3","A4","A5"]' WHERE nom = 'Prints';

-- Préfixes : Tampon <petit nom>, Mini-presse <motif>, Planchette <motif>, Peinture <couleur>.
CREATE TABLE IF NOT EXISTS _prefixe (famille TEXT, prefixe TEXT);
DELETE FROM _prefixe;
INSERT INTO _prefixe VALUES ('Tampons', 'Tampon'), ('Mini-presses', 'Mini-presse'), ('Mini-presses', 'Planchette'), ('Fournitures communes', 'Peinture');
INSERT OR IGNORE INTO produit (famille_id, nom)
  SELECT DISTINCT p.famille_id, x.prefixe FROM piece p JOIN famille f ON f.id = p.famille_id JOIN _prefixe x ON x.famille = f.nom
  WHERE p.nom LIKE x.prefixe || ' %' AND p.produit_id IS NULL AND (x.prefixe <> 'Tampon' OR p.niveau = 'a_vendre');
UPDATE piece SET
  produit_id = (SELECT pr.id FROM produit pr JOIN famille f ON f.id = pr.famille_id JOIN _prefixe x ON x.famille = f.nom AND x.prefixe = pr.nom
                WHERE pr.famille_id = piece.famille_id AND piece.nom LIKE pr.nom || ' %'),
  variante = (SELECT substr(piece.nom, length(pr.nom) + 2) FROM produit pr JOIN famille f ON f.id = pr.famille_id JOIN _prefixe x ON x.famille = f.nom AND x.prefixe = pr.nom
              WHERE pr.famille_id = piece.famille_id AND piece.nom LIKE pr.nom || ' %')
  WHERE produit_id IS NULL AND (niveau = 'a_vendre' OR famille_id <> (SELECT id FROM famille WHERE nom = 'Tampons'))
    AND EXISTS (SELECT 1 FROM produit pr JOIN famille f ON f.id = pr.famille_id JOIN _prefixe x ON x.famille = f.nom AND x.prefixe = pr.nom
                WHERE pr.famille_id = piece.famille_id AND piece.nom LIKE pr.nom || ' %');
DROP TABLE _prefixe;

-- Kits : « <produit> Maison|Serre ».
INSERT OR IGNORE INTO produit (famille_id, nom)
  SELECT DISTINCT famille_id, CASE WHEN nom LIKE '% Maison' THEN substr(nom, 1, length(nom) - 7) ELSE substr(nom, 1, length(nom) - 6) END
  FROM piece WHERE famille_id = (SELECT id FROM famille WHERE nom = 'Kits') AND (nom LIKE '% Maison' OR nom LIKE '% Serre');
UPDATE piece SET
  produit_id = (SELECT pr.id FROM produit pr WHERE pr.famille_id = piece.famille_id
                AND pr.nom = CASE WHEN piece.nom LIKE '% Maison' THEN substr(piece.nom, 1, length(piece.nom) - 7) ELSE substr(piece.nom, 1, length(piece.nom) - 6) END),
  variante = CASE WHEN nom LIKE '% Maison' THEN 'Maison' ELSE 'Serre' END
  WHERE famille_id = (SELECT id FROM famille WHERE nom = 'Kits') AND (nom LIKE '% Maison' OR nom LIKE '% Serre');
UPDATE famille SET variantes = '["Maison","Serre"]' WHERE nom = 'Kits';
