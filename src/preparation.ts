// Écran de préparation (décision du 18/11/2026, spec §3) :
// 1. quoi produire (conseil + nombre décidé), 2. fournitures à vérifier, 3. commander,
// 4. ce qu'on a produit (checklist). Le comptage avant reste dans Compter (jalon de l'Accueil).
// Pas de suivi des étapes : une recette dit seulement ce qu'il faut pour en faire.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, entier, corps, instructionsComptage } from "./outils";
import { preparationsActuelles, lireReglages, aujourdhui } from "./salons";
import { statistiques } from "./bilan";
import { arrondirAuLot } from "./achats";
import { lireRecettes, recetteDe, resoudre, Recette } from "./fiches";

export const preparation = new Hono<{ Bindings: Env }>();

type P = {
  id: number; nom: string; famille_id: number; famille: string; famille_ordre: number; modele_non_precise: number;
  niveau: string; suivi: string; fin_de_serie: number; produit_id: number | null; variante: string | null;
  mode_achat: string | null; delai_jours: number | null; seuil: number | null; stock: number; compte: number;
};

const JOUR = 86_400_000;
const moinsJours = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") - n * JOUR).toISOString().slice(0, 10);
const plafond = (x: number) => Math.ceil(x - 1e-9);
const entierQ = (q: number) => Math.abs(q - Math.round(q)) < 1e-9;

async function lirePiecesPrep(db: D1Database): Promise<P[]> {
  const { results } = await db.prepare(
    `SELECT p.id, p.nom, p.famille_id, f.nom AS famille, f.ordre AS famille_ordre, f.modele_non_precise, p.niveau, p.suivi, p.fin_de_serie,
            p.produit_id, p.variante, p.mode_achat, p.delai_jours, p.seuil, ${STOCK_SQL} AS stock,
            EXISTS (SELECT 1 FROM comptage_ligne cl WHERE cl.piece_id = p.id) AS compte
     FROM piece p JOIN famille f ON f.id = p.famille_id WHERE p.retire = 0 ORDER BY f.ordre, f.nom, p.nom`,
  ).all<P>();
  return results;
}

