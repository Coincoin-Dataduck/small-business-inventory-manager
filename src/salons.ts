// Salons, préparations (déduites) et objectifs.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, texte, entier, corps } from "./outils";
import { recommander } from "./bilan";

export const salons = new Hono<{ Bindings: Env }>();

export type Salon = {
  id: number; nom: string; type: string | null; date_debut: string; nb_jours: number;
  frequentation: number | null; tampons_prevus: number | null; especes_montant: number | null;
  regroupe_avec_precedent: number | null;
};
export type SalonPlace = Salon & {
  fin: string; ecart_avant: number | null; propose: boolean | null; regroupe: boolean | null; manuel: boolean; preparation: number;
};
export type Preparation = { id: number; salon_ids: number[]; debut: string; fin: string; passee: boolean };
export type Reglages = { seuil_jours: number; marge: number; marge_unique: boolean; regroupement_auto: boolean };

const JOUR = 86_400_000;
const versJour = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / JOUR;
const versDate = (j: number) => new Date(j * JOUR).toISOString().slice(0, 10);
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Début de la préparation en cours, pour savoir ce qui a été compté « récemment » :
// le lendemain de la fin du dernier salon passé. Sans salon passé : aujourd'hui (seul compte ce qui est compté maintenant).
export async function debutPreparation(db: D1Database, ajd = aujourdhui()): Promise<{ depuis: string; salon: string | null }> {
  const r = await db.prepare(
    `SELECT nom, date(date_debut, '+' || (nb_jours - 1) || ' days', '+1 day') AS depuis
     FROM salon WHERE date(date_debut, '+' || (nb_jours - 1) || ' days') < ? ORDER BY depuis DESC, id DESC LIMIT 1`,
  ).bind(ajd).first<{ nom: string; depuis: string }>();
  return r ? { depuis: r.depuis, salon: r.nom } : { depuis: ajd, salon: null };
}

export async function lireReglages(db: D1Database): Promise<Reglages> {
  const { results } = await db.prepare("SELECT cle, valeur FROM reglage").all<{ cle: string; valeur: string }>();
  const r = new Map(results.map((x) => [x.cle, x.valeur]));
  return {
    seuil_jours: Number(r.get("seuil_jours") ?? 14),
    marge: Number(r.get("marge") ?? 0.3),
    marge_unique: (r.get("marge_unique") ?? "1") === "1",
    regroupement_auto: (r.get("regroupement_auto") ?? "1") === "1",
  };
}

/**
 * Regroupe les salons en préparations.
 * Écart = jours entre la fin d'un salon et le début du suivant. Proposé « ensemble » si écart < seuil.
 * Le choix manuel du salon (regroupe_avec_precedent) l'emporte sur la proposition.
 */
export function placerSalons(liste: Salon[], reg: Reglages, ajd = aujourdhui()) {
  const tries = [...liste].sort((a, b) => a.date_debut.localeCompare(b.date_debut) || a.id - b.id);
  const places: SalonPlace[] = [];
  const preparations: Preparation[] = [];
  tries.forEach((s, i) => {
    const fin = versDate(versJour(s.date_debut) + s.nb_jours - 1);
    let ecart: number | null = null, propose: boolean | null = null, regroupe: boolean | null = null;
    if (i > 0) {
      ecart = versJour(s.date_debut) - versJour(places[i - 1].fin);
      propose = reg.regroupement_auto && ecart < reg.seuil_jours;
      regroupe = s.regroupe_avec_precedent === null ? propose : s.regroupe_avec_precedent === 1;
    }
    if (!regroupe) preparations.push({ id: s.id, salon_ids: [], debut: s.date_debut, fin, passee: false });
    const prep = preparations[preparations.length - 1];
    prep.salon_ids.push(s.id);
    if (fin > prep.fin) prep.fin = fin;
    places.push({ ...s, fin, ecart_avant: ecart, propose, regroupe, manuel: i > 0 && s.regroupe_avec_precedent !== null, preparation: prep.id });
  });
  for (const p of preparations) p.passee = p.fin < ajd;
  const enCours = preparations.find((p) => !p.passee) ?? null;
  return { salons: places, preparations, en_cours: enCours?.id ?? null };
}

async function tousLesSalons(db: D1Database) {
  const { results } = await db.prepare("SELECT * FROM salon").all<Salon>();
  return results;
}

export async function preparationsActuelles(db: D1Database) {
  const [liste, reg] = await Promise.all([tousLesSalons(db), lireReglages(db)]);
  return { ...placerSalons(liste, reg), reglages: reg };
}

/** Quantité à avoir pour une préparation : somme des objectifs des salons + marge (une seule fois si réglé ainsi). */
export function aAvoir(retenus: number[], reg: Reglages) {
  if (!retenus.length) return 0;
  if (reg.marge_unique) return Math.ceil(retenus.reduce((a, b) => a + b, 0) * (1 + reg.marge) - 1e-9);
  return retenus.reduce((t, r) => t + Math.ceil(r * (1 + reg.marge) - 1e-9), 0);
}

