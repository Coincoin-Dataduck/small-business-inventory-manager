import { HTTPException } from "hono/http-exception";

export type Env = {
  DB: D1Database;
  SUMUP_API_KEY?: string; SUMUP_BASE?: string;
  ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ACCES_LOCAL_SANS_CONTROLE?: string;
};

export const NIVEAUX = ["a_vendre", "fait_maison", "achete", "recup"] as const;
export const SUIVIS = ["quantite", "sans_quantite"] as const; // « generique » : ancien, remplacé par famille.modele_non_precise

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
    piece_id: entier(l?.piece_id, "article", 1),
    compte: entier(l?.compte, "quantité comptée", 0),
  }));
  if (new Set(lignes.map((l) => l.piece_id)).size !== lignes.length) erreur("Un même élément apparaît deux fois dans le comptage.");
  return lignes;
}

/** Pièces demandées, avec leur suivi et leur stock actuel ; erreur si l'une n'existe pas. */
export async function lirePieces(db: D1Database, ids: number[]) {
  const uniques = [...new Set(ids)];
  if (!uniques.length) return new Map<number, { id: number; nom: string; suivi: string; stock: number }>();
  const { results } = await db.prepare(
    `SELECT p.id, p.nom, p.suivi, ${STOCK_SQL} AS stock FROM piece p WHERE p.id IN (${uniques.map(() => "?").join(",")})`,
  ).bind(...uniques).all<{ id: number; nom: string; suivi: string; stock: number }>();
  if (results.length !== uniques.length) erreur("Article ou fourniture introuvable.", 404);
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

/**
 * Rejoue les comptages d'articles dans l'ordre des dates : chaque comptage redonne exactement le chiffre compté,
 * même si un mouvement daté d'avant (ventes en espèces saisies après coup, stock d'avant ajouté) arrive plus tard.
 */
export async function rejouerComptages(db: D1Database, pieceIds: number[]) {
  const ids = [...new Set(pieceIds)];
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  const [lR, mR] = await db.batch([
    db.prepare(`SELECT cl.id, cl.piece_id, cl.compte, cl.attendu, c.date FROM comptage_ligne cl JOIN comptage c ON c.id = cl.comptage_id WHERE cl.piece_id IN (${ph}) ORDER BY c.date, cl.id`).bind(...ids),
    db.prepare(`SELECT id, piece_id, quantite, motif, date, source_type, source_id FROM mouvement WHERE piece_id IN (${ph})`).bind(...ids),
  ]);
  const lignes = lR.results as { id: number; piece_id: number; compte: number; attendu: number; date: string }[];
  const mvts = mR.results as { id: number; piece_id: number; quantite: number; motif: string; date: string; source_type: string | null; source_id: number | null }[];
  const stmts: D1PreparedStatement[] = [];
  for (const pid of ids) {
    const autres = mvts.filter((m) => m.piece_id === pid && m.motif !== "comptage");
    const corr = new Map(mvts.filter((m) => m.piece_id === pid && m.motif === "comptage" && m.source_type === "comptage_ligne").map((m) => [m.source_id, m]));
    let faites = 0;
    for (const l of lignes.filter((x) => x.piece_id === pid)) {
      const attendu = autres.filter((m) => m.date < l.date).reduce((t, m) => t + m.quantite, 0) + faites;
      const c = l.compte - attendu;
      faites += c;
      const ex = corr.get(l.id);
      if (l.attendu !== attendu) stmts.push(db.prepare("UPDATE comptage_ligne SET attendu = ? WHERE id = ?").bind(attendu, l.id));
      if (ex && c === 0) stmts.push(db.prepare("DELETE FROM mouvement WHERE id = ?").bind(ex.id));
      else if (ex && ex.quantite !== c) stmts.push(db.prepare("UPDATE mouvement SET quantite = ? WHERE id = ?").bind(c, ex.id));
      else if (!ex && c !== 0) stmts.push(db.prepare("INSERT INTO mouvement (piece_id, quantite, motif, date, source_type, source_id) VALUES (?, ?, 'comptage', ?, 'comptage_ligne', ?)").bind(pid, c, l.date, l.id));
    }
  }
  if (stmts.length) await db.batch(stmts);
}
