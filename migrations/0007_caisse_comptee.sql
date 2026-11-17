-- Comptage de caisse en fin de salon : nombre de billets et pièces, JSON {"50": 2, "0.5": 7, …} (fond de caisse compris).
ALTER TABLE salon ADD COLUMN caisse_comptee TEXT;
