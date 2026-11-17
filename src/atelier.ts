// Planification de l'Atelier (spec §1) :
// pour l'objectif d'un article, partir de ce qui est déjà prêt puis fait maison,
// ne remonter à l'étape précédente que si la réserve ne suffit pas, proposer les étapes
// dans l'ordre où les faire, dire ce qui part en réserve. Pas de réservation : tout est recalculé.
import { Hono } from "hono";
import { Env, STOCK_SQL } from "./outils";
import { lireObjectifs, preparationsActuelles } from "./salons";

export const atelier = new Hono<{ Bindings: Env }>();

type Piece = { id: number; nom: string; niveau: string; suivi: string; presque_vide: number; stock: number };
type Etape = {
  id: number; famille_id: number; nom: string; mode: string; temps_min: number | null; ordre: number;
  utilise: { piece_id: number; quantite: number }[];
  donne: { au_choix: boolean; piece_id: number | null; quantite: number; choix: { piece_id: number; poids: number }[] }[];
};
type Entree = { piece_id: number; besoin: number; en_stock: number; fait_avant: number; manque: number };
type Travail = {
  etape_id: number; fois: number;
  donne: Map<number, { quantite: number; reserve: number }>;
  entrees: Map<number, Entree>;
  sert: Set<number>; avant: Set<number>; // articles servis ; étapes à faire avant celle-ci
  parts: number; parts_libres: number;   // sorties au choix
};

export type Demande = { piece_id: number; quantite: number };

