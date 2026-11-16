// Questions (anti-oubli, noms SumUp inconnus, remboursements) et correspondances SumUp ↔ pièces.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, entier, corps, lirePieces, instructionsComptage } from "./outils";
import { appliquerVentes, appliquerEspeces, importer } from "./sumup";

export const questions = new Hono<{ Bindings: Env }>();

type Q = { id: number; type: string; piece_id: number | null; detail: string; cree_le: string };

const ESPECES_A_SAISIR = `SELECT s.id, s.nom, date(s.date_debut, '+' || (s.nb_jours - 1) || ' days') AS fin FROM salon s
     WHERE date(s.date_debut, '+' || (s.nb_jours - 1) || ' days') < date('now')
       AND date(s.date_debut, '+' || (s.nb_jours - 1) || ' days') >= date('now', '-30 days')
       AND s.especes_montant IS NULL AND NOT EXISTS (SELECT 1 FROM vente_especes ve WHERE ve.salon_id = s.id)`;

// Nombre de questions en attente (pastille du menu) : deux comptages, rien d'autre.
questions.get("/questions/nombre", async (c) => {
  const db = c.env.DB;
  const [a, b] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM question WHERE repondu_le IS NULL"),
    db.prepare(`SELECT COUNT(*) AS n FROM (${ESPECES_A_SAISIR})`),
  ]);
  return c.json({ n: (a.results[0] as { n: number }).n + (b.results[0] as { n: number }).n });
});

questions.get("/questions", async (c) => {
  const db = c.env.DB;
  // Tout en un seul aller-retour : questions, statistiques des noms inconnus, rappels d'espèces.
  const [qR, statsR, aSaisirR] = await db.batch([
    db.prepare(
      `SELECT q.id, q.type, q.piece_id, q.detail, q.cree_le, p.nom AS piece, ${STOCK_SQL} AS stock
       FROM question q LEFT JOIN piece p ON p.id = q.piece_id
       WHERE q.repondu_le IS NULL ORDER BY q.cree_le, q.id`,
    ),
    db.prepare(
      `SELECT vl.cle, COUNT(DISTINCT vl.vente_id) AS ventes, SUM(vl.quantite) AS quantite, MIN(v.jour) AS premier, MAX(v.jour) AS dernier, MAX(vl.prix) AS prix
       FROM vente_ligne vl JOIN vente v ON v.id = vl.vente_id
       WHERE vl.cle IN (SELECT json_extract(detail, '$.cle') FROM question WHERE type = 'nom_inconnu' AND repondu_le IS NULL)
       GROUP BY vl.cle`,
    ),
    db.prepare(ESPECES_A_SAISIR),
  ]);
  const statsPar = new Map((statsR.results as { cle: string }[]).map((x) => [x.cle, x]));
  const sortie = [];
  for (const q of qR.results as (Q & { piece: string | null; stock: number | null })[]) {
    const detail = JSON.parse(q.detail);
    if (q.type === "nom_inconnu") {
      const { cle: _c, ...st } = (statsPar.get(detail.cle) ?? {}) as Record<string, unknown>;
      Object.assign(detail, st);
    }
    sortie.push({ ...q, detail });
  }
  const aSaisir = aSaisirR.results as { id: number; nom: string; fin: string }[];
  for (const s of aSaisir) sortie.push({ id: -s.id, type: "especes_a_saisir", piece_id: null, detail: { salon_id: s.id, nom: s.nom, fin: s.fin }, cree_le: s.fin });
  return c.json(sortie);
});

// Un nom de caisse retire des articles du stock, et/ou compte pour une famille « modèle non précisé » (ex. Tampons).
type DefinitionCorrespondance = { ne_pas_suivre: boolean; pieces: { piece_id: number; quantite: number }[]; familles: { famille_id: number; quantite: number }[] };

function lireDefinition(b: Record<string, unknown>): DefinitionCorrespondance {
  if (b.ne_pas_suivre) return { ne_pas_suivre: true, pieces: [], familles: [] };
  const liste = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const pieces = liste(b.pieces).map((p) => ({ piece_id: entier(p?.piece_id, "article", 1), quantite: entier(p?.quantite ?? 1, "quantité", 1) }));
  const familles = liste(b.familles).map((f) => ({ famille_id: entier(f?.famille_id, "famille", 1), quantite: entier(f?.quantite ?? 1, "quantité", 1) }));
  if (!pieces.length && !familles.length) erreur("Choisissez au moins un article, ou « Ne pas suivre ».");
  if (new Set(pieces.map((p) => p.piece_id)).size !== pieces.length) erreur("Un même article apparaît deux fois.");
  if (new Set(familles.map((f) => f.famille_id)).size !== familles.length) erreur("Une même famille apparaît deux fois.");
  return { ne_pas_suivre: false, pieces, familles };
}