/** Ce qu'il faut pour produire `aProduire` (article → nombre). Fonction pure : testable seule. */
export function calculerBesoins(pieces: P[], recettes: Recette[], aProduire: Map<number, number>) {
  const parId = new Map(pieces.map((p) => [p.id, p]));
  const besoin = new Map<number, number>();         // fournitures à avoir (quantité, peut être décimale avant arrondi)
  const sansQuantite = new Set<number>();            // à vérifier sans quantité (gomme, peinture)
  const quantiteInconnue = new Set<number>();        // utilisées par une fourniture maison au rendement inconnu
  const partagees = new Set<number>();               // feuilles partagées entre plusieurs articles (quantité décimale)
  const demandeMaison = new Map<number, number>();
  const problemes: string[] = [];
  const achetesRevendus: { piece_id: number; quantite: number }[] = [];

  const estMaison = (p: P) => p.niveau === "fait_maison" && !!recetteDe(p, recettes);
  const consommer = (cible: P, r: Recette, fois: number | null) => {
    for (const el of r.elements) {
      const e = resoudre(el, cible, pieces);
      if (!e) { problemes.push(`« ${cible.nom} » : un élément de sa recette n'existe pas pour sa variante.`); continue; }
      if (e.suivi === "sans_quantite") { sansQuantite.add(e.id); continue; }
      if (fois === null) { quantiteInconnue.add(e.id); continue; }
      if (!entierQ(el.quantite)) partagees.add(e.id);
      const q = el.quantite * fois;
      if (estMaison(e)) demandeMaison.set(e.id, (demandeMaison.get(e.id) ?? 0) + q);
      else besoin.set(e.id, (besoin.get(e.id) ?? 0) + q);
    }
  };

  for (const [pid, n] of aProduire) {
    const p = parId.get(pid);
    if (!p || n <= 0) continue;
    const r = recetteDe(p, recettes);
    if (!r) { achetesRevendus.push({ piece_id: pid, quantite: n }); continue; }
    consommer(p, r, r.pour && r.pour > 1 ? plafond(n / r.pour) : n);
  }

  // Fournitures maison : de haut en bas (une fourniture maison peut en utiliser une autre). Niveau = distance aux articles.
  const niveau = new Map<number, number>();
  const parents = (m: P) => pieces.filter((x) => { const r = recetteDe(x, recettes); return !!r && r.elements.some((el) => resoudre(el, x, pieces)?.id === m.id); });
  const niv = (m: P, vus = new Set<number>()): number => {
    if (niveau.has(m.id)) return niveau.get(m.id)!;
    if (vus.has(m.id)) return 0;
    vus.add(m.id);
    const ps = parents(m).filter((x) => x.niveau === "fait_maison");
    const v = ps.length ? 1 + Math.max(...ps.map((x) => niv(x, vus))) : 0;
    niveau.set(m.id, v);
    return v;
  };
  const maison: { piece_id: number; nom: string; besoin: number; stock: number; manque: number; fois: number | null; pour: number | null; produit: number; matiere: string | null }[] = [];
  const traites = new Set<number>();
  for (;;) {
    const restant = [...demandeMaison.keys()].filter((id) => !traites.has(id));
    if (!restant.length) break;
    const id = restant.sort((a, b) => niv(parId.get(a)!) - niv(parId.get(b)!))[0];
    traites.add(id);
    const m = parId.get(id)!, r = recetteDe(m, recettes)!;
    const q = plafond(demandeMaison.get(id)!);
    const stock = Math.max(0, m.stock), manque = Math.max(0, q - stock);
    const fois = r.pour === null ? null : plafond(manque / r.pour);
    const premier = r.elements.map((el) => resoudre(el, m, pieces)).find((e) => e && e.suivi === "quantite");
    maison.push({
      piece_id: id, nom: m.nom, besoin: q, stock, manque, fois, pour: r.pour,
      produit: fois === null ? manque : fois * r.pour!, matiere: premier ? premier.nom : null,
    });
    if (manque > 0) consommer(m, r, fois);
  }
  return { besoin, sansQuantite, quantiteInconnue, partagees, maison, achetesRevendus, problemes: [...new Set(problemes)] };
}

/** Conseil : articles = ventes au meilleur salon + marge − stock ; familles dont la caisse ne dit pas le modèle =
 *  remonter au niveau médian des autres modèles ceux qui en ont la moitié ou moins. */
