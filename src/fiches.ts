// Recettes écrites comme on les pense : par produit (toutes ses variantes), par article simple,
// ou communes à une famille (sortie au choix par variante, ex. prints A3/A4/A5).
// Les étapes concrètes (table etape, une par variante) en sont générées : voir materialiser().
import { Hono } from "hono";
import { Env, erreur, texte, entier, choix, corps } from "./outils";

export const fiches = new Hono<{ Bindings: Env }>();

const MODES = ["par_matiere", "a_la_piece"] as const;
type Ligne = { sens: "utilise" | "donne"; piece_id: number | null; produit_id: number | null; quantite: number };
type Format = { variante: string; quantite: number };
type Recette = {
  id: number; famille_id: number; produit_id: number | null; piece_id: number | null; commune: number;
  ordre: number; nom: string; mode: string; temps_min: number | null; lignes: Ligne[]; formats: Format[];
};
type PieceMin = { id: number; nom: string; famille_id: number; niveau: string; produit_id: number | null; variante: string | null; retire: number };

export async function lireRecettes(db: D1Database): Promise<Recette[]> {
  const [r, l, f] = await db.batch([
    db.prepare("SELECT id, famille_id, produit_id, piece_id, commune, ordre, nom, mode, temps_min FROM recette_etape ORDER BY ordre, id"),
    db.prepare("SELECT recette_etape_id, sens, piece_id, produit_id, quantite FROM recette_ligne ORDER BY id"),
    db.prepare("SELECT recette_etape_id, variante, quantite FROM recette_format ORDER BY rowid"),
  ]);
  const lignes = l.results as (Ligne & { recette_etape_id: number })[];
  const formats = f.results as (Format & { recette_etape_id: number })[];
  return (r.results as Omit<Recette, "lignes" | "formats">[]).map((x) => ({
    ...x,
    lignes: lignes.filter((y) => y.recette_etape_id === x.id).map(({ recette_etape_id, ...y }) => y),
    formats: formats.filter((y) => y.recette_etape_id === x.id).map(({ recette_etape_id, ...y }) => y),
  }));
}

const pgcd = (a: number, b: number): number => (b ? pgcd(b, a % b) : a);
const ppcm = (a: number, b: number) => (a / pgcd(a, b)) * b;

