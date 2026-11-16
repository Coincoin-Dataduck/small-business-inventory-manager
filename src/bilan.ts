// Bilan des salons et objectifs conseillés (méthode : docs/historique-salons.md).
// Ventes d'un salon = carte (SumUp, rattachée par la date) + espèces saisies, par nom de caisse,
// traduites en pièces par les correspondances. Les noms « Ne pas suivre » (ventes de Lucile…) sont exclus.
import { Hono } from "hono";
import { Env, erreur, entier, corps } from "./outils";
import { aujourdhui, lireReglages, Salon } from "./salons";
import { appliquerEspeces } from "./sumup";

export const bilan = new Hono<{ Bindings: Env }>();

type Corr = { ne_pas_suivre: boolean; equivalent_tampons: number; pieces: { piece_id: number; quantite: number }[] };
type PieceStat = { id: number; nom: string; famille_id: number; famille: string; niveau: string; suivi: string; fin_de_serie: number };
export type StatSalon = {
  salon: Salon & { fin: string };
  jours: { jour: string; suivi: number; autres: number; a_relier: number }[];
  carte_suivi: number; especes_montant: number | null; especes_saisies: boolean;
  tampons: { carte: number; especes: number; total: number; pour_1000: number | null };
  vendus: Map<number, { carte: number; especes: number }>;
  mal_expose: Set<number>;
  noms_a_relier: number;
};

export async function statistiques(db: D1Database) {
  const finSql = "date(s.date_debut, '+' || (s.nb_jours - 1) || ' days')";
  const [salonsR, carte, especes, corrR, cpR, piecesR, malR] = await db.batch([
    db.prepare(`SELECT s.*, ${finSql} AS fin FROM salon s ORDER BY s.date_debut`),
    db.prepare(
      `SELECT s.id AS salon_id, v.jour, vl.cle, SUM(vl.quantite) AS q, SUM(vl.quantite * COALESCE(vl.prix, 0)) AS montant
       FROM vente_ligne vl JOIN vente v ON v.id = vl.vente_id
       JOIN salon s ON v.jour BETWEEN s.date_debut AND ${finSql}
       GROUP BY s.id, v.jour, vl.cle`,
    ),
    db.prepare("SELECT salon_id, cle, quantite AS q FROM vente_especes"),
    db.prepare("SELECT cle, ne_pas_suivre, equivalent_tampons FROM correspondance"),
    db.prepare("SELECT cle, piece_id, quantite FROM correspondance_piece"),
    db.prepare("SELECT p.id, p.nom, p.famille_id, f.nom AS famille, p.niveau, p.suivi, p.fin_de_serie FROM piece p JOIN famille f ON f.id = p.famille_id"),
    db.prepare("SELECT salon_id, piece_id FROM bilan_article WHERE mal_expose = 1"),
  ]);
  const corr = new Map<string, Corr>();
  for (const c of corrR.results as { cle: string; ne_pas_suivre: number; equivalent_tampons: number }[])
    corr.set(c.cle, { ne_pas_suivre: !!c.ne_pas_suivre, equivalent_tampons: c.equivalent_tampons, pieces: [] });
  for (const p of cpR.results as { cle: string; piece_id: number; quantite: number }[]) corr.get(p.cle)?.pieces.push(p);
  const pieces = new Map((piecesR.results as PieceStat[]).map((p) => [p.id, p]));
  const estArticle = (pid: number) => { const p = pieces.get(pid); return !!p && p.niveau === "a_vendre" && p.suivi === "quantite"; };

  const stats = new Map<number, StatSalon>();
  for (const s of salonsR.results as (Salon & { fin: string })[]) {
    stats.set(s.id, {
      salon: s, jours: [], carte_suivi: 0, especes_montant: s.especes_montant, especes_saisies: false,
      tampons: { carte: 0, especes: 0, total: 0, pour_1000: null }, vendus: new Map(), mal_expose: new Set(), noms_a_relier: 0,
    });
  }
  const aRelier = new Map<number, Set<string>>();
  const compter = (st: StatSalon, cle: string, q: number, mode: "carte" | "especes") => {
    const c = corr.get(cle);
    if (!c || c.ne_pas_suivre) return;
    st.tampons[mode] += q * c.equivalent_tampons;
    for (const p of c.pieces) {
      if (!estArticle(p.piece_id)) continue;
      const v = st.vendus.get(p.piece_id) ?? st.vendus.set(p.piece_id, { carte: 0, especes: 0 }).get(p.piece_id)!;
      v[mode] += q * p.quantite;
    }
  };
  for (const l of carte.results as { salon_id: number; jour: string; cle: string; q: number; montant: number }[]) {
    const st = stats.get(l.salon_id)!;
    let j = st.jours.find((x) => x.jour === l.jour);
    if (!j) st.jours.push((j = { jour: l.jour, suivi: 0, autres: 0, a_relier: 0 }));
    const c = corr.get(l.cle);
    if (!c) { j.a_relier += l.montant; (aRelier.get(l.salon_id) ?? aRelier.set(l.salon_id, new Set()).get(l.salon_id)!).add(l.cle); }
    else if (c.ne_pas_suivre) j.autres += l.montant;
    else { j.suivi += l.montant; st.carte_suivi += l.montant; }
    compter(st, l.cle, l.q, "carte");
  }
  for (const l of especes.results as { salon_id: number; cle: string; q: number }[]) {
    const st = stats.get(l.salon_id);
    if (!st) continue;
    st.especes_saisies = true;
    compter(st, l.cle, l.q, "especes");
  }
  for (const m of malR.results as { salon_id: number; piece_id: number }[]) stats.get(m.salon_id)?.mal_expose.add(m.piece_id);
  for (const st of stats.values()) {
    st.jours.sort((a, b) => a.jour.localeCompare(b.jour));
    st.tampons.total = st.tampons.carte + st.tampons.especes;
    st.tampons.pour_1000 = st.salon.frequentation ? Math.round((st.tampons.total / st.salon.frequentation) * 10000) / 10 : null;
    st.noms_a_relier = aRelier.get(st.salon.id)?.size ?? 0;
  }
  return { stats, pieces, corr };
}

