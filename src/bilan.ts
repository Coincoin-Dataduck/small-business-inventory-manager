// Bilan des salons et objectifs conseillés (méthode : docs/historique-salons.md).
// Ventes d'un salon = carte (SumUp, rattachée par la date) + espèces saisies, par nom de caisse,
// traduites en pièces par les correspondances. Les noms « Ne pas suivre » (ventes de Lucile…) sont exclus.
import { Hono } from "hono";
import { rejouerComptages, Env, erreur, entier, corps } from "./outils";
import { aujourdhui, lireReglages, Salon } from "./salons";
import { appliquerEspeces } from "./sumup";

export const bilan = new Hono<{ Bindings: Env }>();

type Corr = { ne_pas_suivre: boolean; pieces: { piece_id: number; quantite: number }[]; familles: { famille_id: number; quantite: number }[] };
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

/** Famille dont les ventes servent de thermomètre : réglage « famille_thermometre », sinon la famille « modèle non précisé » (Tampons). */
export async function familleThermometre(db: D1Database) {
  const r = await db.prepare("SELECT valeur FROM reglage WHERE cle = 'famille_thermometre'").first<{ valeur: string }>();
  if (r && Number(r.valeur)) return Number(r.valeur);
  const { results } = await db.prepare("SELECT id, nom FROM famille WHERE modele_non_precise = 1 ORDER BY ordre, nom").all<{ id: number; nom: string }>();
  return (results.find((f) => f.nom.toLowerCase().startsWith("tampon")) ?? results[0])?.id ?? null;
}

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
    db.prepare("SELECT cle, ne_pas_suivre FROM correspondance"),
    db.prepare("SELECT cle, piece_id, quantite FROM correspondance_piece"),
    db.prepare("SELECT p.id, p.nom, p.famille_id, f.nom AS famille, p.niveau, p.suivi, p.fin_de_serie FROM piece p JOIN famille f ON f.id = p.famille_id"),
    db.prepare("SELECT salon_id, piece_id FROM bilan_article WHERE mal_expose = 1"),
  ]);
  const corr = new Map<string, Corr>();
  for (const c of corrR.results as { cle: string; ne_pas_suivre: number }[])
    corr.set(c.cle, { ne_pas_suivre: !!c.ne_pas_suivre, pieces: [], familles: [] });
  const { results: cfR } = await db.prepare("SELECT cle, famille_id, quantite FROM correspondance_famille").all<{ cle: string; famille_id: number; quantite: number }>();
  for (const f of cfR) corr.get(f.cle)?.familles.push(f);
  for (const p of cpR.results as { cle: string; piece_id: number; quantite: number }[]) corr.get(p.cle)?.pieces.push(p);
  const pieces = new Map((piecesR.results as PieceStat[]).map((p) => [p.id, p]));
  const thermo = await familleThermometre(db);
  // Tampons vendus par nom de caisse = quantité reliée à la famille thermomètre (Tampon lot = × 4, Collection = × 20).
  const tamponsPar = (c: Corr) => c.familles.filter((f) => f.famille_id === thermo).reduce((t, f) => t + f.quantite, 0);
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
    st.tampons[mode] += q * tamponsPar(c);
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
  return { stats, pieces, corr, tamponsPar, thermo };
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
  const { stats, pieces, corr, tamponsPar } = await statistiques(db);
  const st = stats.get(id);
  if (!st) erreur("Salon introuvable.", 404);
  const { results: esp } = await db.prepare("SELECT cle, quantite FROM vente_especes WHERE salon_id = ?").bind(id).all<{ cle: string; quantite: number }>();
  const [nomsR, compR, prixR] = await db.batch([
    db.prepare("SELECT cle, nom_affiche FROM correspondance WHERE ne_pas_suivre = 0 ORDER BY nom_affiche"),
    db.prepare(`SELECT cp.cle, 'p' || cp.piece_id || 'x' || cp.quantite AS bout, p.nom FROM correspondance_piece cp JOIN piece p ON p.id = cp.piece_id
                UNION ALL SELECT cf.cle, 'f' || cf.famille_id || 'x' || cf.quantite, f.nom FROM correspondance_famille cf JOIN famille f ON f.id = cf.famille_id`),
    db.prepare("SELECT cle, prix, COUNT(*) AS n FROM vente_ligne WHERE prix IS NOT NULL GROUP BY cle, prix"),
  ]);
  const noms = nomsR.results as { cle: string; nom_affiche: string }[];
  // Composition (ce que le nom de caisse retire du stock) : sert à regrouper les noms qui désignent la même chose.
  const compo = new Map<string, { bouts: string[]; noms: string[] }>();
  for (const x of compR.results as { cle: string; bout: string; nom: string }[]) {
    const e = compo.get(x.cle) ?? compo.set(x.cle, { bouts: [], noms: [] }).get(x.cle)!;
    e.bouts.push(x.bout); e.noms.push(x.nom + (x.bout.endsWith("x1") ? "" : " × " + x.bout.split("x")[1]));
  }
  // Prix habituel : le plus fréquent (les remises SumUp réparties sur un panier donnent des prix à virgule).
  const prixHabituel = new Map<string, { prix: number; n: number }[]>();
  for (const x of prixR.results as { cle: string; prix: number; n: number }[]) (prixHabituel.get(x.cle) ?? prixHabituel.set(x.cle, []).get(x.cle)!).push({ prix: x.prix, n: x.n });
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
    caisse: noms.map((n) => ({ ...n, especes: especes.get(n.cle) ?? 0, tampons: corr.get(n.cle) ? tamponsPar(corr.get(n.cle)!) : 0,
      signature: (compo.get(n.cle)?.bouts ?? []).sort().join("+"), contenu: compo.get(n.cle)?.noms ?? [], prix: prixHabituel.get(n.cle) ?? [] })),
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
  const { results: touchees } = await db.prepare("SELECT DISTINCT piece_id FROM mouvement WHERE source_type = 'vente_especes' AND source_id IN (SELECT id FROM vente_especes WHERE salon_id = ?)").bind(id).all<{ piece_id: number }>();
  await db.batch([
    db.prepare("DELETE FROM mouvement WHERE source_type = 'vente_especes' AND source_id IN (SELECT id FROM vente_especes WHERE salon_id = ?)").bind(id),
    db.prepare("DELETE FROM vente_especes WHERE salon_id = ?").bind(id),
    ...lignes.map((l) => db.prepare("INSERT INTO vente_especes (salon_id, cle, quantite) VALUES (?, ?, ?)").bind(id, l.cle, l.quantite)),
    db.prepare("UPDATE salon SET especes_montant = ? WHERE id = ?").bind(montant, id),
  ]);
  const appliquees = await appliquerEspeces(db, { salon_id: id });
  await rejouerComptages(db, touchees.map((t) => t.piece_id)); // espèces retirées d'une saisie précédente
  return c.json({ ok: true, appliquees });
});