async function conseils(db: D1Database, articles: P[]) {
  const [{ stats }, reg] = await Promise.all([statistiques(db), lireReglages(db)]);
  const ajd = aujourdhui();
  const passes = [...stats.values()].filter((s) => s.salon.fin < ajd).sort((a, b) => a.salon.fin.localeCompare(b.salon.fin));
  const dernier = passes[passes.length - 1] ?? null;
  const vendu = (st: (typeof passes)[number], pid: number) => { const v = st.vendus.get(pid); return v ? v.carte + v.especes : 0; };
  const mediane = new Map<number, number>();
  for (const fid of new Set(articles.filter((a) => a.modele_non_precise).map((a) => a.famille_id))) {
    const s = articles.filter((a) => a.famille_id === fid).map((a) => Math.max(0, a.stock)).sort((x, y) => x - y);
    mediane.set(fid, s.length ? Math.round(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0);
  }
  const pct = Math.round(reg.marge * 100);
  return new Map(articles.map((a) => {
    const stock = Math.max(0, a.stock);
    let meilleur: { salon: string; q: number } | null = null;
    for (const st of passes) {
      if (st.mal_expose.has(a.id)) continue;
      const q = vendu(st, a.id);
      if (q > 0 && (!meilleur || q > meilleur.q)) meilleur = { salon: st.salon.nom, q };
    }
    const d = dernier ? { salon: dernier.salon.nom, q: vendu(dernier, a.id) } : null;
    let conseil = 0, calcul: string;
    if (a.modele_non_precise) {
      const m = mediane.get(a.famille_id) ?? 0;
      if (m > 0 && stock <= m / 2) { conseil = m - stock; calcul = `remonter au niveau des autres modèles (${m}) : ${m} − ${stock}`; }
      else calcul = m > 0 ? `${stock} en stock, les autres modèles autour de ${m}` : "la caisse ne dit pas le modèle";
    } else if (!meilleur) calcul = "jamais vendu sur un salon saisi";
    else {
      const vise = Math.ceil(meilleur.q * (1 + reg.marge) - 1e-9);
      conseil = Math.max(0, vise - stock);
      calcul = `${meilleur.q} vendu${meilleur.q > 1 ? "s" : ""} (${meilleur.salon}) + ${pct} % = ${vise} − ${stock} en stock`;
    }
    return [a.id, { conseil, calcul, meilleur, dernier: d }];
  }));
}

export async function lirePreparation(db: D1Database) {
  const etat = await preparationsActuelles(db);
  if (etat.en_cours === null) return { preparation: null as null };
  const prep = etat.preparations.find((p) => p.id === etat.en_cours)!;
  const salons = etat.salons.filter((s) => prep.salon_ids.includes(s.id));
  const [pieces, recettes, dec, ver, fai, cmd, lotsR] = await Promise.all([
    lirePiecesPrep(db), lireRecettes(db),
    db.prepare("SELECT piece_id, a_produire FROM prep_production WHERE prep_id = ?").bind(prep.id).all<{ piece_id: number; a_produire: number }>(),
    db.prepare("SELECT piece_id, quantite, le FROM prep_verif WHERE prep_id = ?").bind(prep.id).all<{ piece_id: number; quantite: number | null; le: string }>(),
    db.prepare("SELECT piece_id, sens, quantite FROM prep_fait WHERE prep_id = ?").bind(prep.id).all<{ piece_id: number; sens: string; quantite: number }>(),
    db.prepare("SELECT c.id, c.piece_id, p.nom, p.suivi, c.quantite, c.taille_lot, c.commande_le FROM commande c JOIN piece p ON p.id = c.piece_id WHERE c.statut = 'commande' ORDER BY c.commande_le").all<{ id: number; piece_id: number; nom: string; suivi: string; quantite: number; taille_lot: number | null; commande_le: string }>(),
    db.prepare("SELECT piece_id, taille FROM piece_lot ORDER BY taille").all<{ piece_id: number; taille: number }>(),
  ]);
  const parId = new Map(pieces.map((p) => [p.id, p]));
  const articles = pieces.filter((p) => p.niveau === "a_vendre" && p.suivi === "quantite" && !p.fin_de_serie);
  const cons = await conseils(db, articles);
  const decide = new Map(dec.results.map((x) => [x.piece_id, x.a_produire]));
  const lignes = articles.map((a) => {
    const c = cons.get(a.id)!;
    return {
      piece_id: a.id, nom: a.nom, famille_id: a.famille_id, famille: a.famille, stock: a.stock, modele_non_precise: !!a.modele_non_precise,
      achete: !recetteDe(a, recettes), conseil: c.conseil, calcul: c.calcul, meilleur: c.meilleur, dernier: c.dernier,
      a_produire: decide.get(a.id) ?? c.conseil, decide: decide.has(a.id),
    };
  });
  const aProduire = new Map(lignes.filter((l) => l.a_produire > 0).map((l) => [l.piece_id, l.a_produire]));
  const b = calculerBesoins(pieces, recettes, aProduire);

  // 2. Fournitures à vérifier
  const verifs = new Map(ver.results.map((v) => [v.piece_id, v]));
  const enRoute = new Map<number, number>();
  for (const c of cmd.results) enRoute.set(c.piece_id, (enRoute.get(c.piece_id) ?? 0) + c.quantite);
  const lots = new Map<number, number[]>();
  for (const l of lotsR.results) (lots.get(l.piece_id) ?? lots.set(l.piece_id, []).get(l.piece_id)!).push(l.taille);
  const premier = salons[0].date_debut;
  const avantLe = (p: P) => p.delai_jours !== null ? moinsJours(premier, p.delai_jours) : null;
  const ligneF = (id: number, il_en_faut: number | null) => {
    const p = parId.get(id)!;
    const v = verifs.get(id);
    let etatL: string;
    if (p.suivi === "sans_quantite") etatL = "sans";
    else if (il_en_faut === null) etatL = "inconnu_q";
    else if (!p.compte) etatL = "jamais";
    else if (il_en_faut > p.stock) etatL = "manque";
    else if (p.seuil !== null && p.stock - il_en_faut < p.seuil) etatL = "bas";
    else etatL = "ok";
    const route = enRoute.get(id) ?? 0;
    let a_commander: number | null = null, lot: { nombre: number; taille: number } | null = null;
    if (v && p.suivi === "quantite" && il_en_faut !== null) {
      const manque = il_en_faut - (v.quantite ?? 0) - route;
      if (manque > 0) { const a = arrondirAuLot(manque, lots.get(id) ?? []); a_commander = a.quantite; lot = a.lots; }
    }
    // Sans quantité : « à racheter » (quantite = 0) → 1 à commander, sauf s'il y en a déjà en route.
    if (v && p.suivi === "sans_quantite" && v.quantite === 0 && route === 0) a_commander = 1;
    return {
      piece_id: id, nom: p.nom, famille: p.famille, niveau: p.niveau, suivi: p.suivi, il_en_faut, stock: p.stock, compte: !!p.compte,
      seuil: p.seuil, etat: etatL, revente: false, verifie: !!v, verifie_quantite: v?.quantite ?? null, en_route: route,
      a_commander, lot, mode_achat: p.mode_achat, recup: p.niveau === "recup" || p.mode_achat === "jamais", avant_le: avantLe(p),
    };
  };
  const fournitures = [
    ...[...b.besoin].map(([id, q]) => ligneF(id, plafond(q))),
    ...[...b.quantiteInconnue].filter((id) => !b.besoin.has(id)).map((id) => ligneF(id, null)),
    ...[...b.sansQuantite].map((id) => ligneF(id, null)),
  ];
  const ordreEtat = ["manque", "jamais", "bas", "inconnu_q", "ok", "sans"];
  fournitures.sort((x, y) => ordreEtat.indexOf(x.etat) - ordreEtat.indexOf(y.etat) || x.nom.localeCompare(y.nom));

  // 3. Commander : fournitures vérifiées qui manquent + articles achetés puis revendus (le nombre décidé au 1, sans vérification).
  const revendus = b.achetesRevendus.map((x) => {
    const p = parId.get(x.piece_id)!;
    const route = enRoute.get(x.piece_id) ?? 0;
    const manque = x.quantite - route;
    const a = manque > 0 ? arrondirAuLot(manque, lots.get(x.piece_id) ?? []) : null;
    return {
      piece_id: x.piece_id, nom: p.nom, famille: p.famille, niveau: p.niveau, suivi: p.suivi, il_en_faut: x.quantite, stock: p.stock, compte: !!p.compte,
      seuil: p.seuil, etat: "revente", revente: true, verifie: true, verifie_quantite: null, en_route: route,
      a_commander: a ? a.quantite : null, lot: a ? a.lots : null, mode_achat: p.mode_achat, recup: false, avant_le: avantLe(p),
    };
  });
  const commander = [...fournitures.filter((f) => f.verifie && f.a_commander), ...revendus.filter((f) => f.a_commander)];

  // 3. Checklist
  const faits = new Map(fai.results.map((f) => [f.piece_id, f.quantite]));
  const checklist = [
    ...b.maison.filter((m) => m.besoin > 0).map((m) => ({ ...m, type: "maison", prevu: m.produit, fait: faits.get(m.piece_id) ?? null })),
    ...[...b.partagees].map((id) => ({ type: "utilise", piece_id: id, nom: parId.get(id)!.nom, prevu: plafond(b.besoin.get(id) ?? 0), fait: faits.get(id) ?? null })),
    ...lignes.filter((l) => l.a_produire > 0 && !l.achete).map((l) => ({ type: "article", piece_id: l.piece_id, nom: l.nom, famille: l.famille, prevu: l.a_produire, fait: faits.get(l.piece_id) ?? null })),
  ];
  return {
    preparation: prep, salons, debut: moinsJours(premier, 15), aujourdhui: aujourdhui(),
    articles: lignes, fournitures, commander, checklist, commandes: cmd.results, problemes: b.problemes,
  };
}

preparation.get("/preparation", async (c) => c.json(await lirePreparation(c.env.DB)));

const prepId = async (db: D1Database, v: string) => {
  const id = entier(v, "préparation", 1);
  const etat = await preparationsActuelles(db);
  if (!etat.preparations.some((p) => p.id === id)) erreur("Préparation introuvable.", 404);
  return id;
};

// 1. Nombre à produire décidé (null = revenir au conseil).
preparation.put("/preparation/:id/production", async (c) => {
  const db = c.env.DB;
  const id = await prepId(db, c.req.param("id"));
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "article", 1);
  if (b.a_produire === null || b.a_produire === "") await db.prepare("DELETE FROM prep_production WHERE prep_id = ? AND piece_id = ?").bind(id, piece_id).run();
  else await db.prepare("INSERT INTO prep_production (prep_id, piece_id, a_produire) VALUES (?, ?, ?) ON CONFLICT (prep_id, piece_id) DO UPDATE SET a_produire = excluded.a_produire")
    .bind(id, piece_id, entier(b.a_produire, "nombre à produire", 0)).run();
  return c.json({ ok: true });
});

