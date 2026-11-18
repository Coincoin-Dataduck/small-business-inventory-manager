// Recettes « ce qu'il faut pour en faire » (décision du 18/11/2026, spec §1).
// Une recette appartient à un article ou une fourniture maison, à un produit (toutes ses variantes),
// ou à une famille pour une variante (« tous les prints A5 »). Pas d'étapes, pas d'ordre, pas de temps.
import { Hono } from "hono";
import { Env, erreur, texte, entier, corps } from "./outils";

export const fiches = new Hono<{ Bindings: Env }>();

export type Element = { piece_id: number | null; produit_id: number | null; quantite: number };
export type Recette = {
  id: number; piece_id: number | null; produit_id: number | null; famille_id: number | null; variante: string | null;
  pour: number | null; elements: Element[];
};
export type PieceRecette = { id: number; famille_id: number; produit_id: number | null; variante: string | null };

export async function lireRecettes(db: D1Database): Promise<Recette[]> {
  const [r, e] = await db.batch([
    db.prepare("SELECT id, piece_id, produit_id, famille_id, variante, pour FROM recette ORDER BY id"),
    db.prepare("SELECT recette_id, piece_id, produit_id, quantite FROM recette_element ORDER BY id"),
  ]);
  const els = e.results as (Element & { recette_id: number })[];
  return (r.results as Omit<Recette, "elements">[]).map((x) => ({
    ...x, elements: els.filter((y) => y.recette_id === x.id).map(({ recette_id, ...y }) => y),
  }));
}

/** La recette qui vaut pour cette pièce : la sienne, sinon celle de son produit, sinon celle de sa famille pour sa variante. */
export function recetteDe(p: PieceRecette, recettes: Recette[]): Recette | null {
  return recettes.find((r) => r.piece_id === p.id)
    ?? (p.produit_id ? recettes.find((r) => r.produit_id === p.produit_id) : undefined)
    ?? (p.variante ? recettes.find((r) => r.famille_id === p.famille_id && r.variante === p.variante) : undefined)
    ?? null;
}

/** L'élément concret : la pièce citée, ou celle du produit cité qui a la même variante. */
export function resoudre<T extends PieceRecette>(el: Element, p: PieceRecette, pieces: T[]): T | null {
  if (el.piece_id !== null) return pieces.find((x) => x.id === el.piece_id) ?? null;
  return pieces.find((x) => x.produit_id === el.produit_id && x.variante === p.variante) ?? null;
}

/** Quantité saisie : « 2 », « 0,25 » ou « 1/4 ». */
function lireQuantite(v: unknown): number {
  const s = String(v ?? "").trim().replace(",", ".");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  const n = m ? Number(m[1]) / Number(m[2]) : Number(s);
  if (!Number.isFinite(n) || n <= 0) erreur("Quantité invalide : un nombre comme 2, 0,25 ou 1/4.");
  return Math.round(n * 10000) / 10000;
}

fiches.get("/recettes", async (c) => c.json(await lireRecettes(c.env.DB)));

// Enregistre la recette d'une cible (la crée ou la remplace). Sans élément : la recette est supprimée.
fiches.put("/recettes", async (c) => {
  const b = await corps(c);
  const db = c.env.DB;
  const piece_id = b.piece_id == null ? null : entier(b.piece_id, "article", 1);
  const produit_id = b.produit_id == null ? null : entier(b.produit_id, "produit", 1);
  const famille_id = b.famille_id == null ? null : entier(b.famille_id, "famille", 1);
  const variante = famille_id === null ? null : texte(b.variante, "variante");
  if ((piece_id ? 1 : 0) + (produit_id ? 1 : 0) + (famille_id ? 1 : 0) !== 1) erreur("Une recette appartient à un article, à un produit, ou à une famille pour une variante.");
  const pour = b.pour === null || b.pour === "" || b.pour === undefined ? null : entier(b.pour, "« pour en faire »", 1);
  if (!Array.isArray(b.elements)) erreur("Éléments manquants.");
  const elements = (b.elements as Record<string, unknown>[]).map((e) => {
    const pid = e?.piece_id == null ? null : entier(e.piece_id, "élément", 1);
    const prid = e?.produit_id == null ? null : entier(e.produit_id, "produit", 1);
    if ((pid === null) === (prid === null)) erreur("Chaque ligne désigne une fourniture, ou un produit « de la même variante ».");
    return { piece_id: pid, produit_id: prid, quantite: lireQuantite(e?.quantite) };
  });
  if (piece_id && elements.some((e) => e.piece_id === piece_id)) erreur("Une recette ne peut pas s'utiliser elle-même.");
  const cond = piece_id ? ["piece_id = ?", piece_id] : produit_id ? ["produit_id = ?", produit_id] : ["famille_id = ? AND variante = ?", famille_id, variante];
  const ex = await db.prepare(`SELECT id FROM recette WHERE ${cond[0]}`).bind(...cond.slice(1)).first<{ id: number }>();
  const stmts: D1PreparedStatement[] = [];
  if (ex) stmts.push(db.prepare("DELETE FROM recette_element WHERE recette_id = ?").bind(ex.id));
  if (!elements.length) {
    if (ex) stmts.push(db.prepare("DELETE FROM recette WHERE id = ?").bind(ex.id));
    if (stmts.length) await db.batch(stmts);
    return c.json({ ok: true, id: null });
  }
  if (ex) stmts.push(db.prepare("UPDATE recette SET pour = ? WHERE id = ?").bind(pour, ex.id));
  else stmts.push(db.prepare("INSERT INTO recette (piece_id, produit_id, famille_id, variante, pour) VALUES (?, ?, ?, ?, ?)").bind(piece_id, produit_id, famille_id, variante, pour));
  const ref = ex ? String(ex.id) : "(SELECT MAX(id) FROM recette)";
  for (const e of elements) stmts.push(db.prepare(`INSERT INTO recette_element (recette_id, piece_id, produit_id, quantite) VALUES (${ref}, ?, ?, ?)`).bind(e.piece_id, e.produit_id, e.quantite));
  await db.batch(stmts);
  const id = ex?.id ?? (await db.prepare("SELECT MAX(id) AS id FROM recette").first<{ id: number }>())!.id;
  return c.json({ ok: true, id });
});
