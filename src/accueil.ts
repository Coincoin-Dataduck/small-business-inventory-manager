// Accueil : rétro-planning de la préparation en cours.
// Jalons standards (dates par défaut calculées, déplaçables) + jalons ajoutés à la main.
// « Fait » est déduit quand l'outil peut le savoir ; avertissements sur l'ordre et les dates limites.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, texte, entier, corps, choix } from "./outils";
import { lirePreparation, fournituresSousSeuil } from "./preparation";
import { aujourdhui, debutPreparation } from "./salons";

export const accueil = new Hono<{ Bindings: Env }>();

const STANDARDS = ["objectifs", "commandes", "fabrication_debut", "fabrication_fin", "comptage", "bilan"] as const;
const NOMS: Record<string, string> = {
  objectifs: "Décider quoi produire", commandes: "Vérifier les fournitures et commander", fabrication_debut: "Début de la production",
  fabrication_fin: "Fin de la production", comptage: "Comptage avant", bilan: "Bilan",
};
const JOUR = 86_400_000;
const plus = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * JOUR).toISOString().slice(0, 10);
const ecart = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / JOUR);
const dateValide = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));
const fr = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

accueil.get("/accueil", async (c) => {
  const db = c.env.DB;
  const plan = await lirePreparation(db);
  const ajd = aujourdhui();
  const [qR] = await db.batch([db.prepare("SELECT COUNT(*) AS n FROM question WHERE repondu_le IS NULL")]);
  const questions = (qR.results[0] as { n: number }).n;
  const sousSeuil = await fournituresSousSeuil(db);
  if (!plan.preparation) return c.json({ preparation: null, aujourdhui: ajd, questions, sous_seuil: sousSeuil });

  const prep = plan.preparation;
  const salons = plan.salons;
  const premier = salons[0].date_debut;
  const dernierFin = salons.reduce((m, s) => (s.fin > m ? s.fin : m), salons[0].fin);

  const ph = prep.salon_ids.map(() => "?").join(",");
  // Comptage avant : avancement sur les articles à vendre (comptés depuis le début de la préparation, d'où qu'on ait compté).
  const { depuis, salon: depuisSalon } = await debutPreparation(db, ajd);
  const [jR, objR, cptR, espR] = await db.batch([
    db.prepare("SELECT id, type, nom, date, fait FROM jalon WHERE salon_id = ? ORDER BY date, id").bind(prep.id),
    db.prepare("SELECT COUNT(*) AS n FROM prep_production WHERE prep_id = ?").bind(prep.id),
    db.prepare(
      `SELECT COUNT(*) AS total, SUM(EXISTS (SELECT 1 FROM comptage_ligne cl JOIN comptage c ON c.id = cl.comptage_id
         WHERE cl.piece_id = p.id AND substr(c.date, 1, 10) >= ?1)) AS comptes
       FROM piece p WHERE p.niveau = 'a_vendre' AND p.suivi = 'quantite' AND p.retire = 0
         AND NOT (p.fin_de_serie = 1 AND ${STOCK_SQL} <= 0)`,
    ).bind(depuis),
    db.prepare(`SELECT COUNT(*) AS n FROM salon s WHERE s.id IN (${ph}) AND (s.especes_montant IS NOT NULL OR EXISTS (SELECT 1 FROM vente_especes ve WHERE ve.salon_id = s.id))`).bind(...prep.salon_ids),
  ]);
  const enregistres = jR.results as { id: number; type: string; nom: string | null; date: string; fait: number }[];
  const n = (r: D1Result) => (r.results[0] as { n: number }).n;

  // Date limite de commande : la plus tôt des « à commander avant » des fournitures à vérifier encore ouvertes.
  const aVerifier = plan.fournitures.filter((f) => !f.verifie);
  const aCommander = plan.fournitures.filter((f) => f.verifie && f.a_commander);
  const limites = [...aVerifier, ...aCommander].filter((l) => l.avant_le).map((l) => ({ nom: l.nom, avant_le: l.avant_le as string }));
  const limiteCommande = limites.reduce<string | null>((m, l) => (!m || l.avant_le < m ? l.avant_le : m), null);

  const defauts: Record<string, string> = {
    objectifs: plan.debut > ajd ? plan.debut : ajd,
    commandes: limiteCommande ?? plus(premier, -14),
    fabrication_debut: plan.debut > ajd ? plan.debut : ajd,
    comptage: plus(premier, -1),
    bilan: plus(dernierFin, 2),
  };
  const dateDe = (t: string) => enregistres.find((j) => j.type === t)?.date;
  const comptage = dateDe("comptage") ?? defauts.comptage;
  defauts.fabrication_fin = plus(comptage, -1);

  const cpt0 = cptR.results[0] as { total: number; comptes: number | null };
  const avComptage = { comptes: cpt0.comptes ?? 0, total: cpt0.total, depuis, depuis_salon: depuisSalon };
  const auto: Record<string, boolean> = {
    objectifs: n(objR) > 0,
    commandes: plan.fournitures.length > 0 && aVerifier.length === 0 && aCommander.length === 0,
    fabrication_debut: plan.checklist.some((x) => x.fait !== null),
    fabrication_fin: plan.checklist.length > 0 && plan.checklist.every((x) => x.fait !== null),
    comptage: avComptage.total > 0 && avComptage.comptes === avComptage.total,
    bilan: n(espR) === salons.length,
  };

  const jalons = [
    ...STANDARDS.map((t) => {
      const j = enregistres.find((x) => x.type === t);
      return { id: j?.id ?? null, type: t, nom: NOMS[t], date: j?.date ?? defauts[t], deplace: !!j, fait: auto[t] || !!j?.fait, fait_auto: auto[t] };
    }),
    ...enregistres.filter((j) => j.type === "perso").map((j) => ({ id: j.id, type: "perso", nom: j.nom ?? "", date: j.date, deplace: true, fait: !!j.fait, fait_auto: false })),
  ];
  const d = (t: string) => jalons.find((j) => j.type === t)!;
  type Avert = { type: string; id: number | null; texte: string };
  const avert: Avert[] = [];
  const cmd = d("commandes");
  if (!cmd.fait && limiteCommande && cmd.date > limiteCommande) {
    const enRetard = limites.filter((l) => l.avant_le < cmd.date).map((l) => `${l.nom} (avant le ${fr(l.avant_le)})`);
    avert.push({ type: "commandes", id: null, texte: `Commandes trop tard pour : ${enRetard.join(", ")}.` });
  }
  const fab0 = d("fabrication_debut"), fab1 = d("fabrication_fin"), cpt = d("comptage"), bil = d("bilan"), obj = d("objectifs");
  if (fab1.date < fab0.date) avert.push({ type: "fabrication_fin", id: null, texte: "La fabrication finit avant de commencer." });
  if (fab1.date >= cpt.date) avert.push({ type: "fabrication_fin", id: null, texte: "La fabrication finit après le comptage avant." });
  if (cpt.date >= premier) avert.push({ type: "comptage", id: null, texte: "Le comptage avant tombe pendant ou après le salon." });
  if (obj.date > fab0.date && !obj.fait) avert.push({ type: "objectifs", id: null, texte: "Les objectifs sont fixés après le début de la fabrication : la liste de ce qu'il faut produire n'est pas arrêtée." });
  if (bil.date <= dernierFin) avert.push({ type: "bilan", id: null, texte: "Le bilan est avant la fin du salon." });
  for (const j of jalons) if (!j.fait && j.date < ajd && j.type !== "fabrication_debut") avert.push({ type: j.type, id: j.id, texte: `« ${j.nom} » était prévu le ${fr(j.date)} et n'est pas fait.` });

  return c.json({
    preparation: prep, aujourdhui: ajd, salons, jalons, avertissements: avert, comptage: avComptage,
    production: {
      jours: Math.max(0, ecart(fab0.date, fab1.date) + 1),
      a_produire: plan.articles.filter((a) => a.a_produire > 0 && !a.achete).reduce((t, a) => t + a.a_produire, 0),
      lignes: plan.checklist.length, faites: plan.checklist.filter((x) => x.fait !== null).length,
    },
    fournitures: { a_verifier: aVerifier.length, a_commander: aCommander.length, total: plan.fournitures.length },
    sous_seuil: sousSeuil, questions,
  });
});