/** Cœur du calcul, sans base de données : testable seul. */
export function planifier(pieces: Map<number, Piece>, etapes: Etape[], demandes: Demande[]) {
  const dispo = new Map<number, number>();
  for (const p of pieces.values()) dispo.set(p.id, p.suivi === "quantite" ? Math.max(0, p.stock) : Infinity);

  // Qui fabrique quoi : première étape (par ordre) qui donne la pièce.
  const producteurs = new Map<number, Etape[]>();
  for (const e of [...etapes].sort((a, b) => a.ordre - b.ordre || a.id - b.id))
    for (const d of e.donne)
      for (const pid of d.au_choix ? d.choix.map((c) => c.piece_id) : [d.piece_id!]) {
        if (!producteurs.has(pid)) producteurs.set(pid, []);
        producteurs.get(pid)!.push(e);
      }

  const travaux = new Map<number, Travail>();
  const ordreCreation: number[] = [];
  const aAcheter = new Map<number, number>();
  const problemes = new Set<string>();
  const enAttente = new Map<number, Map<number, number>>(); // étape au choix → pièce → quantité demandée
  const servisParAttente = new Map<number, Set<number>>();

  const travail = (e: Etape) => {
    if (!travaux.has(e.id)) {
      travaux.set(e.id, { etape_id: e.id, fois: 0, donne: new Map(), entrees: new Map(), sert: new Set(), avant: new Set(), parts: 0, parts_libres: 0 });
      ordreCreation.push(e.id);
    }
    return travaux.get(e.id)!;
  };
  const nom = (id: number) => pieces.get(id)?.nom ?? "?";

  function besoin(pid: number, q: number, articles: Set<number>, parent: Travail | null) {
    if (q <= 0) return;
    const entree = parent
      ? parent.entrees.get(pid) ?? parent.entrees.set(pid, { piece_id: pid, besoin: 0, en_stock: 0, fait_avant: 0, manque: 0 }).get(pid)!
      : null;
    if (entree) entree.besoin += q;
    const pris = Math.min(dispo.get(pid) ?? 0, q);
    dispo.set(pid, (dispo.get(pid) ?? 0) - pris);
    if (entree) entree.en_stock += pris;
    const reste = q - pris;
    if (!reste) return;

    const prods = producteurs.get(pid);
    if (!prods) {
      if (entree) entree.manque += reste;
      const p = pieces.get(pid);
      if (p && (p.niveau === "achete" || p.niveau === "recup")) aAcheter.set(pid, (aAcheter.get(pid) ?? 0) + reste);
      else problemes.add(`Aucune étape ne fabrique « ${nom(pid)} » : décrivez-la dans Réglages.`);
      return;
    }
    if (prods.length > 1) problemes.add(`Plusieurs étapes donnent « ${nom(pid)} » ; l'outil utilise « ${prods[0].nom} ».`);
    const e = prods[0];
    const t = travail(e);
    articles.forEach((a) => t.sert.add(a));
    if (parent) parent.avant.add(e.id);
    if (entree) entree.fait_avant += reste;

    const sortie = e.donne.find((d) => (d.au_choix ? d.choix.some((c) => c.piece_id === pid) : d.piece_id === pid))!;
    if (sortie.au_choix) {
      // Regroupé : on calcule le nombre de feuilles une fois toutes les demandes connues.
      const m = enAttente.get(e.id) ?? enAttente.set(e.id, new Map()).get(e.id)!;
      m.set(pid, (m.get(pid) ?? 0) + reste);
      const s = servisParAttente.get(e.id) ?? servisParAttente.set(e.id, new Set()).get(e.id)!;
      articles.forEach((a) => s.add(a));
      return;
    }
    const fois = Math.ceil(reste / sortie.quantite);
    lancer(e, t, fois, articles, pid, reste);
  }

  function lancer(e: Etape, t: Travail, fois: number, articles: Set<number>, pidDemande: number | null, quantiteDemande: number) {
    t.fois += fois;
    for (const d of e.donne) {
      if (d.au_choix) continue;
      const produit = d.quantite * fois;
      const garde = d.piece_id === pidDemande ? quantiteDemande : 0;
      const g = t.donne.get(d.piece_id!) ?? t.donne.set(d.piece_id!, { quantite: 0, reserve: 0 }).get(d.piece_id!)!;
      g.quantite += produit;
      g.reserve += produit - garde;
      dispo.set(d.piece_id!, (dispo.get(d.piece_id!) ?? 0) + produit - garde); // le surplus part en réserve
    }
    for (const u of e.utilise) besoin(u.piece_id, u.quantite * fois, articles, t);
  }

  for (const d of demandes) besoin(d.piece_id, d.quantite, new Set([d.piece_id]), null);

  // Étapes au choix (prints, gommes) : une seule fois pour toutes les demandes.
  while (enAttente.size) {
    const [eid, demandesChoix] = enAttente.entries().next().value!;
    enAttente.delete(eid);
    const e = etapes.find((x) => x.id === eid)!;
    const t = travaux.get(eid)!;
    const sortie = e.donne.find((d) => d.au_choix)!;
    const parts = [...demandesChoix].reduce((s, [pid, q]) => s + q * (sortie.choix.find((c) => c.piece_id === pid)?.poids ?? 1), 0);
    // Parts libres d'un passage précédent (si la même étape revient) : on les utilise d'abord.
    const aCouvrir = Math.max(0, parts - t.parts_libres);
    const fois = Math.ceil(aCouvrir / sortie.quantite);
    t.parts_libres = t.parts_libres + fois * sortie.quantite - parts;
    t.parts += parts;
    for (const [pid, q] of demandesChoix) {
      const g = t.donne.get(pid) ?? t.donne.set(pid, { quantite: 0, reserve: 0 }).get(pid)!;
      g.quantite += q;
    }
    if (fois) lancer(e, t, fois, servisParAttente.get(eid) ?? new Set(), null, 0);
  }

  // Ordre où les faire : une étape vient après celles qui préparent ses pièces.
  const ordre: number[] = [], vu = new Set<number>();
  const visiter = (id: number) => {
    if (vu.has(id)) return;
    vu.add(id);
    for (const a of travaux.get(id)!.avant) visiter(a);
    ordre.push(id);
  };
  ordreCreation.forEach(visiter);

  return {
    travaux: ordre.map((id) => travaux.get(id)!).filter((t) => t.fois > 0 || t.parts > 0),
    a_acheter: [...aAcheter].map(([piece_id, manque]) => ({ piece_id, nom: nom(piece_id), manque })),
    problemes: [...problemes],
  };
}

atelier.get("/atelier", async (c) => c.json(await planActuel(c.env.DB)));

