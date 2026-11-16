import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

type Env = { DB: D1Database; SUMUP_API_KEY?: string };
const app = new Hono<{ Bindings: Env }>().basePath("/api");

const NIVEAUX = ["a_vendre", "fait_maison", "achete", "recup"] as const;
const SUIVIS = ["quantite", "sans_quantite", "generique"] as const;

// Stock d'une pièce = somme de ses mouvements (voir docs/donnees.md).
const STOCK_SQL = "(SELECT COALESCE(SUM(m.quantite), 0) FROM mouvement m WHERE m.piece_id = p.id)";

function erreur(message: string, status: 400 | 404 | 409 = 400): never {
  throw new HTTPException(status, { message });
}

function texte(v: unknown, champ: string): string {
  if (typeof v !== "string" || !v.trim()) erreur(`« ${champ} » est obligatoire.`);
  return v.trim();
}

function entier(v: unknown, champ: string, min = 0): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) erreur(`« ${champ} » doit être un nombre entier ≥ ${min}.`);
  return n;
}

function choix<T extends string>(v: unknown, permis: readonly T[], champ: string): T {
  if (!permis.includes(v as T)) erreur(`« ${champ} » invalide.`);
  return v as T;
}

async function corps(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {}
  erreur("Données reçues illisibles.");
}

// ───────────── Familles ─────────────
app.get("/familles", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, nom, ordre FROM famille ORDER BY ordre, nom").all();
  return c.json(results);
});

app.post("/familles", async (c) => {
  const b = await corps(c);
  const nom = texte(b.nom, "nom");
  const ordre = b.ordre === undefined ? 0 : entier(b.ordre, "ordre");
  const r = await c.env.DB.prepare("INSERT INTO famille (nom, ordre) VALUES (?, ?) ON CONFLICT (nom) DO NOTHING RETURNING id")
    .bind(nom, ordre).first<{ id: number }>();
  if (!r) erreur(`La famille « ${nom} » existe déjà.`, 409);
  return c.json({ id: r.id, nom, ordre }, 201);
});

app.patch("/familles/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const sets: string[] = [], vals: unknown[] = [];
  if (b.nom !== undefined) { sets.push("nom = ?"); vals.push(texte(b.nom, "nom")); }
  if (b.ordre !== undefined) { sets.push("ordre = ?"); vals.push(entier(b.ordre, "ordre")); }
  if (!sets.length) erreur("Rien à modifier.");
  try {
    const r = await c.env.DB.prepare(`UPDATE famille SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
    if (!r.meta.changes) erreur("Famille introuvable.", 404);
  } catch (e) {
    if (String(e).includes("UNIQUE")) erreur("Une autre famille porte déjà ce nom.", 409);
    throw e;
  }
  return c.json({ ok: true });
});

// ───────────── Pièces ─────────────
app.post("/pieces", async (c) => {
  const b = await corps(c);
  const nom = texte(b.nom, "nom");
  const famille_id = entier(b.famille_id, "famille", 1);
  const niveau = choix(b.niveau, NIVEAUX, "niveau");
  const suivi = b.suivi === undefined ? "quantite" : choix(b.suivi, SUIVIS, "suivi");
  const fam = await c.env.DB.prepare("SELECT 1 FROM famille WHERE id = ?").bind(famille_id).first();
  if (!fam) erreur("Famille introuvable.", 404);
  const r = await c.env.DB.prepare(
    "INSERT INTO piece (nom, famille_id, niveau, suivi) VALUES (?, ?, ?, ?) ON CONFLICT (famille_id, nom) DO NOTHING RETURNING id",
  ).bind(nom, famille_id, niveau, suivi).first<{ id: number }>();
  if (!r) erreur(`« ${nom} » existe déjà dans cette famille.`, 409);
  return c.json({ id: r.id }, 201);
});

app.patch("/pieces/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const sets: string[] = [], vals: unknown[] = [];
  if (b.nom !== undefined) { sets.push("nom = ?"); vals.push(texte(b.nom, "nom")); }
  if (b.famille_id !== undefined) { sets.push("famille_id = ?"); vals.push(entier(b.famille_id, "famille", 1)); }
  if (b.niveau !== undefined) { sets.push("niveau = ?"); vals.push(choix(b.niveau, NIVEAUX, "niveau")); }
  if (b.suivi !== undefined) { sets.push("suivi = ?"); vals.push(choix(b.suivi, SUIVIS, "suivi")); }
  if (b.fin_de_serie !== undefined) { sets.push("fin_de_serie = ?"); vals.push(b.fin_de_serie ? 1 : 0); }
  if (b.presque_vide !== undefined) { sets.push("presque_vide = ?"); vals.push(b.presque_vide ? 1 : 0); }
  if (!sets.length) erreur("Rien à modifier.");
  try {
    const r = await c.env.DB.prepare(`UPDATE piece SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
    if (!r.meta.changes) erreur("Pièce introuvable.", 404);
  } catch (e) {
    if (String(e).includes("UNIQUE")) erreur("Ce nom existe déjà dans cette famille.", 409);
    if (String(e).includes("FOREIGN KEY")) erreur("Famille introuvable.", 404);
    throw e;
  }
  return c.json({ ok: true });
});