function lireSalon(b: Record<string, unknown>, partiel = false) {
  const champs: Record<string, unknown> = {};
  const opt = (k: string) => b[k] !== undefined;
  if (!partiel || opt("nom")) champs.nom = texte(b.nom, "nom");
  if (!partiel || opt("date_debut")) {
    const d = texte(b.date_debut, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(versJour(d)) || versDate(versJour(d)) !== d) erreur("Date invalide (format AAAA-MM-JJ).");
    champs.date_debut = d;
  }
  if (!partiel || opt("nb_jours")) champs.nb_jours = b.nb_jours === undefined ? 1 : entier(b.nb_jours, "nombre de jours", 1);
  if (opt("type")) champs.type = b.type === null || b.type === "" ? null : texte(b.type, "type");
  for (const k of ["frequentation", "tampons_prevus"] as const)
    if (opt(k)) champs[k] = b[k] === null || b[k] === "" ? null : entier(b[k], k === "frequentation" ? "fréquentation" : "tampons prévus", 0);
  if (opt("especes_montant")) {
    const v = b.especes_montant === null || b.especes_montant === "" ? null : Number(b.especes_montant);
    if (v !== null && (!Number.isFinite(v) || v < 0)) erreur("Montant des espèces invalide.");
    champs.especes_montant = v;
  }
  return champs;
}

// ───────────── Salons ─────────────
salons.get("/salons", async (c) => {
  const db = c.env.DB;
  const [etat, comptages, objectifs] = await Promise.all([
    preparationsActuelles(db),
    db.prepare("SELECT salon_id, MAX(date) AS date FROM comptage WHERE type = 'avant' AND salon_id IS NOT NULL GROUP BY salon_id").all<{ salon_id: number; date: string }>(),
    db.prepare("SELECT salon_id, COUNT(*) AS n FROM objectif GROUP BY salon_id").all<{ salon_id: number; n: number }>(),
  ]);
  const cpt = new Map(comptages.results.map((x) => [x.salon_id, x.date]));
  const obj = new Map(objectifs.results.map((x) => [x.salon_id, x.n]));
  return c.json({
    aujourdhui: aujourdhui(), ...etat,
    preparations: etat.preparations.map((p) => ({
      ...p,
      comptage_avant: cpt.get(p.id) ?? null,
      nb_objectifs: p.salon_ids.reduce((t, id) => t + (obj.get(id) ?? 0), 0),
    })),
  });
});

salons.post("/salons", async (c) => {
  const champs = lireSalon(await corps(c));
  const cles = Object.keys(champs);
  const r = await c.env.DB.prepare(`INSERT INTO salon (${cles.join(", ")}) VALUES (${cles.map(() => "?").join(", ")}) RETURNING id`)
    .bind(...Object.values(champs)).first<{ id: number }>();
  return c.json({ id: r!.id }, 201);
});