// ───────────── Caisse et écarts d'un salon ─────────────
// Pour chaque article compté avant ET après le salon :
//   attendu après = compté avant + tout ce qui a été enregistré entre les deux (ventes carte et espèces, étapes, réceptions)
//   sortis sans trace = attendu après − compté après   (> 0 : manquants ; < 0 : en trop, ex. fabriqué sans « C'est fait »)
// Valeur au prix SumUp (moyenne des ventes du nom de caisse qui désigne cet article seul, à l'unité).
bilan.get("/salons/:id/caisse", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const s = await db.prepare("SELECT id, nom, date_debut, date(date_debut, '+' || (nb_jours - 1) || ' days') AS fin, caisse_comptee FROM salon WHERE id = ?").bind(id)
    .first<{ id: number; nom: string; date_debut: string; fin: string; caisse_comptee: string | null }>();
  if (!s) erreur("Salon introuvable.", 404);
  const [avR, apR, mvR, pR, prixPieceR, prixFamR, espR, prixCleR, fondR] = await db.batch([
    // Dernier comptage de chaque article avant le premier jour du salon.
    db.prepare(`SELECT cl.piece_id, cl.compte, c.date FROM comptage_ligne cl JOIN comptage c ON c.id = cl.comptage_id
      WHERE substr(c.date, 1, 10) < ?1 AND c.date = (SELECT MAX(c2.date) FROM comptage_ligne l2 JOIN comptage c2 ON c2.id = l2.comptage_id WHERE l2.piece_id = cl.piece_id AND substr(c2.date, 1, 10) < ?1)`).bind(s.date_debut),
    // Dernier comptage de chaque article après le salon et avant le salon suivant (un recomptage corrige le premier).
    db.prepare(`SELECT cl.piece_id, cl.compte, c.date FROM comptage_ligne cl JOIN comptage c ON c.id = cl.comptage_id
      WHERE c.date = (SELECT MAX(c2.date) FROM comptage_ligne l2 JOIN comptage c2 ON c2.id = l2.comptage_id WHERE l2.piece_id = cl.piece_id
        AND substr(c2.date, 1, 10) > ?1 AND substr(c2.date, 1, 10) < COALESCE((SELECT MIN(date_debut) FROM salon WHERE date_debut > ?1), '9999'))`).bind(s.fin),
    db.prepare("SELECT piece_id, quantite, motif, date FROM mouvement WHERE motif <> 'comptage' AND date >= ?").bind(s.date_debut + "T00:00:00Z"),
    db.prepare("SELECT p.id, p.nom, p.famille_id, f.nom AS famille, f.modele_non_precise FROM piece p JOIN famille f ON f.id = p.famille_id WHERE p.niveau = 'a_vendre'"),
    // Prix d'un article : noms de caisse qui désignent cet article seul, à l'unité.
    db.prepare(`SELECT cp.piece_id, vl.prix, COUNT(*) AS n FROM correspondance_piece cp JOIN vente_ligne vl ON vl.cle = cp.cle
      WHERE cp.quantite = 1 AND vl.prix IS NOT NULL
        AND (SELECT COUNT(*) FROM correspondance_piece x WHERE x.cle = cp.cle) = 1
        AND NOT EXISTS (SELECT 1 FROM correspondance_famille y WHERE y.cle = cp.cle)
      GROUP BY cp.piece_id, vl.prix`),
    // Prix d'un modèle non précisé à la caisse (ex. « Tampon unité ») : nom de caisse relié à la famille seule, × 1.
    db.prepare(`SELECT cf.famille_id, vl.prix, COUNT(*) AS n FROM correspondance_famille cf JOIN vente_ligne vl ON vl.cle = cf.cle
      WHERE cf.quantite = 1 AND vl.prix IS NOT NULL
        AND (SELECT COUNT(*) FROM correspondance_famille x WHERE x.cle = cf.cle) = 1
        AND NOT EXISTS (SELECT 1 FROM correspondance_piece y WHERE y.cle = cf.cle)
      GROUP BY cf.famille_id, vl.prix`),
    db.prepare("SELECT ve.cle, ve.quantite, c.nom_affiche FROM vente_especes ve JOIN correspondance c ON c.cle = ve.cle WHERE ve.salon_id = ?").bind(id),
    db.prepare("SELECT cle, prix, COUNT(*) AS n FROM vente_ligne WHERE prix IS NOT NULL GROUP BY cle, prix"),
    db.prepare("SELECT valeur FROM reglage WHERE cle = 'fond_caisse'"),
  ]);
  const pieces = new Map((pR.results as { id: number; nom: string; famille_id: number; famille: string; modele_non_precise: number }[]).map((p) => [p.id, p]));
  // Prix le plus fréquent (à égalité : le plus élevé, c'est-à-dire sans remise).
  const plusFrequent = <K>(rows: { k: K; prix: number; n: number }[]) => {
    const m = new Map<K, { prix: number; n: number }>();
    for (const r of rows) { const b = m.get(r.k); if (!b || r.n > b.n || (r.n === b.n && r.prix > b.prix)) m.set(r.k, { prix: r.prix, n: r.n }); }
    return new Map([...m].map(([k, v]) => [k, v.prix]));
  };
  const prixPiece = plusFrequent((prixPieceR.results as { piece_id: number; prix: number; n: number }[]).map((x) => ({ k: x.piece_id, prix: x.prix, n: x.n })));
  const prixFam = plusFrequent((prixFamR.results as { famille_id: number; prix: number; n: number }[]).map((x) => ({ k: x.famille_id, prix: x.prix, n: x.n })));
  const prixDe = (pid: number) => { const p = pieces.get(pid); return prixPiece.get(pid) ?? (p?.modele_non_precise ? prixFam.get(p.famille_id) ?? null : null); };
  const avant = new Map((avR.results as { piece_id: number; compte: number; date: string }[]).map((x) => [x.piece_id, x]));
  const apres = new Map((apR.results as { piece_id: number; compte: number; date: string }[]).map((x) => [x.piece_id, x]));
  const mv = mvR.results as { piece_id: number; quantite: number; motif: string; date: string }[];

  const lignes = [];
  for (const [pid, ap] of apres) {
    const av = avant.get(pid);
    const p = pieces.get(pid);
    if (!av || !p) continue;
    const entre = mv.filter((m) => m.piece_id === pid && m.date > av.date && m.date < ap.date);
    const vendus = -entre.filter((m) => m.motif === "vente" || m.motif === "vente_especes").reduce((t, m) => t + m.quantite, 0);
    const autres = entre.filter((m) => m.motif !== "vente" && m.motif !== "vente_especes").reduce((t, m) => t + m.quantite, 0);
    const attendu = av.compte - vendus + autres;
    const sansTrace = attendu - ap.compte;
    if (!sansTrace) continue;
    const prix = prixDe(pid);
    lignes.push({ piece_id: pid, nom: p.nom, famille: p.famille, avant: av.compte, vendus, autres, apres: ap.compte, sans_trace: sansTrace, prix, valeur: prix === null ? null : Math.round(sansTrace * prix * 100) / 100 });
  }
  lignes.sort((a, b) => b.sans_trace - a.sans_trace || a.nom.localeCompare(b.nom));
  const prixCle = plusFrequent((prixCleR.results as { cle: string; prix: number; n: number }[]).map((x) => ({ k: x.cle, prix: x.prix, n: x.n })));
  const esp = (espR.results as { cle: string; quantite: number; nom_affiche: string }[]).map((e) => ({ ...e, prix: prixCle.get(e.cle) ?? null }));
  const manquants = lignes.filter((l) => l.sans_trace > 0);
  const somme = (xs: (number | null)[]) => Math.round(xs.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100;
  const coupures = lireCoupures(s.caisse_comptee);
  return c.json({
    salon: { id: s.id, nom: s.nom, date_debut: s.date_debut, fin: s.fin },
    caisse_comptee: { coupures, total: totalCoupures(coupures) },
    fond_caisse: (fondR.results[0] as { valeur: string } | undefined) ? Number((fondR.results[0] as { valeur: string }).valeur) : null,
    comptes_avant: avant.size, comptes_apres: apres.size,
    especes_notees: { total: somme(esp.map((e) => (e.prix === null ? null : e.prix * e.quantite))), lignes: esp, sans_prix: esp.filter((e) => e.prix === null).map((e) => e.nom_affiche) },
    sans_trace: { lignes, valeur_manquants: somme(manquants.map((l) => l.valeur)), manquants_sans_prix: manquants.filter((l) => l.prix === null).map((l) => l.nom) },
  });
});