/** (Re)définit ce qu'un nom SumUp retire du stock, puis réapplique toutes ses ventes. */
async function definirCorrespondance(db: D1Database, cle: string, nom_affiche: string, d: DefinitionCorrespondance) {
  if (d.pieces.length) await lirePieces(db, d.pieces.map((p) => p.piece_id));
  if (d.familles.length) {
    const ids = d.familles.map((f) => f.famille_id);
    const { results } = await db.prepare(`SELECT id FROM famille WHERE modele_non_precise = 1 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    if (results.length !== ids.length) erreur("Seules les familles dont la caisse ne précise pas le modèle peuvent être choisies ainsi.");
  }
  await db.batch([
    db.prepare(
      `INSERT INTO correspondance (cle, nom_affiche, ne_pas_suivre) VALUES (?, ?, ?)
       ON CONFLICT (cle) DO UPDATE SET ne_pas_suivre = excluded.ne_pas_suivre`,
    ).bind(cle, nom_affiche, d.ne_pas_suivre ? 1 : 0),
    db.prepare("DELETE FROM correspondance_piece WHERE cle = ?").bind(cle),
    db.prepare("DELETE FROM correspondance_famille WHERE cle = ?").bind(cle),
    ...d.pieces.map((p) => db.prepare("INSERT INTO correspondance_piece (cle, piece_id, quantite) VALUES (?, ?, ?)").bind(cle, p.piece_id, p.quantite)),
    ...d.familles.map((f) => db.prepare("INSERT INTO correspondance_famille (cle, famille_id, quantite) VALUES (?, ?, ?)").bind(cle, f.famille_id, f.quantite)),
    // Les ventes déjà appliquées avec l'ancienne définition sont retirées puis réappliquées.
    db.prepare("DELETE FROM mouvement WHERE source_type = 'vente_ligne' AND source_id IN (SELECT id FROM vente_ligne WHERE cle = ?)").bind(cle),
    db.prepare("DELETE FROM mouvement WHERE source_type = 'vente_especes' AND source_id IN (SELECT id FROM vente_especes WHERE cle = ?)").bind(cle),
    db.prepare("UPDATE question SET reponse = 'défini', repondu_le = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type = 'nom_inconnu' AND repondu_le IS NULL AND json_extract(detail, '$.cle') = ?").bind(cle),
  ]);
  return (await appliquerVentes(db, { cle })) + (await appliquerEspeces(db, { cle }));
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
    const pieces = b.pieces.map((p: Record<string, unknown>) => ({ piece_id: entier(p?.piece_id, "article", 1), quantite: entier(p?.quantite ?? 1, "quantité", 1) }));
    const lues = await lirePieces(db, pieces.map((p) => p.piece_id));
    if ([...lues.values()].some((p) => p.suivi !== "quantite")) erreur("Cet article n'a pas de stock.");
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
  const [corr, pieces, familles, compte] = await db.batch([
    db.prepare("SELECT cle, nom_affiche, ne_pas_suivre FROM correspondance ORDER BY nom_affiche"),
    db.prepare("SELECT cp.cle, cp.piece_id, cp.quantite, p.nom FROM correspondance_piece cp JOIN piece p ON p.id = cp.piece_id"),
    db.prepare("SELECT cf.cle, cf.famille_id, cf.quantite, f.nom FROM correspondance_famille cf JOIN famille f ON f.id = cf.famille_id"),
    db.prepare("SELECT cle, SUM(quantite) AS vendus FROM vente_ligne GROUP BY cle"),
  ]);
  const grouper = (rows: { cle: string }[]) => {
    const m = new Map<string, unknown[]>();
    for (const r of rows) (m.get(r.cle) ?? m.set(r.cle, []).get(r.cle)!).push(r);
    return m;
  };
  const parCle = grouper(pieces.results as { cle: string }[]), famParCle = grouper(familles.results as { cle: string }[]);
  const vendus = new Map((compte.results as { cle: string; vendus: number }[]).map((x) => [x.cle, x.vendus]));
  return c.json((corr.results as { cle: string }[]).map((x) => ({ ...x, pieces: parCle.get(x.cle) ?? [], familles: famParCle.get(x.cle) ?? [], vendus: vendus.get(x.cle) ?? 0 })));
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