/** Plan de la préparation en cours (partagé par l'Atelier et À acheter). */
export async function planActuel(db: D1Database) {
  const etat = await preparationsActuelles(db);
  if (etat.en_cours === null) return { preparation: null as null };
  const obj = await lireObjectifs(db, etat.en_cours);

  const [piecesRes, etapes] = await Promise.all([
    db.prepare(`SELECT p.id, p.nom, p.niveau, p.suivi, p.presque_vide, ${STOCK_SQL} AS stock FROM piece p WHERE p.retire = 0`).all<Piece>(),
    lireEtapesPourPlan(db),
  ]);
  const pieces = new Map(piecesRes.results.map((p) => [p.id, p]));

  const articles = obj.articles.filter((a) => a.a_avoir > 0).map((a) => ({
    piece_id: a.id, nom: a.nom, famille: a.famille, famille_id: a.famille_id,
    a_avoir: a.a_avoir, prets: Math.max(0, a.stock), manque: Math.max(0, a.a_avoir - Math.max(0, a.stock)),
    par_salon: a.par_salon,
  }));
  const plan = planifier(pieces, etapes, articles.filter((a) => a.manque > 0).map((a) => ({ piece_id: a.piece_id, quantite: a.manque })));
  const etapeParId = new Map(etapes.map((e) => [e.id, e]));
  const travaux = plan.travaux.map((t, i) => {
    const e = etapeParId.get(t.etape_id)!;
    return {
      numero: i + 1, etape_id: e.id, nom: e.nom, mode: e.mode, fois: t.fois,
      temps_min: e.temps_min === null ? null : e.temps_min * t.fois,
      donne: [...t.donne].map(([pid, g]) => ({ piece_id: pid, nom: pieces.get(pid)?.nom, quantite: g.quantite, reserve: g.reserve })),
      parts_libres: t.parts_libres,
      entrees: [
        ...[...t.entrees.values()].filter((x) => pieces.get(x.piece_id)?.suivi === "quantite").map((x) => ({ ...x, nom: pieces.get(x.piece_id)?.nom, sans_quantite: false, presque_vide: false })),
        ...e.utilise.filter((u) => pieces.get(u.piece_id)?.suivi !== "quantite").map((u) => ({
          piece_id: u.piece_id, nom: pieces.get(u.piece_id)?.nom, besoin: 0, en_stock: 0, fait_avant: 0, manque: 0,
          sans_quantite: true, presque_vide: !!pieces.get(u.piece_id)?.presque_vide,
        })),
      ],
      sert: [...t.sert],
    };
  });
  const sansTemps = travaux.filter((t) => t.temps_min === null).length;
  return {
    preparation: obj.preparation, salons: obj.salons, articles, travaux,
    travail_min: travaux.reduce((s, t) => s + (t.temps_min ?? 0), 0), etapes_sans_temps: sansTemps,
    a_acheter: plan.a_acheter, problemes: plan.problemes,
  };
}

async function lireEtapesPourPlan(db: D1Database): Promise<Etape[]> {
  const [e, u, d, ch] = await db.batch([
    db.prepare("SELECT id, famille_id, nom, mode, temps_min, ordre FROM etape"),
    db.prepare("SELECT etape_id, piece_id, quantite FROM etape_utilise"),
    db.prepare("SELECT id, etape_id, au_choix, piece_id, quantite FROM etape_donne"),
    db.prepare("SELECT etape_donne_id, piece_id, poids FROM etape_choix"),
  ]);
  const choix = ch.results as { etape_donne_id: number; piece_id: number; poids: number }[];
  return (e.results as Omit<Etape, "utilise" | "donne">[]).map((x) => ({
    ...x,
    utilise: (u.results as { etape_id: number; piece_id: number; quantite: number }[]).filter((y) => y.etape_id === x.id),
    donne: (d.results as { id: number; etape_id: number; au_choix: number; piece_id: number | null; quantite: number }[])
      .filter((y) => y.etape_id === x.id)
      .map((y) => ({ au_choix: !!y.au_choix, piece_id: y.piece_id, quantite: y.quantite, choix: choix.filter((z) => z.etape_donne_id === y.id) })),
  }));
}
