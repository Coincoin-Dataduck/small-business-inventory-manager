import { HTTPException } from "hono/http-exception";

export type Env = { DB: D1Database; SUMUP_API_KEY?: string };

export const NIVEAUX = ["a_vendre", "fait_maison", "achete", "recup"] as const;
export const SUIVIS = ["quantite", "sans_quantite", "generique"] as const;

// Stock d'une pièce = somme de ses mouvements (voir docs/donnees.md).
export const STOCK_SQL = "(SELECT COALESCE(SUM(m.quantite), 0) FROM mouvement m WHERE m.piece_id = p.id)";

export function erreur(message: string, status: 400 | 404 | 409 = 400): never {
  throw new HTTPException(status, { message });
}

export function texte(v: unknown, champ: string): string {
  if (typeof v !== "string" || !v.trim()) erreur(`« ${champ} » est obligatoire.`);
  return v.trim();
}

export function entier(v: unknown, champ: string, min = 0): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) erreur(`« ${champ} » doit être un nombre entier ≥ ${min}.`);
  return n;
}

export function choix<T extends string>(v: unknown, permis: readonly T[], champ: string): T {
  if (!permis.includes(v as T)) erreur(`« ${champ} » invalide.`);
  return v as T;
}

export async function corps(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {}
  erreur("Données reçues illisibles.");
}


export type LigneComptage = { piece_id: number; compte: number };

export function lireLignesComptage(v: unknown): LigneComptage[] {
  if (!Array.isArray(v)) erreur("Liste de comptage invalide.");
  const lignes = v.map((l: Record<string, unknown>) => ({
    piece_id: entier(l?.piece_id, "pièce", 1),
    compte: entier(l?.compte, "quantité comptée", 0),
  }));
  if (new Set(lignes.map((l) => l.piece_id)).size !== lignes.length) erreur("Une pièce apparaît deux fois dans le comptage.");
  return lignes;
}

/** Pièces demandées, avec leur suivi et leur stock actuel ; erreur si l'une n'existe pas. */
export async function lirePieces(db: D1Database, ids: number[]) {
  const uniques = [...new Set(ids)];
  if (!uniques.length) return new Map<number, { id: number; nom: string; suivi: string; stock: number }>();
  const { results } = await db.prepare(
    `SELECT p.id, p.nom, p.suivi, ${STOCK_SQL} AS stock FROM piece p WHERE p.id IN (${uniques.map(() => "?").join(",")})`,
  ).bind(...uniques).all<{ id: number; nom: string; suivi: string; stock: number }>();
  if (results.length !== uniques.length) erreur("Pièce introuvable.", 404);
  return new Map(results.map((p) => [p.id, p]));
}

/**
 * Instructions d'un comptage, à exécuter dans un même lot (transaction) :
 * l'attendu est lu au moment de l'enregistrement, seule la différence devient un mouvement.
 */
export function instructionsComptage(db: D1Database, lignes: LigneComptage[], type: "libre" | "avant", salon_id: number | null) {
  const stmts = [db.prepare("INSERT INTO comptage (type, salon_id) VALUES (?, ?)").bind(type, salon_id)];
  for (const l of lignes) {
    stmts.push(
      db.prepare(
        `INSERT INTO comptage_ligne (comptage_id, piece_id, attendu, compte)
         VALUES ((SELECT MAX(id) FROM comptage), ?1, (SELECT COALESCE(SUM(quantite), 0) FROM mouvement WHERE piece_id = ?1), ?2)`,
      ).bind(l.piece_id, l.compte),
      db.prepare(
        `INSERT INTO mouvement (piece_id, quantite, motif, source_type, source_id)
         SELECT piece_id, compte - attendu, 'comptage', 'comptage_ligne', id FROM comptage_ligne
         WHERE id = last_insert_rowid() AND compte <> attendu`,
      ),
    );
  }
  return stmts;
}
