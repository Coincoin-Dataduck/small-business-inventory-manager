// Questions (anti-oubli, noms SumUp inconnus, remboursements) et correspondances SumUp ↔ pièces.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, entier, corps, lirePieces, instructionsComptage } from "./outils";
import { appliquerVentes, importer } from "./sumup";

export const questions = new Hono<{ Bindings: Env }>();

type Q = { id: number; type: string; piece_id: number | null; detail: string; cree_le: string };

questions.get("/questions", async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT q.id, q.type, q.piece_id, q.detail, q.cree_le, p.nom AS piece, ${STOCK_SQL} AS stock
     FROM question q LEFT JOIN piece p ON p.id = q.piece_id
     WHERE q.repondu_le IS NULL ORDER BY q.cree_le, q.id`,
  ).all<Q & { piece: string | null; stock: number | null }>();
  // Pour un nom inconnu : combien de ventes, quand.
  const sortie = [];
  for (const q of results) {
    const detail = JSON.parse(q.detail);
    if (q.type === "nom_inconnu") {
      const s = await db.prepare(
        "SELECT COUNT(DISTINCT vl.vente_id) AS ventes, SUM(vl.quantite) AS quantite, MIN(v.jour) AS premier, MAX(v.jour) AS dernier, MAX(vl.prix) AS prix FROM vente_ligne vl JOIN vente v ON v.id = vl.vente_id WHERE vl.cle = ?",
      ).bind(detail.cle).first();
      Object.assign(detail, s);
    }
    sortie.push({ ...q, detail });
  }
  return c.json(sortie);
});

type DefinitionCorrespondance = { ne_pas_suivre: boolean; pieces: { piece_id: number; quantite: number }[]; equivalent_tampons: number };

function lireDefinition(b: Record<string, unknown>): DefinitionCorrespondance {
  if (b.ne_pas_suivre) return { ne_pas_suivre: true, pieces: [], equivalent_tampons: 0 };
  if (!Array.isArray(b.pieces) || !b.pieces.length) erreur("Choisissez au moins une pièce, ou « Ne pas suivre ».");
  const pieces = b.pieces.map((p: Record<string, unknown>) => ({ piece_id: entier(p?.piece_id, "pièce", 1), quantite: entier(p?.quantite ?? 1, "quantité", 1) }));
  if (new Set(pieces.map((p) => p.piece_id)).size !== pieces.length) erreur("Une pièce apparaît deux fois.");
  const equivalent_tampons = b.equivalent_tampons === undefined || b.equivalent_tampons === "" ? 0 : entier(b.equivalent_tampons, "équivalent tampons", 0);
  return { ne_pas_suivre: false, pieces, equivalent_tampons };
}

/** (Re)définit ce qu'un nom SumUp retire du stock, puis réapplique toutes ses ventes. */
async function definirCorrespondance(db: D1Database, cle: string, nom_affiche: string, d: DefinitionCorrespondance) {
  if (d.pieces.length) await lirePieces(db, d.pieces.map((p) => p.piece_id));
  await db.batch([
    db.prepare(
      `INSERT INTO correspondance (cle, nom_affiche, ne_pas_suivre, equivalent_tampons) VALUES (?, ?, ?, ?)
       ON CONFLICT (cle) DO UPDATE SET ne_pas_suivre = excluded.ne_pas_suivre, equivalent_tampons = excluded.equivalent_tampons`,
    ).bind(cle, nom_affiche, d.ne_pas_suivre ? 1 : 0, d.equivalent_tampons),
    db.prepare("DELETE FROM correspondance_piece WHERE cle = ?").bind(cle),
    ...d.pieces.map((p) => db.prepare("INSERT INTO correspondance_piece (cle, piece_id, quantite) VALUES (?, ?, ?)").bind(cle, p.piece_id, p.quantite)),
    // Les ventes déjà appliquées avec l'ancienne définition sont retirées puis réappliquées.
    db.prepare("DELETE FROM mouvement WHERE source_type = 'vente_ligne' AND source_id IN (SELECT id FROM vente_ligne WHERE cle = ?)").bind(cle),
    db.prepare("UPDATE question SET reponse = 'défini', repondu_le = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type = 'nom_inconnu' AND repondu_le IS NULL AND json_extract(detail, '$.cle') = ?").bind(cle),
  ]);
  return appliquerVentes(db, { cle });
}

questions.post("/questions/:id/reponse", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const db = c.env.DB;
  const q = await db.prepare("SELECT id, type, piece_id, detail FROM question WHERE id = ? AND repondu_le IS NULL").bind(id).first<Q>();
  if (!q) erreur("Question introuvable ou déjà réglée.", 404);
  const detail = JSON.parse(q.detail);
  const fermer = (reponse: unknown) =>
    db.prepare("UPDATE question SET reponse = ?, repondu_le = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(JSON.stringify(reponse), id);

  if (q.type === "nom_inconnu") {
    const d = lireDefinition(b);
    const nom = detail.description ? `${detail.nom} · ${detail.description}` : detail.nom;
    const appliquees = await definirCorrespondance(db, detail.cle, nom, d);
    return c.json({ ok: true, ventes_appliquees: appliquees });
  }

  if (q.type === "vente_impossible") {
    // « Combien en aviez-vous vraiment avant ces ventes ? » → on corrige d'autant le chiffre actuel.
    const n = entier(b.compte, "nombre", 0);
    const p = (await lirePieces(db, [q.piece_id!])).get(q.piece_id!)!;
    const nouveau = Math.max(0, p.stock + (n - detail.stock_avant));
    await db.batch([...instructionsComptage(db, [{ piece_id: q.piece_id!, compte: nouveau }], "libre", null), fermer({ avant: n, nouveau })]);
    return c.json({ ok: true, stock: nouveau });
  }

  if (q.type === "remboursement") {
    if (b.rien) { await fermer({ rien: true }).run(); return c.json({ ok: true }); }
    if (!Array.isArray(b.pieces) || !b.pieces.length) erreur("Indiquez ce qui est revenu en stock, ou « Rien n'est revenu ».");
    const pieces = b.pieces.map((p: Record<string, unknown>) => ({ piece_id: entier(p?.piece_id, "pièce", 1), quantite: entier(p?.quantite ?? 1, "quantité", 1) }));
    const lues = await lirePieces(db, pieces.map((p) => p.piece_id));
    if ([...lues.values()].some((p) => p.suivi !== "quantite")) erreur("Cette pièce n'a pas de stock.");
    await db.batch([
      ...pieces.map((p) => db.prepare("INSERT INTO mouvement (piece_id, quantite, motif, source_type, source_id) VALUES (?, ?, 'remboursement', 'question', ?)").bind(p.piece_id, p.quantite, id)),
      fermer({ pieces }),
    ]);
    return c.json({ ok: true });
  }
  erreur("Ce type de question ne se règle pas ici.");
});

// Même réponse pour plusieurs noms inconnus (variantes d'un même article, ou « Ne pas suivre » en lot).
questions.post("/questions/reponse-groupee", async (c) => {
  const b = await corps(c);
  if (!Array.isArray(b.ids) || !b.ids.length) erreur("Aucune question choisie.");
  const ids = [...new Set(b.ids.map((x: unknown) => entier(x, "question", 1)))];
  const d = lireDefinition(b);
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT id, detail FROM question WHERE type = 'nom_inconnu' AND repondu_le IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all<{ id: number; detail: string }>();
  if (results.length !== ids.length) erreur("Une des questions est introuvable ou déjà réglée.", 404);
  let appliquees = 0;
  for (const q of results) {
    const x = JSON.parse(q.detail);
    appliquees += await definirCorrespondance(db, x.cle, x.description ? `${x.nom} · ${x.description}` : x.nom, d);
  }
  return c.json({ ok: true, noms: results.length, ventes_appliquees: appliquees });
});

// ───────────── Correspondances (Réglages) ─────────────
questions.get("/correspondances", async (c) => {
  const db = c.env.DB;
  const [corr, pieces, compte] = await db.batch([
    db.prepare("SELECT cle, nom_affiche, ne_pas_suivre, equivalent_tampons FROM correspondance ORDER BY nom_affiche"),
    db.prepare("SELECT cp.cle, cp.piece_id, cp.quantite, p.nom FROM correspondance_piece cp JOIN piece p ON p.id = cp.piece_id"),
    db.prepare("SELECT cle, SUM(quantite) AS vendus FROM vente_ligne GROUP BY cle"),
  ]);
  const parCle = new Map<string, unknown[]>();
  for (const p of pieces.results as { cle: string }[]) (parCle.get(p.cle) ?? parCle.set(p.cle, []).get(p.cle)!).push(p);
  const vendus = new Map((compte.results as { cle: string; vendus: number }[]).map((x) => [x.cle, x.vendus]));
  return c.json((corr.results as { cle: string }[]).map((x) => ({ ...x, pieces: parCle.get(x.cle) ?? [], vendus: vendus.get(x.cle) ?? 0 })));
});

questions.put("/correspondances", async (c) => {
  const b = await corps(c);
  if (typeof b.cle !== "string" || !b.cle) erreur("Nom SumUp manquant.");
  const db = c.env.DB;
  const ex = await db.prepare("SELECT nom_affiche FROM correspondance WHERE cle = ?").bind(b.cle).first<{ nom_affiche: string }>();
  if (!ex) erreur("Nom SumUp inconnu.", 404);
  const appliquees = await definirCorrespondance(db, b.cle, ex.nom_affiche, lireDefinition(b));
  return c.json({ ok: true, ventes_appliquees: appliquees });
});

// ───────────── Import ─────────────
questions.get("/import", async (c) => {
  const db = c.env.DB;
  const [etat, nb] = await Promise.all([
    db.prepare("SELECT maj_le, resultat, a_jour FROM import_etat WHERE id = 1").first<{ maj_le: string; resultat: string; a_jour: number }>(),
    db.prepare("SELECT COUNT(*) AS ventes, MAX(date) AS derniere FROM vente").first<{ ventes: number; derniere: string | null }>(),
  ]);
  return c.json({ maj_le: etat?.maj_le ?? null, a_jour: !!etat?.a_jour, resultat: etat ? JSON.parse(etat.resultat) : null, ventes: nb?.ventes ?? 0, derniere_vente: nb?.derniere ?? null });
});

questions.post("/import", async (c) => c.json(await importer(c.env, 40)));