// « La liste est arrêtée » : enregistre d'un coup les nombres affichés (conseils compris).
preparation.put("/preparation/:id/production/lot", async (c) => {
  const db = c.env.DB;
  const id = await prepId(db, c.req.param("id"));
  const b = await corps(c);
  if (!Array.isArray(b.lignes)) erreur("Lignes manquantes.");
  const lignes = (b.lignes as Record<string, unknown>[]).map((l) => ({ piece_id: entier(l?.piece_id, "article", 1), a_produire: entier(l?.a_produire, "nombre à produire", 0) }));
  if (lignes.length) await db.batch(lignes.map((l) => db.prepare(
    "INSERT INTO prep_production (prep_id, piece_id, a_produire) VALUES (?, ?, ?) ON CONFLICT (prep_id, piece_id) DO UPDATE SET a_produire = excluded.a_produire",
  ).bind(id, l.piece_id, l.a_produire)));
  return c.json({ ok: true });
});

// 2. Vérifier une fourniture : « j'en ai N » (= comptage), ou, sans quantité, « il en reste » / « à racheter ».
preparation.put("/preparation/:id/verif", async (c) => {
  const db = c.env.DB;
  const id = await prepId(db, c.req.param("id"));
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "fourniture", 1);
  const p = await db.prepare("SELECT suivi FROM piece WHERE id = ?").bind(piece_id).first<{ suivi: string }>();
  if (!p) erreur("Fourniture introuvable.", 404);
  let quantite: number | null = null;
  const stmts: D1PreparedStatement[] = [];
  if (p.suivi === "quantite") {
    if (b.quantite === null || b.quantite === undefined || b.quantite === "") erreur("Indiquez combien vous en avez.");
    quantite = entier(b.quantite, "quantité", 0);
    stmts.push(...instructionsComptage(db, [{ piece_id, compte: quantite }], "libre", null));
  } else quantite = b.a_racheter ? 0 : null;
  stmts.push(db.prepare("INSERT INTO prep_verif (prep_id, piece_id, quantite) VALUES (?, ?, ?) ON CONFLICT (prep_id, piece_id) DO UPDATE SET quantite = excluded.quantite, le = excluded.le")
    .bind(id, piece_id, quantite));
  await db.batch(stmts);
  return c.json({ ok: true });
});