salons.patch("/salons/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const champs = lireSalon(await corps(c), true);
  const cles = Object.keys(champs);
  if (!cles.length) erreur("Rien à modifier.");
  const r = await c.env.DB.prepare(`UPDATE salon SET ${cles.map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...Object.values(champs), id).run();
  if (!r.meta.changes) erreur("Salon introuvable.", 404);
  return c.json({ ok: true });
});

// Séparer / Regrouper avec le salon précédent ; null = revenir à la proposition.
salons.put("/salons/:id/regroupement", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  if (![true, false, null].includes(b.regroupe as boolean | null)) erreur("« regroupe » doit valoir oui, non ou vide.");
  const v = b.regroupe === null ? null : b.regroupe ? 1 : 0;
  const r = await c.env.DB.prepare("UPDATE salon SET regroupe_avec_precedent = ? WHERE id = ?").bind(v, id).run();
  if (!r.meta.changes) erreur("Salon introuvable.", 404);
  return c.json({ ok: true });
});

salons.delete("/salons/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const lie = await db.prepare(
    "SELECT (SELECT COUNT(*) FROM vente WHERE salon_id = ?1) + (SELECT COUNT(*) FROM comptage WHERE salon_id = ?1) + (SELECT COUNT(*) FROM vente_especes WHERE salon_id = ?1) AS n",
  ).bind(id).first<{ n: number }>();
  if (lie && lie.n > 0) erreur("Ce salon a déjà des ventes ou des comptages : il ne peut plus être supprimé.", 409);
  const r = await db.prepare("DELETE FROM salon WHERE id = ?").bind(id).run();
  if (!r.meta.changes) erreur("Salon introuvable.", 404);
  return c.json({ ok: true });
});

// ───────────── Objectifs ─────────────
export async function lireObjectifs(db: D1Database, prepId: number) {
  const etat = await preparationsActuelles(db);
  const prep = etat.preparations.find((p) => p.id === prepId);
  if (!prep) erreur("Préparation introuvable.", 404);
  const salonsPrep = etat.salons.filter((s) => prep.salon_ids.includes(s.id));
  const ph = prep.salon_ids.map(() => "?").join(",");
  const [articles, objectifs] = await db.batch([
    db.prepare(
      `SELECT p.id, p.nom, f.id AS famille_id, f.nom AS famille, ${STOCK_SQL} AS stock
       FROM piece p JOIN famille f ON f.id = p.famille_id
       WHERE p.niveau = 'a_vendre' AND p.suivi = 'quantite' AND p.fin_de_serie = 0 AND p.retire = 0
       ORDER BY f.ordre, f.nom, p.nom`,
    ),
    db.prepare(`SELECT salon_id, piece_id, retenu, conseille, calcul FROM objectif WHERE salon_id IN (${ph})`).bind(...prep.salon_ids),
  ]);
  const obj = new Map((objectifs.results as { salon_id: number; piece_id: number; retenu: number; conseille: number | null }[]).map((o) => [`${o.salon_id}:${o.piece_id}`, o]));
  const reco = await recommander(db, salonsPrep);
  const lignes = (articles.results as { id: number; nom: string; famille_id: number; famille: string; stock: number }[]).map((a) => {
    const par_salon = salonsPrep.map((s) => {
      const o = obj.get(`${s.id}:${a.id}`);
      const r = reco.conseils.get(`${s.id}:${a.id}`);
      return { salon_id: s.id, retenu: o?.retenu ?? null, conseille: r?.conseille ?? null, calcul: r?.calcul ?? null };
    });
    const retenus = par_salon.filter((x) => x.retenu !== null).map((x) => x.retenu!);
    return { ...a, par_salon, a_avoir: aAvoir(retenus, etat.reglages) };
  });
  return { preparation: prep, salons: salonsPrep, reglages: etat.reglages, articles: lignes, tampons_prevus: reco.tampons_prevus, confiance: reco.confiance };
}

salons.get("/preparations/:id/objectifs", async (c) => c.json(await lireObjectifs(c.env.DB, entier(c.req.param("id"), "id", 1))));

// Fixe l'objectif retenu d'un article pour un salon ; retenu = null efface.
salons.put("/objectifs", async (c) => {
  const b = await corps(c);
  const salon_id = entier(b.salon_id, "salon", 1);
  const piece_id = entier(b.piece_id, "article", 1);
  const db = c.env.DB;
  if (b.retenu === null || b.retenu === "") {
    await db.prepare("DELETE FROM objectif WHERE salon_id = ? AND piece_id = ?").bind(salon_id, piece_id).run();
    return c.json({ ok: true });
  }
  const retenu = entier(b.retenu, "objectif", 0);
  const art = await db.prepare("SELECT niveau, suivi FROM piece WHERE id = ?").bind(piece_id).first<{ niveau: string; suivi: string }>();
  if (!art) erreur("Article introuvable.", 404);
  if (art.niveau !== "a_vendre" || art.suivi !== "quantite") erreur("Seuls les articles à vendre comptés à la pièce ont un objectif.");
  if (!(await db.prepare("SELECT 1 FROM salon WHERE id = ?").bind(salon_id).first())) erreur("Salon introuvable.", 404);
  await db.prepare(
    "INSERT INTO objectif (salon_id, piece_id, retenu) VALUES (?, ?, ?) ON CONFLICT (salon_id, piece_id) DO UPDATE SET retenu = excluded.retenu",
  ).bind(salon_id, piece_id, retenu).run();
  return c.json({ ok: true });
});

// Plusieurs objectifs d'un coup (« Prendre les conseillés »).
salons.put("/objectifs/lot", async (c) => {
  const b = await corps(c);
  if (!Array.isArray(b.lignes) || !b.lignes.length) erreur("Aucun objectif.");
  const lignes = (b.lignes as Record<string, unknown>[]).map((l) => ({
    salon_id: entier(l?.salon_id, "salon", 1), piece_id: entier(l?.piece_id, "article", 1), retenu: entier(l?.retenu, "objectif", 0),
  }));
  const db = c.env.DB;
  const ids = [...new Set(lignes.map((l) => l.piece_id))];
  const { results } = await db.prepare(`SELECT id FROM piece WHERE niveau = 'a_vendre' AND suivi = 'quantite' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  if (results.length !== ids.length) erreur("Seuls les articles à vendre comptés à la pièce ont un objectif.");
  await db.batch(lignes.map((l) => db.prepare(
    "INSERT INTO objectif (salon_id, piece_id, retenu) VALUES (?, ?, ?) ON CONFLICT (salon_id, piece_id) DO UPDATE SET retenu = excluded.retenu",
  ).bind(l.salon_id, l.piece_id, l.retenu)));
  return c.json({ ok: true, n: lignes.length });
});