const arrondi1 = (x: number) => Math.round(x * 10) / 10;
const fr = (x: number) => String(arrondi1(x)).replace(".", ",");

/**
 * Objectifs conseillés pour des salons à venir.
 * 1. Tampons prévus : saisis à la main, sinon d'après le salon passé le plus comparable (même type si possible,
 *    sinon fréquentation la plus proche) : tampons / 1 000 visiteurs × fréquentation attendue.
 * 2. Chaque famille : ventes pour 100 tampons au MEILLEUR salon passé assez grand (≥ seuil de tampons),
 *    articles « mal exposé ou épuisé » exclus. Écart > ×3 entre salons → irrégulier, objectif à fixer à la main.
 * 3. Répartition entre modèles selon leurs ventes passées.
 */
export async function recommander(db: D1Database, cibles: Salon[]) {
  const [{ stats, pieces }, reg, seuilR] = await Promise.all([
    statistiques(db), lireReglages(db),
    db.prepare("SELECT valeur FROM reglage WHERE cle = 'tampons_min_ratio'").first<{ valeur: string }>(),
  ]);
  void reg;
  const seuil = Number(seuilR?.valeur ?? 50);
  const ajd = aujourdhui();
  const passes = [...stats.values()].filter((s) => s.salon.fin < ajd && s.tampons.total > 0);

  // 2. Ratio par famille, salon par salon.
  const familles = new Map<number, { nom: string; ratios: { salon: string; ratio: number }[]; meilleur: { salon: string; ratio: number } | null; irregulier: boolean }>();
  const totauxArticle = new Map<number, number>();
  for (const st of passes) {
    const parFamille = new Map<number, number>();
    for (const [pid, v] of st.vendus) {
      if (st.mal_expose.has(pid)) continue;
      const p = pieces.get(pid)!;
      parFamille.set(p.famille_id, (parFamille.get(p.famille_id) ?? 0) + v.carte + v.especes);
      totauxArticle.set(pid, (totauxArticle.get(pid) ?? 0) + v.carte + v.especes);
    }
    if (st.tampons.total < seuil) continue;
    for (const [fid, n] of parFamille) {
      const f = familles.get(fid) ?? familles.set(fid, { nom: "", ratios: [], meilleur: null, irregulier: false }).get(fid)!;
      f.ratios.push({ salon: st.salon.nom, ratio: (n / st.tampons.total) * 100 });
    }
  }
  for (const [fid, f] of familles) {
    f.nom = [...pieces.values()].find((p) => p.famille_id === fid)?.famille ?? "";
    f.meilleur = f.ratios.reduce<{ salon: string; ratio: number } | null>((m, r) => (!m || r.ratio > m.ratio ? r : m), null);
    const min = Math.min(...f.ratios.map((r) => r.ratio));
    f.irregulier = f.ratios.length >= 2 && min > 0 && f.meilleur!.ratio / min > 3;
  }

  // 1. Tampons prévus.
  const tamponsPrevus = cibles.map((s) => {
    if (s.tampons_prevus !== null) return { salon_id: s.id, tampons: s.tampons_prevus, calcul: "saisi à la main", manuel: true };
    if (!s.frequentation) return { salon_id: s.id, tampons: null, calcul: "fréquentation à renseigner", manuel: false };
    const avecFreq = passes.filter((p) => p.salon.frequentation);
    const memeType = s.type ? avecFreq.filter((p) => (p.salon.type ?? "").trim().toLowerCase() === s.type!.trim().toLowerCase()) : [];
    const pool = memeType.length ? memeType : avecFreq;
    if (!pool.length) return { salon_id: s.id, tampons: null, calcul: "aucun salon passé comparable (fréquentation à renseigner sur les salons passés)", manuel: false };
    const ref = pool.reduce((m, p) => (Math.abs(Math.log(p.salon.frequentation! / s.frequentation!)) < Math.abs(Math.log(m.salon.frequentation! / s.frequentation!)) ? p : m));
    const t = Math.round((ref.tampons.total / ref.salon.frequentation!) * s.frequentation!);
    return {
      salon_id: s.id, tampons: t, manuel: false,
      calcul: `comme « ${ref.salon.nom} »${memeType.length ? " (même type)" : ""} : ${fr(ref.tampons.pour_1000 ?? 0)} tampons / 1 000 visiteurs × ${s.frequentation.toLocaleString("fr-FR")} visiteurs`,
    };
  });

  // 3. Par article.
  const conseils = new Map<string, { conseille: number | null; calcul: string }>();
  for (const p of pieces.values()) {
    if (p.niveau !== "a_vendre" || p.suivi !== "quantite" || p.fin_de_serie) continue;
    const f = familles.get(p.famille_id);
    const actifs = [...pieces.values()].filter((x) => x.famille_id === p.famille_id && x.niveau === "a_vendre" && x.suivi === "quantite" && !x.fin_de_serie);
    const totalFam = actifs.reduce((t, x) => t + (totauxArticle.get(x.id) ?? 0), 0);
    const part = totalFam ? (totauxArticle.get(p.id) ?? 0) / totalFam : null;
    for (const tp of tamponsPrevus) {
      let conseille: number | null = null, calcul: string;
      if (!f?.meilleur) calcul = "pas d'historique de ventes pour cette famille";
      else if (f.irregulier) calcul = `ventes trop irrégulières d'un salon à l'autre (${f.ratios.map((r) => `${fr(r.ratio)} à « ${r.salon} »`).join(", ")} pour 100 tampons) : à fixer à la main`;
      else if (tp.tampons === null) calcul = "tampons prévus inconnus : " + tp.calcul;
      else if (part === null) calcul = "aucune vente passée dans la famille";
      else {
        conseille = Math.round((tp.tampons * f.meilleur.ratio) / 100 * part);
        calcul = `${tp.tampons} tampons × ${fr(f.meilleur.ratio)} ${f.nom} pour 100 tampons (meilleur salon : « ${f.meilleur.salon} ») × ${Math.round(part * 100)} % pour ce modèle`;
      }
      conseils.set(`${tp.salon_id}:${p.id}`, { conseille, calcul });
    }
  }
  const confiance = `${passes.filter((s) => s.tampons.total >= seuil).length} salon(s) assez grand(s) en historique (≥ ${seuil} tampons)`;
  return { tampons_prevus: tamponsPrevus, conseils, confiance };
}