// Déplacer un jalon standard (date) ou le marquer fait ; date vide = revenir à la date par défaut.
accueil.put("/jalons/standard", async (c) => {
  const b = await corps(c);
  const salon_id = entier(b.salon_id, "préparation", 1);
  const type = choix(b.type, STANDARDS, "jalon");
  const db = c.env.DB;
  if (b.date === null) {
    await db.prepare("DELETE FROM jalon WHERE salon_id = ? AND type = ?").bind(salon_id, type).run();
    return c.json({ ok: true });
  }
  const date = b.date === undefined ? null : dateValide(b.date) ? (b.date as string) : erreur("Date invalide.");
  const fait = b.fait === undefined ? null : b.fait ? 1 : 0;
  const ex = await db.prepare("SELECT date FROM jalon WHERE salon_id = ? AND type = ?").bind(salon_id, type).first<{ date: string }>();
  if (!ex && !date) erreur("Date manquante.");
  await db.prepare(
    `INSERT INTO jalon (salon_id, type, date, fait) VALUES (?1, ?2, ?3, COALESCE(?4, 0))
     ON CONFLICT (salon_id, type) WHERE type <> 'perso' DO UPDATE SET date = COALESCE(?3, date), fait = COALESCE(?4, fait)`,
  ).bind(salon_id, type, date ?? ex!.date, fait).run();
  return c.json({ ok: true });
});

accueil.post("/jalons", async (c) => {
  const b = await corps(c);
  const salon_id = entier(b.salon_id, "préparation", 1);
  if (!dateValide(b.date)) erreur("Date invalide.");
  const r = await c.env.DB.prepare("INSERT INTO jalon (salon_id, type, nom, date) VALUES (?, 'perso', ?, ?) RETURNING id")
    .bind(salon_id, texte(b.nom, "nom"), b.date).first<{ id: number }>();
  return c.json({ id: r!.id }, 201);
});

accueil.patch("/jalons/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const sets: string[] = [], vals: unknown[] = [];
  if (b.nom !== undefined) { sets.push("nom = ?"); vals.push(texte(b.nom, "nom")); }
  if (b.date !== undefined) { if (!dateValide(b.date)) erreur("Date invalide."); sets.push("date = ?"); vals.push(b.date); }
  if (b.fait !== undefined) { sets.push("fait = ?"); vals.push(b.fait ? 1 : 0); }
  if (!sets.length) erreur("Rien à modifier.");
  const r = await c.env.DB.prepare(`UPDATE jalon SET ${sets.join(", ")} WHERE id = ? AND type = 'perso'`).bind(...vals, id).run();
  if (!r.meta.changes) erreur("Jalon introuvable.", 404);
  return c.json({ ok: true });
});

accueil.delete("/jalons/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const r = await c.env.DB.prepare("DELETE FROM jalon WHERE id = ? AND type = 'perso'").bind(id).run();
  if (!r.meta.changes) erreur("Jalon introuvable.", 404);
  return c.json({ ok: true });
});