// Historique d'une pièce : explique le chiffre affiché.
app.get("/pieces/:id/mouvements", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const { results } = await c.env.DB.prepare(
    "SELECT id, quantite, motif, date, source_type, source_id FROM mouvement WHERE piece_id = ? ORDER BY date DESC, id DESC LIMIT 200",
  ).bind(id).all();
  return c.json(results);
});

// ───────────── Stock ─────────────
app.get("/stock", async (c) => {
  const [fams, pieces] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, nom, ordre FROM famille ORDER BY ordre, nom"),
    c.env.DB.prepare(
      `SELECT p.id, p.nom, p.famille_id, p.niveau, p.suivi, p.fin_de_serie, p.presque_vide, ${STOCK_SQL} AS stock
       FROM piece p ORDER BY CASE p.niveau WHEN 'a_vendre' THEN 0 WHEN 'fait_maison' THEN 1 WHEN 'achete' THEN 2 ELSE 3 END, p.nom`,
    ),
  ]);
  const parFamille = new Map<number, unknown[]>();
  for (const p of pieces.results as { famille_id: number }[]) {
    if (!parFamille.has(p.famille_id)) parFamille.set(p.famille_id, []);
    parFamille.get(p.famille_id)!.push(p);
  }
  return c.json((fams.results as { id: number }[]).map((f) => ({ ...f, pieces: parFamille.get(f.id) ?? [] })));
});

// ───────────── Compter ─────────────
// Une seule façon de corriger un chiffre : on tape le vrai, l'outil enregistre la différence.
app.post("/comptages", async (c) => {
  const b = await corps(c);
  const type = b.type === undefined ? "libre" : choix(b.type, ["libre", "avant"] as const, "type");
  const preparation_id = b.preparation_id == null ? null : entier(b.preparation_id, "préparation", 1);
  if (!Array.isArray(b.lignes) || !b.lignes.length) erreur("Aucune quantité comptée.");
  const lignes = b.lignes.map((l: Record<string, unknown>) => ({
    piece_id: entier(l?.piece_id, "pièce", 1),
    compte: entier(l?.compte, "quantité comptée", 0),
  }));
  const ids = [...new Set(lignes.map((l) => l.piece_id))];
  if (ids.length !== lignes.length) erreur("Une pièce apparaît deux fois dans le comptage.");

  const { results: trouvees } = await c.env.DB.prepare(
    `SELECT id, suivi FROM piece WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all<{ id: number; suivi: string }>();
  if (trouvees.length !== ids.length) erreur("Pièce introuvable.", 404);
  if (trouvees.some((p) => p.suivi !== "quantite")) erreur("Cette pièce ne se compte pas (sans quantité ou générique).");

  // Tout dans un seul lot (transaction) : l'attendu est lu au moment même de l'enregistrement.
  const db = c.env.DB;
  const stmts = [db.prepare("INSERT INTO comptage (type, preparation_id) VALUES (?, ?)").bind(type, preparation_id)];
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
  stmts.push(
    db.prepare(
      "SELECT cl.piece_id, p.nom, cl.attendu, cl.compte, cl.compte - cl.attendu AS ecart, cl.comptage_id FROM comptage_ligne cl JOIN piece p ON p.id = cl.piece_id WHERE cl.comptage_id = (SELECT MAX(id) FROM comptage)",
    ),
  );
  const res = await db.batch(stmts);
  const detail = res[res.length - 1].results as { ecart: number; comptage_id: number }[];
  return c.json({ comptage_id: detail[0]?.comptage_id, lignes: detail, ecarts: detail.filter((d) => d.ecart !== 0).length }, 201);
});

app.onError((e, c) => {
  if (e instanceof HTTPException) return c.json({ erreur: e.message }, e.status);
  console.error(e);
  return c.json({ erreur: "Erreur inattendue côté serveur." }, 500);
});
app.notFound((c) => c.json({ erreur: "Adresse inconnue." }, 404));

export default app;