/** Régénère les étapes concrètes à partir des recettes (à appeler après toute modification du catalogue ou des recettes). */
export async function materialiser(db: D1Database) {
  const [recettes, [pR, eR, fR, famR]] = await Promise.all([
    lireRecettes(db),
    db.batch([
      db.prepare("SELECT id, nom, famille_id, niveau, produit_id, variante, retire FROM piece"),
      db.prepare("SELECT id, recette_etape_id, pour_piece_id FROM etape WHERE recette_etape_id IS NOT NULL"),
      db.prepare("SELECT DISTINCT etape_id FROM etape_faite"),
      db.prepare("SELECT id, variantes FROM famille"),
    ]),
  ]);
  const pieces = (pR.results as PieceMin[]).filter((p) => !p.retire);
  const parId = new Map(pieces.map((p) => [p.id, p]));
  const existantes = new Map((eR.results as { id: number; recette_etape_id: number; pour_piece_id: number }[]).map((e) => [`${e.recette_etape_id}:${e.pour_piece_id}`, e.id]));
  const faites = new Set((fR.results as { etape_id: number }[]).map((x) => x.etape_id));
  const variantesFamille = new Map((famR.results as { id: number; variantes: string | null }[]).map((f) => {
    try { return [f.id, new Set<string>(f.variantes ? JSON.parse(f.variantes) : [])]; } catch { return [f.id, new Set<string>()]; }
  }));

  const stmts: D1PreparedStatement[] = [];
  const vues = new Set<string>();
  for (const r of recettes) {
    // Une étape de produit qui ne cite aucune « même variante » (ex. Graver : feuille → gommes) ne se fait qu'une fois.
    const parVariante = r.lignes.some((l) => l.produit_id !== null);
    // Recette commune : soit une étape « une feuille → plusieurs formats » (formats), soit une étape faite
    // format par format (sans formats) : générée pour chaque article à vendre de la famille, selon sa variante.
    const parFormat = !!r.commune && !r.formats.length;
    const cibles: { id: number; variante: string | null; nom?: string }[] = parFormat
      ? pieces.filter((p) => p.famille_id === r.famille_id && p.niveau === "a_vendre" && p.produit_id && p.variante && variantesFamille.get(r.famille_id)?.has(p.variante)).map((p) => ({ id: p.id, variante: p.variante, nom: p.nom }))
      : r.commune || (r.produit_id && !parVariante) ? [{ id: 0, variante: null }]
      : r.produit_id ? pieces.filter((p) => p.produit_id === r.produit_id).map((p) => ({ id: p.id, variante: p.variante }))
      : r.piece_id && parId.has(r.piece_id) ? [{ id: r.piece_id, variante: null }] : [];
    for (const t of cibles) {
      const resoudre = (l: Ligne) => l.piece_id !== null ? (parId.has(l.piece_id) ? l.piece_id : null)
        : pieces.find((p) => p.produit_id === l.produit_id && p.variante === t.variante)?.id ?? null;
      const utilise = r.lignes.filter((l) => l.sens === "utilise").map((l) => ({ id: resoudre(l), q: l.quantite }));
      let donne = r.lignes.filter((l) => l.sens === "donne").map((l) => ({ id: resoudre(l), q: l.quantite }));
      if (parFormat && !donne.length) donne = [{ id: t.id, q: 1 }]; // on obtient le print lui-même (même format)
      if ([...utilise, ...(r.commune && !parFormat ? [] : donne)].some((x) => x.id === null)) continue; // une variante sans sa fourniture « même variante » : pas d'étape
      let auChoix: { capacite: number; choix: { id: number; poids: number }[] } | null = null;
      if (r.produit_id && !parVariante && !pieces.some((p) => p.produit_id === r.produit_id)) continue;
      if (r.commune && !parFormat) {
        const q = new Map(r.formats.map((f) => [f.variante, f.quantite]));
        // Ce qui sort de la feuille : un produit précis (ex. Tirage A3/A4/A5), sinon directement les prints.
        const de = r.lignes.find((l) => l.sens === "donne" && l.produit_id !== null)?.produit_id ?? null;
        const choisis = de !== null
          ? pieces.filter((p) => p.produit_id === de && p.variante && q.has(p.variante))
          : pieces.filter((p) => p.famille_id === r.famille_id && p.niveau === "a_vendre" && p.variante && q.has(p.variante));
        if (!choisis.length) continue;
        const capacite = [...q.values()].reduce(ppcm, 1);
        auChoix = { capacite, choix: choisis.map((p) => ({ id: p.id, poids: capacite / q.get(p.variante!)! })) };
        donne = [];
      } else if (!donne.length) continue;
      const cle = `${r.id}:${t.id}`;
      vues.add(cle);
      const nom = t.nom ? `${r.nom} · ${t.nom}` : t.variante ? `${r.nom} · ${t.variante}` : r.nom;
      const ex = existantes.get(cle);
      const ref = ex !== undefined ? String(ex) : "(SELECT MAX(id) FROM etape)";
      if (ex !== undefined) {
        stmts.push(db.prepare("UPDATE etape SET famille_id = ?, nom = ?, mode = ?, temps_min = ?, ordre = ? WHERE id = ?").bind(r.famille_id, nom, r.mode, r.temps_min, r.ordre, ex));
        stmts.push(db.prepare("DELETE FROM etape_choix WHERE etape_donne_id IN (SELECT id FROM etape_donne WHERE etape_id = ?)").bind(ex));
        stmts.push(db.prepare("DELETE FROM etape_utilise WHERE etape_id = ?").bind(ex), db.prepare("DELETE FROM etape_donne WHERE etape_id = ?").bind(ex));
      } else {
        stmts.push(db.prepare("INSERT INTO etape (famille_id, nom, mode, temps_min, ordre, recette_etape_id, pour_piece_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(r.famille_id, nom, r.mode, r.temps_min, r.ordre, r.id, t.id));
      }
      // Une même fourniture citée deux fois : quantités additionnées.
      const somme = (xs: { id: number | null; q: number }[]) => { const m = new Map<number, number>(); for (const x of xs) m.set(x.id!, (m.get(x.id!) ?? 0) + x.q); return m; };
      for (const [id, q] of somme(utilise)) stmts.push(db.prepare(`INSERT INTO etape_utilise (etape_id, piece_id, quantite) VALUES (${ref}, ?, ?)`).bind(id, q));
      for (const [id, q] of somme(donne)) stmts.push(db.prepare(`INSERT INTO etape_donne (etape_id, piece_id, quantite) VALUES (${ref}, ?, ?)`).bind(id, q));
      if (auChoix) {
        stmts.push(db.prepare(`INSERT INTO etape_donne (etape_id, piece_id, quantite, au_choix) VALUES (${ref}, NULL, ?, 1)`).bind(auChoix.capacite));
        for (const x of auChoix.choix) stmts.push(db.prepare("INSERT INTO etape_choix (etape_donne_id, piece_id, poids) VALUES ((SELECT MAX(id) FROM etape_donne), ?, ?)").bind(x.id, x.poids));
      }
    }
  }
  // Étapes qui ne correspondent plus à rien : supprimées, ou rendues inertes si elles ont déjà été faites (historique).
  for (const [cle, id] of existantes) {
    if (vues.has(cle)) continue;
    stmts.push(db.prepare("DELETE FROM etape_choix WHERE etape_donne_id IN (SELECT id FROM etape_donne WHERE etape_id = ?)").bind(id));
    stmts.push(db.prepare("DELETE FROM etape_utilise WHERE etape_id = ?").bind(id), db.prepare("DELETE FROM etape_donne WHERE etape_id = ?").bind(id));
    stmts.push(faites.has(id) ? db.prepare("UPDATE etape SET recette_etape_id = NULL WHERE id = ?").bind(id) : db.prepare("DELETE FROM etape WHERE id = ?").bind(id));
  }
  if (stmts.length) await db.batch(stmts);
}

// ───────────── Saisie ─────────────
type Saisie = Omit<Recette, "id" | "ordre"> & { ordre: number | null };
async function lireSaisie(db: D1Database, b: Record<string, unknown>): Promise<Saisie> {
  const nom = texte(b.nom, "nom de l'étape");
  const mode = choix(b.mode, MODES, "mode");
  let temps_min: number | null = null;
  if (b.temps_min !== undefined && b.temps_min !== null && b.temps_min !== "") {
    temps_min = Number(b.temps_min);
    if (!Number.isFinite(temps_min) || temps_min < 0) erreur("La durée doit être un nombre de minutes ≥ 0.");
  }
  const commune = b.commune ? 1 : 0;
  const produit_id = b.produit_id == null ? null : entier(b.produit_id, "produit", 1);
  const piece_id = b.piece_id == null ? null : entier(b.piece_id, "article", 1);
  if ((commune ? 1 : 0) + (produit_id ? 1 : 0) + (piece_id ? 1 : 0) !== 1) erreur("Une recette appartient à un produit, à un article, ou à toute une famille.");
  let famille_id: number;
  if (produit_id) famille_id = (await db.prepare("SELECT famille_id FROM produit WHERE id = ?").bind(produit_id).first<{ famille_id: number }>() ?? erreur("Produit introuvable.", 404)).famille_id;
  else if (piece_id) famille_id = (await db.prepare("SELECT famille_id FROM piece WHERE id = ?").bind(piece_id).first<{ famille_id: number }>() ?? erreur("Article introuvable.", 404)).famille_id;
  else famille_id = entier(b.famille_id, "famille", 1);

  const lignes: Ligne[] = (Array.isArray(b.lignes) ? b.lignes : erreur("Lignes manquantes.")).map((l: Record<string, unknown>) => {
    const sens = choix(l?.sens, ["utilise", "donne"] as const, "sens");
    const pid = l?.piece_id == null ? null : entier(l.piece_id, "élément", 1);
    const prid = l?.produit_id == null ? null : entier(l.produit_id, "produit", 1);
    if ((pid === null) === (prid === null)) erreur("Chaque ligne désigne un élément, ou un produit « de la même variante ».");
    if (prid !== null && !produit_id && !commune) erreur("« De la même variante » n'a de sens que dans la recette d'un produit à variantes.");
    return { sens, piece_id: pid, produit_id: prid, quantite: entier(l?.quantite, "quantité", 1) };
  });
  const formats: Format[] = commune ? (Array.isArray(b.formats) ? b.formats : []).map((f: Record<string, unknown>) => ({ variante: texte(f?.variante, "variante"), quantite: entier(f?.quantite, "quantité", 1) })) : [];
  if (commune && formats.length && lignes.some((l) => l.sens === "donne" && l.produit_id === null)) erreur("Une étape « une feuille → plusieurs formats » donne un produit à formats (ex. Tirage), ou directement les prints.");
  if (!commune && !lignes.some((l) => l.sens === "donne")) erreur("Une étape doit donner au moins quelque chose.");
  const ids = lignes.filter((l) => l.piece_id).map((l) => l.piece_id!);
  if (ids.length) {
    const { results } = await db.prepare(`SELECT id FROM piece WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    if (new Set(results.map((r) => (r as { id: number }).id)).size !== new Set(ids).size) erreur("Un élément de la recette est introuvable.", 404);
  }
  return { famille_id, produit_id, piece_id, commune, ordre: b.ordre == null ? null : entier(b.ordre, "ordre"), nom, mode, temps_min, lignes, formats };
}

function instructionsLignes(db: D1Database, ref: string, s: Saisie) {
  return [
    ...s.lignes.map((l) => db.prepare(`INSERT INTO recette_ligne (recette_etape_id, sens, piece_id, produit_id, quantite) VALUES (${ref}, ?, ?, ?, ?)`).bind(l.sens, l.piece_id, l.produit_id, l.quantite)),
    ...s.formats.map((f) => db.prepare(`INSERT INTO recette_format (recette_etape_id, variante, quantite) VALUES (${ref}, ?, ?)`).bind(f.variante, f.quantite)),
  ];
}

fiches.get("/recettes", async (c) => c.json(await lireRecettes(c.env.DB)));

fiches.post("/recettes", async (c) => {
  const db = c.env.DB;
  const b2 = await corps(c);
  const s = await lireSaisie(db, b2);
  const ordre = s.ordre ?? ((await db.prepare("SELECT COALESCE(MAX(ordre), -1) + 1 AS n FROM recette_etape WHERE famille_id = ?").bind(s.famille_id).first<{ n: number }>())!.n);
  const res = await db.batch([
    db.prepare("INSERT INTO recette_etape (famille_id, produit_id, piece_id, commune, ordre, nom, mode, temps_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(s.famille_id, s.produit_id, s.piece_id, s.commune, ordre, s.nom, s.mode, s.temps_min),
    ...instructionsLignes(db, "(SELECT MAX(id) FROM recette_etape)", s),
    db.prepare("SELECT MAX(id) AS id FROM recette_etape"),
  ]);
  const nouvelId = (res[res.length - 1].results[0] as { id: number }).id;
  // Placée avant une étape précise (ex. l'étape qui fabrique une fourniture maison, avant celle qui l'utilise).
  if (b2.avant_id != null) {
    const avant = entier(b2.avant_id, "étape", 1);
    const { results } = await db.prepare(
      "SELECT id, ordre FROM recette_etape WHERE famille_id = ? AND produit_id IS ? AND piece_id IS ? AND commune = ? ORDER BY ordre, id",
    ).bind(s.famille_id, s.produit_id, s.piece_id, s.commune).all<{ id: number; ordre: number }>();
    const ids = results.map((x) => x.id).filter((x) => x !== nouvelId);
    const k = ids.indexOf(avant);
    if (k >= 0) {
      ids.splice(k, 0, nouvelId);
      const base = Math.min(...results.map((x) => x.ordre));
      await db.batch(ids.map((x, n) => db.prepare("UPDATE recette_etape SET ordre = ? WHERE id = ?").bind(base + n, x)));
    }
  }
  await materialiser(db);
  return c.json({ ok: true, id: nouvelId }, 201);
});

fiches.put("/recettes/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const ex = await db.prepare("SELECT ordre FROM recette_etape WHERE id = ?").bind(id).first<{ ordre: number }>();
  if (!ex) erreur("Étape introuvable.", 404);
  const s = await lireSaisie(db, await corps(c));
  await db.batch([
    db.prepare("UPDATE recette_etape SET famille_id = ?, produit_id = ?, piece_id = ?, commune = ?, ordre = ?, nom = ?, mode = ?, temps_min = ? WHERE id = ?")
      .bind(s.famille_id, s.produit_id, s.piece_id, s.commune, s.ordre ?? ex.ordre, s.nom, s.mode, s.temps_min, id),
    db.prepare("DELETE FROM recette_ligne WHERE recette_etape_id = ?").bind(id),
    db.prepare("DELETE FROM recette_format WHERE recette_etape_id = ?").bind(id),
    ...instructionsLignes(db, String(id), s),
  ]);
  await materialiser(db);
  return c.json({ ok: true });
});

// Monter / descendre une étape (échange d'ordre avec sa voisine de la même recette).
fiches.post("/recettes/:id/deplacer", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const sens = choix((await corps(c)).sens, ["haut", "bas"] as const, "sens");
  const db = c.env.DB;
  const r = await db.prepare("SELECT id, famille_id, produit_id, piece_id, commune, ordre FROM recette_etape WHERE id = ?").bind(id)
    .first<{ id: number; famille_id: number; produit_id: number | null; piece_id: number | null; commune: number; ordre: number }>();
  if (!r) erreur("Étape introuvable.", 404);
  const { results } = await db.prepare(
    "SELECT id, ordre FROM recette_etape WHERE famille_id = ? AND produit_id IS ? AND piece_id IS ? AND commune = ? ORDER BY ordre, id",
  ).bind(r.famille_id, r.produit_id, r.piece_id, r.commune).all<{ id: number; ordre: number }>();
  const i = results.findIndex((x) => x.id === id), j = sens === "haut" ? i - 1 : i + 1;
  if (j < 0 || j >= results.length) return c.json({ ok: true });
  // Renumérote proprement la recette, puis échange.
  const ids = results.map((x) => x.id); [ids[i], ids[j]] = [ids[j], ids[i]];
  const base = Math.min(...results.map((x) => x.ordre));
  await db.batch(ids.map((x, k) => db.prepare("UPDATE recette_etape SET ordre = ? WHERE id = ?").bind(base + k, x)));
  await materialiser(db);
  return c.json({ ok: true });
});

fiches.delete("/recettes/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  await detacherEtapes(db, "recette_etape_id = ?", [id]);
  await db.batch([
    db.prepare("DELETE FROM recette_ligne WHERE recette_etape_id = ?").bind(id),
    db.prepare("DELETE FROM recette_format WHERE recette_etape_id = ?").bind(id),
    db.prepare("DELETE FROM recette_etape WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

/** Étapes générées à retirer : supprimées, ou rendues inertes (sans entrées ni sorties) si elles ont déjà été faites. */
export async function detacherEtapes(db: D1Database, condition: string, vals: unknown[]) {
  const { results } = await db.prepare(`SELECT e.id, EXISTS (SELECT 1 FROM etape_faite f WHERE f.etape_id = e.id) AS faite FROM etape e WHERE e.${condition}`)
    .bind(...vals).all<{ id: number; faite: number }>();
  if (!results.length) return;
  await db.batch(results.flatMap((r) => [
    db.prepare("DELETE FROM etape_choix WHERE etape_donne_id IN (SELECT id FROM etape_donne WHERE etape_id = ?)").bind(r.id),
    db.prepare("DELETE FROM etape_utilise WHERE etape_id = ?").bind(r.id),
    db.prepare("DELETE FROM etape_donne WHERE etape_id = ?").bind(r.id),
    r.faite ? db.prepare("UPDATE etape SET recette_etape_id = NULL WHERE id = ?").bind(r.id) : db.prepare("DELETE FROM etape WHERE id = ?").bind(r.id),
  ]));
}