// ───────────── Bilan d'un salon ─────────────
bilan.get("/salons/:id/bilan", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const { stats, pieces, corr } = await statistiques(db);
  const st = stats.get(id);
  if (!st) erreur("Salon introuvable.", 404);
  const { results: esp } = await db.prepare("SELECT cle, quantite FROM vente_especes WHERE salon_id = ?").bind(id).all<{ cle: string; quantite: number }>();
  const { results: noms } = await db.prepare("SELECT cle, nom_affiche FROM correspondance WHERE ne_pas_suivre = 0 ORDER BY nom_affiche").all<{ cle: string; nom_affiche: string }>();
  const especes = new Map(esp.map((e) => [e.cle, e.quantite]));
  const articles = [...st.vendus].map(([pid, v]) => {
    const p = pieces.get(pid)!;
    const vendus = v.carte + v.especes;
    return {
      piece_id: pid, nom: p.nom, famille: p.famille, carte: v.carte, especes: v.especes, vendus,
      pour_100: st.tampons.total ? Math.round((vendus / st.tampons.total) * 1000) / 10 : null, mal_expose: st.mal_expose.has(pid),
    };
  }).sort((a, b) => a.famille.localeCompare(b.famille) || b.vendus - a.vendus);
  return c.json({
    salon: st.salon, jours: st.jours, carte_suivi: st.carte_suivi, especes_montant: st.especes_montant,
    tampons: st.tampons, noms_a_relier: st.noms_a_relier, articles,
    caisse: noms.map((n) => ({ ...n, especes: especes.get(n.cle) ?? 0, tampons: corr.get(n.cle)?.equivalent_tampons ?? 0 })),
  });
});