preparation.delete("/preparation/:id/verif/:piece", async (c) => {
  const db = c.env.DB;
  const id = await prepId(db, c.req.param("id"));
  await db.prepare("DELETE FROM prep_verif WHERE prep_id = ? AND piece_id = ?").bind(id, entier(c.req.param("piece"), "fourniture", 1)).run();
  return c.json({ ok: true });
});

// 3. « Produit, combien ? » : ajoute au stock et retire les fournitures utilisées (théorique).
// Feuilles partagées (prints mélangés sur une feuille) : déclarées à part (« utilisées »).
// Rendement inconnu : `matiere` = combien de feuilles/plaques utilisées, d'où le rendement retenu.
preparation.put("/preparation/:id/fait", async (c) => {
  const db = c.env.DB;
  const id = await prepId(db, c.req.param("id"));
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "article", 1);
  const quantite = entier(b.quantite, "quantité", 0);
  const sens = b.sens === "utilise" ? "utilise" : "produit";
  const [pieces, recettes] = await Promise.all([lirePiecesPrep(db), lireRecettes(db)]);
  const p = pieces.find((x) => x.id === piece_id) ?? erreur("Article introuvable.", 404);
  const stmts: D1PreparedStatement[] = [...annulerFait(db, id, piece_id)];
  stmts.push(db.prepare("INSERT INTO prep_fait (prep_id, piece_id, sens, quantite) VALUES (?, ?, ?, ?)").bind(id, piece_id, sens, quantite));
  const mvt = (pid: number, q: number) => db.prepare(
    "INSERT INTO mouvement (piece_id, quantite, motif, source_type, source_id) VALUES (?, ?, 'etape', 'prep_fait', (SELECT id FROM prep_fait WHERE prep_id = ? AND piece_id = ?))",
  ).bind(pid, q, id, piece_id);
  if (quantite > 0 && sens === "utilise") stmts.push(mvt(piece_id, -quantite));
  else if (quantite > 0) {
    stmts.push(mvt(piece_id, quantite));
    const r = recetteDe(p, recettes);
    if (r) {
      let fois: number;
      if (r.pour === null) {
        const matiere = b.matiere === undefined || b.matiere === null || b.matiere === "" ? erreur("Rendement inconnu : indiquez combien de feuilles (ou plaques) vous avez utilisées.") : entier(b.matiere, "matière utilisée", 1);
        fois = matiere;
        stmts.push(db.prepare("UPDATE recette SET pour = ? WHERE id = ?").bind(Math.max(1, Math.round(quantite / matiere)), r.id));
      } else fois = r.pour > 1 ? plafond(quantite / r.pour) : quantite;
      for (const el of r.elements) {
        const e = resoudre(el, p, pieces);
        if (!e || e.suivi !== "quantite" || !entierQ(el.quantite)) continue;
        stmts.push(mvt(e.id, -Math.round(el.quantite * fois)));
      }
    }
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

function annulerFait(db: D1Database, prep: number, piece_id: number) {
  return [
    db.prepare("DELETE FROM mouvement WHERE source_type = 'prep_fait' AND source_id IN (SELECT id FROM prep_fait WHERE prep_id = ? AND piece_id = ?)").bind(prep, piece_id),
    db.prepare("DELETE FROM prep_fait WHERE prep_id = ? AND piece_id = ?").bind(prep, piece_id),
  ];
}

preparation.delete("/preparation/:id/fait/:piece", async (c) => {
  const db = c.env.DB;
  const id = await prepId(db, c.req.param("id"));
  await db.batch(annulerFait(db, id, entier(c.req.param("piece"), "article", 1)));
  return c.json({ ok: true });
});

// Seuil d'alerte d'une fourniture (vide = pas d'alerte).
preparation.put("/pieces/:id/seuil", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const seuil = b.seuil === null || b.seuil === "" || b.seuil === undefined ? null : entier(b.seuil, "seuil", 0);
  const r = await c.env.DB.prepare("UPDATE piece SET seuil = ? WHERE id = ?").bind(seuil, id).run();
  if (!r.meta.changes) erreur("Fourniture introuvable.", 404);
  return c.json({ ok: true });
});

/** Fournitures sous leur seuil (hors préparation aussi), pour l'Accueil. */
export async function fournituresSousSeuil(db: D1Database) {
  const { results } = await db.prepare(
    `SELECT p.id, p.nom, p.seuil, ${STOCK_SQL} AS stock FROM piece p WHERE p.retire = 0 AND p.seuil IS NOT NULL AND p.suivi = 'quantite' AND ${STOCK_SQL} < p.seuil ORDER BY p.nom`,
  ).all<{ id: number; nom: string; seuil: number; stock: number }>();
  return results;
}