// Comptage de caisse : billets et pièces (fond compris).
const COUPURES = ["500", "200", "100", "50", "20", "10", "5", "2", "1", "0.5", "0.2", "0.1", "0.05", "0.02", "0.01"];
function lireCoupures(v: string | null): Record<string, number> {
  try { const o = v ? JSON.parse(v) : {}; return Object.fromEntries(COUPURES.filter((k) => Number(o[k]) > 0).map((k) => [k, Math.floor(Number(o[k]))])); } catch { return {}; }
}
const totalCoupures = (c: Record<string, number>) => Math.round(Object.entries(c).reduce((t, [k, n]) => t + Number(k) * 100 * n, 0)) / 100;

bilan.put("/salons/:id/caisse", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const brut = (b.coupures ?? {}) as Record<string, unknown>;
  const coupures: Record<string, number> = {};
  for (const k of COUPURES) if (brut[k] !== undefined && brut[k] !== "" && brut[k] !== null) {
    const n = entier(brut[k], "nombre de " + k + " €", 0);
    if (n) coupures[k] = n;
  }
  const r = await c.env.DB.prepare("UPDATE salon SET caisse_comptee = ? WHERE id = ?").bind(Object.keys(coupures).length ? JSON.stringify(coupures) : null, id).run();
  if (!r.meta.changes) erreur("Salon introuvable.", 404);
  return c.json({ ok: true, total: totalCoupures(coupures) });
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