// Espèces : montant total et quantités par nom de caisse (table manuscrite). Remplace la saisie précédente.
bilan.put("/salons/:id/especes", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM salon WHERE id = ?").bind(id).first())) erreur("Salon introuvable.", 404);
  let montant: number | null = null;
  if (b.montant !== undefined && b.montant !== null && b.montant !== "") {
    montant = Number(b.montant);
    if (!Number.isFinite(montant) || montant < 0) erreur("Montant des espèces invalide.");
  }
  if (!Array.isArray(b.lignes)) erreur("« lignes » doit être une liste.");
  const lignes = (b.lignes as Record<string, unknown>[])
    .map((l) => ({ cle: typeof l?.cle === "string" ? l.cle : erreur("Nom de caisse manquant."), quantite: entier(l?.quantite, "quantité", 0) }))
    .filter((l) => l.quantite > 0);
  if (new Set(lignes.map((l) => l.cle)).size !== lignes.length) erreur("Un nom apparaît deux fois.");
  if (lignes.length) {
    const { results } = await db.prepare(`SELECT cle FROM correspondance WHERE cle IN (${lignes.map(() => "?").join(",")})`).bind(...lignes.map((l) => l.cle)).all();
    if (results.length !== lignes.length) erreur("Nom de caisse inconnu.", 404);
  }
  await db.batch([
    db.prepare("DELETE FROM mouvement WHERE source_type = 'vente_especes' AND source_id IN (SELECT id FROM vente_especes WHERE salon_id = ?)").bind(id),
    db.prepare("DELETE FROM vente_especes WHERE salon_id = ?").bind(id),
    ...lignes.map((l) => db.prepare("INSERT INTO vente_especes (salon_id, cle, quantite) VALUES (?, ?, ?)").bind(id, l.cle, l.quantite)),
    db.prepare("UPDATE salon SET especes_montant = ? WHERE id = ?").bind(montant, id),
  ]);
  const appliquees = await appliquerEspeces(db, { salon_id: id });
  return c.json({ ok: true, appliquees });
});

bilan.put("/salons/:id/mal-expose", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "article", 1);
  await c.env.DB.prepare(
    "INSERT INTO bilan_article (salon_id, piece_id, mal_expose) VALUES (?, ?, ?) ON CONFLICT (salon_id, piece_id) DO UPDATE SET mal_expose = excluded.mal_expose",
  ).bind(id, piece_id, b.mal_expose ? 1 : 0).run();
  return c.json({ ok: true });
});

// Résumé par salon passé (tableau de la page Salons).
bilan.get("/salons-passes", async (c) => {
  const { stats } = await statistiques(c.env.DB);
  const ajd = aujourdhui();
  return c.json([...stats.values()].filter((s) => s.salon.fin < ajd).map((s) => ({
    salon_id: s.salon.id, carte_suivi: Math.round(s.carte_suivi), tampons: s.tampons.total, pour_1000: s.tampons.pour_1000,
    especes_saisies: s.especes_saisies || s.especes_montant !== null, noms_a_relier: s.noms_a_relier,
  })));
});
