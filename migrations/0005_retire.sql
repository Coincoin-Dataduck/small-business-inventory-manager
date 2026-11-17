-- Article retiré : déjà vendu, donc gardé pour l'historique (bilans), mais absent du stock, du comptage et des calculs.
ALTER TABLE piece ADD COLUMN retire INTEGER NOT NULL DEFAULT 0;
