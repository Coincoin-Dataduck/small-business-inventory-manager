import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Env, NIVEAUX, SUIVIS, STOCK_SQL, erreur, texte, entier, choix, corps, lireLignesComptage, lirePieces, instructionsComptage } from "./outils";
import { recettes } from "./recettes";
import { salons, debutPreparation } from "./salons";
import { atelier } from "./atelier";
import { questions } from "./questions";
import { bilan, familleThermometre } from "./bilan";
import { achats } from "./achats";
import { accueil } from "./accueil";
import { fiches, materialiser, detacherEtapes } from "./fiches";
import { importer } from "./sumup";
import { controlerAcces } from "./acces";
// @ts-expect-error : importé comme texte (règle « Text » de wrangler.jsonc)
import PAGE from "../public/index.html";
// @ts-expect-error : idem
import STYLE from "../public/style.css";
// @ts-expect-error : idem
import SCRIPT from "../public/app.js";

const empreintes = new Map<string, string>();
async function empreinte(contenu: string) {
  let e = empreintes.get(contenu);
  if (!e) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contenu)));
    e = '"' + [...h.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join("") + '"';
    empreintes.set(contenu, e);
  }
  return e;
}

const FICHIERS: Record<string, [string, string]> = {
  "/style.css": [STYLE as string, "text/css; charset=utf-8"],
  "/app.js": [SCRIPT as string, "text/javascript; charset=utf-8"],
};
const app = new Hono<{ Bindings: Env }>().basePath("/api");

// ───────────── Familles ─────────────
app.get("/familles", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, nom, ordre, modele_non_precise, variantes FROM famille ORDER BY ordre, nom").all<{ variantes: string | null }>();
  return c.json(results.map((f) => ({ ...f, variantes: lireVariantes(f.variantes) })));
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
  if (b.modele_non_precise !== undefined) { sets.push("modele_non_precise = ?"); vals.push(b.modele_non_precise ? 1 : 0); }
  if (b.variantes !== undefined) { const v = listeVariantes(b.variantes); sets.push("variantes = ?"); vals.push(v.length ? JSON.stringify(v) : null); }
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
  if (b.retire !== undefined) { sets.push("retire = ?"); vals.push(b.retire ? 1 : 0); }
  if (!sets.length) erreur("Rien à modifier.");
  try {
    const r = await c.env.DB.prepare(`UPDATE piece SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
    if (!r.meta.changes) erreur("Article ou fourniture introuvable.", 404);
  } catch (e) {
    if (String(e).includes("UNIQUE")) erreur("Ce nom existe déjà dans cette famille.", 409);
    if (String(e).includes("FOREIGN KEY")) erreur("Famille introuvable.", 404);
    throw e;
  }
  if (b.retire !== undefined || b.niveau !== undefined || b.famille_id !== undefined) await materialiser(c.env.DB);
  return c.json({ ok: true });
});

// ───────────── Produits à variantes ─────────────
// Un produit (« La salamandre ») regroupe des variantes (A3, A4, A5) ; chaque variante est une ligne de stock
// dont le nom complet est « <produit> <variante> ».
function lireVariantes(v: string | null): string[] {
  try { const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
function listeVariantes(v: unknown): string[] {
  const brut = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : erreur("Variantes : une liste, ex. A3, A4, A5.");
  const vus = new Set<string>(), out: string[] = [];
  for (const x of brut) { const t = String(x).trim(); if (t && !vus.has(t.toLowerCase())) { vus.add(t.toLowerCase()); out.push(t); } }
  return out;
}

app.post("/produits", async (c) => {
  const b = await corps(c);
  const nom = texte(b.nom, "nom");
  const famille_id = entier(b.famille_id, "famille", 1);
  const niveau = choix(b.niveau, NIVEAUX, "niveau");
  const suivi = b.suivi === undefined ? "quantite" : choix(b.suivi, SUIVIS, "suivi");
  const variantes = listeVariantes(b.variantes ?? []);
  if (!variantes.length) erreur("Indiquez au moins une variante (ou ajoutez un article simple).");
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM famille WHERE id = ?").bind(famille_id).first())) erreur("Famille introuvable.", 404);
  const deja = await db.prepare(`SELECT nom FROM piece WHERE famille_id = ? AND nom IN (${variantes.map(() => "?").join(",")})`)
    .bind(famille_id, ...variantes.map((v) => `${nom} ${v}`)).all<{ nom: string }>();
  if (deja.results.length) erreur(`Existe déjà : ${deja.results.map((r) => r.nom).join(", ")}.`, 409);
  const pr = await db.prepare("INSERT INTO produit (famille_id, nom) VALUES (?, ?) ON CONFLICT (famille_id, nom) DO UPDATE SET nom = excluded.nom RETURNING id")
    .bind(famille_id, nom).first<{ id: number }>();
  const res = await db.batch(variantes.map((v) =>
    db.prepare("INSERT INTO piece (nom, famille_id, niveau, suivi, produit_id, variante) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(`${nom} ${v}`, famille_id, niveau, suivi, pr!.id, v)));
  await materialiser(db);
  return c.json({ id: pr!.id, pieces: res.map((r, i) => ({ id: (r.results[0] as { id: number }).id, variante: variantes[i] })) }, 201);
});

// Ajouter une variante à un produit : même type et même suivi que ses autres variantes.
app.post("/produits/:id/variantes", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const variante = texte(b.variante, "variante");
  const db = c.env.DB;
  const pr = await db.prepare(
    "SELECT pr.nom, pr.famille_id, (SELECT niveau FROM piece WHERE produit_id = pr.id LIMIT 1) AS niveau, (SELECT suivi FROM piece WHERE produit_id = pr.id LIMIT 1) AS suivi FROM produit pr WHERE pr.id = ?",
  ).bind(id).first<{ nom: string; famille_id: number; niveau: string | null; suivi: string | null }>();
  if (!pr) erreur("Produit introuvable.", 404);
  const niveau = b.niveau !== undefined ? choix(b.niveau, NIVEAUX, "niveau") : pr.niveau ?? "a_vendre";
  const r = await db.prepare(
    "INSERT INTO piece (nom, famille_id, niveau, suivi, produit_id, variante) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (famille_id, nom) DO NOTHING RETURNING id",
  ).bind(`${pr.nom} ${variante}`, pr.famille_id, niveau, pr.suivi ?? "quantite", id, variante).first<{ id: number }>();
  if (!r) erreur(`« ${pr.nom} ${variante} » existe déjà.`, 409);
  await materialiser(db);
  return c.json({ id: r.id }, 201);
});

// Renommer un produit renomme toutes ses variantes.
app.patch("/produits/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const nom = texte((await corps(c)).nom, "nom");
  const db = c.env.DB;
  try {
    const [r] = await db.batch([
      db.prepare("UPDATE produit SET nom = ? WHERE id = ?").bind(nom, id),
      db.prepare("UPDATE piece SET nom = ? || ' ' || variante WHERE produit_id = ?").bind(nom, id),
    ]);
    if (!r.meta.changes) erreur("Produit introuvable.", 404);
  } catch (e) {
    if (String(e).includes("UNIQUE")) erreur("Ce nom existe déjà dans cette famille.", 409);
    throw e;
  }
  await materialiser(db);
  return c.json({ ok: true });
});

// ───────────── Supprimer / retirer ─────────────
// Jamais vendu : vraiment supprimé (comptages et réserves compris : ça peut être une erreur de saisie).
// Déjà vendu : retiré (absent du stock, du comptage et des calculs ; les ventes restent dans les bilans).
// Dans les deux cas, il est enlevé des étapes où il apparaît (l'écran prévient avant).
async function etatSuppression(db: D1Database, id: number) {
  const [pR, vR, eR] = await db.batch([
    db.prepare("SELECT id, nom, produit_id FROM piece WHERE id = ?").bind(id),
    db.prepare("SELECT EXISTS (SELECT 1 FROM mouvement WHERE piece_id = ? AND motif IN ('vente', 'vente_especes')) AS vendu").bind(id),
    db.prepare(
      `SELECT DISTINCT e.nom FROM etape e WHERE (e.pour_piece_id IS NULL OR e.pour_piece_id <> ?1) AND e.id IN (
         SELECT etape_id FROM etape_utilise WHERE piece_id = ?1 UNION SELECT etape_id FROM etape_donne WHERE piece_id = ?1
         UNION SELECT d.etape_id FROM etape_choix c JOIN etape_donne d ON d.id = c.etape_donne_id WHERE c.piece_id = ?1) ORDER BY e.nom`,
    ).bind(id),
  ]);
  const p = pR.results[0] as { id: number; nom: string; produit_id: number | null } | undefined;
  if (!p) erreur("Article ou fourniture introuvable.", 404);
  return { ...p, vendu: !!(vR.results[0] as { vendu: number }).vendu, etapes: (eR.results as { nom: string }[]).map((e) => e.nom) };
}

app.get("/pieces/:id/suppression", async (c) => {
  const e = await etatSuppression(c.env.DB, entier(c.req.param("id"), "id", 1));
  return c.json({ nom: e.nom, vendu: e.vendu, etapes: e.etapes });
});

app.delete("/pieces/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const e = await etatSuppression(db, id);
  // Recettes : lignes qui le citent, et étapes de sa propre recette (article simple).
  await detacherEtapes(db, "pour_piece_id = ? AND recette_etape_id IS NOT NULL", [id]);
  const horsEtapes = [
    db.prepare("DELETE FROM recette_ligne WHERE piece_id = ?").bind(id),
    db.prepare("DELETE FROM recette_format WHERE recette_etape_id IN (SELECT id FROM recette_etape WHERE piece_id = ?)").bind(id),
    db.prepare("DELETE FROM recette_ligne WHERE recette_etape_id IN (SELECT id FROM recette_etape WHERE piece_id = ?)").bind(id),
    db.prepare("DELETE FROM recette_etape WHERE piece_id = ?").bind(id),
    db.prepare("DELETE FROM etape_utilise WHERE piece_id = ?").bind(id),
    db.prepare("DELETE FROM etape_choix WHERE piece_id = ?").bind(id),
    db.prepare("DELETE FROM etape_donne WHERE piece_id = ?").bind(id),
  ];
  if (e.vendu) {
    await db.batch([
      ...horsEtapes,
      db.prepare("DELETE FROM objectif WHERE piece_id = ? AND salon_id IN (SELECT id FROM salon WHERE date_debut >= date('now'))").bind(id),
      db.prepare("UPDATE piece SET retire = 1 WHERE id = ?").bind(id),
    ]);
    await materialiser(db);
    return c.json({ action: "retire", etapes: e.etapes });
  }
  await db.batch([
    ...horsEtapes,
    ...["mouvement", "comptage_ligne", "objectif", "bilan_article", "correspondance_piece", "question", "commande", "achat_ajustement", "piece_lot"]
      .map((t) => db.prepare(`DELETE FROM ${t} WHERE piece_id = ?`).bind(id)),
    db.prepare("DELETE FROM piece WHERE id = ?").bind(id),
  ]);
  // Produit sans plus aucune variante : on retire aussi ses recettes et le produit.
  if (e.produit_id && !(await db.prepare("SELECT 1 FROM piece WHERE produit_id = ?").bind(e.produit_id).first())) {
    await detacherEtapes(db, "recette_etape_id IN (SELECT id FROM recette_etape WHERE produit_id = ?)", [e.produit_id]);
    await db.batch([
      db.prepare("DELETE FROM recette_ligne WHERE produit_id = ? OR recette_etape_id IN (SELECT id FROM recette_etape WHERE produit_id = ?)").bind(e.produit_id, e.produit_id),
      db.prepare("DELETE FROM recette_etape WHERE produit_id = ?").bind(e.produit_id),
      db.prepare("DELETE FROM produit WHERE id = ?").bind(e.produit_id),
    ]);
  }
  await materialiser(db);
  return c.json({ action: "supprime", etapes: e.etapes });
});

app.get("/pieces/retires", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT p.id, p.nom, f.nom AS famille FROM piece p JOIN famille f ON f.id = p.famille_id WHERE p.retire = 1 ORDER BY f.ordre, p.nom").all();
  return c.json(results);
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
    c.env.DB.prepare("SELECT id, nom, ordre, modele_non_precise, variantes FROM famille ORDER BY ordre, nom"),
    c.env.DB.prepare(
      `SELECT p.id, p.nom, p.famille_id, p.niveau, p.suivi, p.fin_de_serie, p.presque_vide, ${STOCK_SQL} AS stock,
         p.produit_id, p.variante, (SELECT nom FROM produit WHERE id = p.produit_id) AS produit,
         (SELECT substr(MAX(c.date), 1, 10) FROM comptage_ligne cl JOIN comptage c ON c.id = cl.comptage_id WHERE cl.piece_id = p.id) AS dernier_comptage
       FROM piece p WHERE p.retire = 0 ORDER BY CASE p.niveau WHEN 'a_vendre' THEN 0 WHEN 'fait_maison' THEN 1 WHEN 'achete' THEN 2 ELSE 3 END,
         COALESCE((SELECT nom FROM produit WHERE id = p.produit_id), p.nom), p.variante, p.nom`,
    ),
  ]);
  const parFamille = new Map<number, unknown[]>();
  for (const p of pieces.results as { famille_id: number }[]) {
    if (!parFamille.has(p.famille_id)) parFamille.set(p.famille_id, []);
    parFamille.get(p.famille_id)!.push(p);
  }
  return c.json((fams.results as { id: number; variantes: string | null }[]).map((f) => ({ ...f, variantes: lireVariantes(f.variantes), pieces: parFamille.get(f.id) ?? [] })));
});

// ───────────── Compter ─────────────
// « Pas encore compté » = pas de comptage depuis le début de la préparation en cours.
app.get("/comptages/etat", async (c) => c.json(await debutPreparation(c.env.DB)));

// Une seule façon de corriger un chiffre : on tape le vrai, l'outil enregistre la différence.
app.post("/comptages", async (c) => {
  const b = await corps(c);
  const type = b.type === undefined ? "libre" : choix(b.type, ["libre", "avant"] as const, "type");
  const salon_id = b.salon_id == null ? null : entier(b.salon_id, "salon", 1);
  if (type === "avant" && salon_id === null) erreur("Un comptage avant doit indiquer le salon.");
  const lignes = lireLignesComptage(b.lignes);
  if (!lignes.length) erreur("Aucune quantité comptée.");
  const pieces = await lirePieces(c.env.DB, lignes.map((l) => l.piece_id));
  if ([...pieces.values()].some((p) => p.suivi !== "quantite")) erreur("Cet élément ne se compte pas (sans quantité ou générique).");

  const db = c.env.DB;
  const res = await db.batch([
    ...instructionsComptage(db, lignes, type, salon_id),
    db.prepare(
      "SELECT cl.id, cl.piece_id, p.nom, cl.attendu, cl.compte, cl.compte - cl.attendu AS ecart, cl.comptage_id FROM comptage_ligne cl JOIN piece p ON p.id = cl.piece_id WHERE cl.comptage_id = (SELECT MAX(id) FROM comptage)",
    ),
  ]);
  const detail = res[res.length - 1].results as { ecart: number; comptage_id: number }[];
  return c.json({ comptage_id: detail[0]?.comptage_id, lignes: detail, ecarts: detail.filter((d) => d.ecart !== 0).length }, 201);
});

// Annuler une ligne de comptage (« ↺ pas compté finalement ») : son mouvement de correction disparaît.
app.delete("/comptages/lignes/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const l = await db.prepare("SELECT comptage_id FROM comptage_ligne WHERE id = ?").bind(id).first<{ comptage_id: number }>();
  if (!l) erreur("Ligne de comptage introuvable.", 404);
  await db.batch([
    db.prepare("DELETE FROM mouvement WHERE source_type = 'comptage_ligne' AND source_id = ?").bind(id),
    db.prepare("DELETE FROM comptage_ligne WHERE id = ?").bind(id),
    db.prepare("DELETE FROM comptage WHERE id = ? AND NOT EXISTS (SELECT 1 FROM comptage_ligne WHERE comptage_id = ?)").bind(l.comptage_id, l.comptage_id),
  ]);
  return c.json({ ok: true });
});

// ───────────── Réglages (clé / valeur) ─────────────
const REGLAGES_MODIFIABLES = ["famille_thermometre", "seuil_jours", "marge", "marge_unique", "regroupement_auto", "tampons_min_ratio", "fond_caisse"];
app.get("/reglages", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT cle, valeur FROM reglage").all<{ cle: string; valeur: string }>();
  const r = Object.fromEntries(results.filter((x) => REGLAGES_MODIFIABLES.includes(x.cle)).map((x) => [x.cle, x.valeur]));
  return c.json({ ...r, famille_thermometre_effectif: await familleThermometre(c.env.DB) });
});
app.put("/reglages", async (c) => {
  const b = await corps(c);
  const cle = choix(b.cle, REGLAGES_MODIFIABLES, "réglage");
  if (b.valeur === null || b.valeur === "") await c.env.DB.prepare("DELETE FROM reglage WHERE cle = ?").bind(cle).run();
  else {
    const v = Number(b.valeur);
    if (!Number.isFinite(v) || v < 0) erreur("Valeur invalide.");
    await c.env.DB.prepare("INSERT INTO reglage (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur").bind(cle, String(v)).run();
  }
  return c.json({ ok: true });
});

app.route("/", recettes);
app.route("/", salons);
app.route("/", atelier);
app.route("/", questions);
app.route("/", bilan);
app.route("/", achats);
app.route("/", accueil);
app.route("/", fiches);

// Version de l'interface (empreinte du script et du style) : une page restée ouverte sait qu'il faut recharger.
app.get("/version", async (c) => c.json({ version: await empreinte((SCRIPT as string) + (STYLE as string)) }));

app.onError((e, c) => {
  if (e instanceof HTTPException) return c.json({ erreur: e.message }, e.status);
  console.error(e);
  return c.json({ erreur: "Erreur inattendue côté serveur." }, 500);
});
app.notFound((c) => c.json({ erreur: "Adresse inconnue." }, 404));

export default {
  // Tout passe par le verrou Access, pages comprises ; puis l'API ou les fichiers de l'interface.
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const refus = await controlerAcces(req, env);
    if (refus) return refus;
    if (new URL(req.url).pathname.startsWith("/api/")) return app.fetch(req, env, ctx);
    const [contenu, type] = FICHIERS[new URL(req.url).pathname] ?? [PAGE as string, "text/html; charset=utf-8"];
    // Le navigateur garde les fichiers et redemande seulement « a-t-il changé ? » (réponse 304, vide).
    const etag = await empreinte(contenu);
    if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(contenu, { headers: { "Content-Type": type, "Cache-Control": "private, no-cache", ETag: etag } });
  },
  // Cron : import des ventes SumUp par tranches.
  async scheduled(_evt: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(importer(env, 40).then((b) => { if (b.erreur) console.error("Import SumUp :", b.erreur); }));
  },
} satisfies ExportedHandler<Env>;
