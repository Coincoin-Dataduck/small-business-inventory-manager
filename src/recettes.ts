// Recettes (étapes) et « C'est fait ».
// Une étape transforme des pièces en d'autres pièces ; « C'est fait » l'enregistre dans le journal.
import { Hono } from "hono";
import { Env, erreur, texte, entier, choix, corps, lireLignesComptage, lirePieces, instructionsComptage } from "./outils";

export const recettes = new Hono<{ Bindings: Env }>();

const MODES = ["par_matiere", "a_la_piece"] as const;

type Utilise = { piece_id: number; quantite: number };
type Choix = { piece_id: number; poids: number };
type Donne = { au_choix: false; piece_id: number; quantite: number } | { au_choix: true; quantite: number; choix: Choix[] };
type EtapeSaisie = { famille_id: number; nom: string; mode: (typeof MODES)[number]; temps_min: number | null; ordre: number; utilise: Utilise[]; donne: Donne[] };

function lireEtape(b: Record<string, unknown>): EtapeSaisie {
  const nom = texte(b.nom, "nom");
  const famille_id = entier(b.famille_id, "famille", 1);
  const mode = choix(b.mode, MODES, "mode");
  let temps_min: number | null = null;
  if (b.temps_min !== undefined && b.temps_min !== null && b.temps_min !== "") {
    temps_min = Number(b.temps_min);
    if (!Number.isFinite(temps_min) || temps_min < 0) erreur("« temps » doit être un nombre de minutes ≥ 0.");
  }
  const ordre = b.ordre === undefined ? 0 : entier(b.ordre, "ordre");
  if (!Array.isArray(b.utilise)) erreur("« utilise » doit être une liste.");
  if (!Array.isArray(b.donne) || !b.donne.length) erreur("Une étape doit donner au moins quelque chose.");
  const utilise = b.utilise.map((u: Record<string, unknown>) => ({ piece_id: entier(u?.piece_id, "ce qu'elle utilise", 1), quantite: entier(u?.quantite, "quantité utilisée", 1) }));
  if (new Set(utilise.map((u) => u.piece_id)).size !== utilise.length) erreur("Un même élément apparaît deux fois dans « utilise ».");
  const donne: Donne[] = b.donne.map((d: Record<string, unknown>) => {
    if (d?.au_choix) {
      if (!Array.isArray(d.choix) || d.choix.length < 2) erreur("Une sortie au choix doit proposer au moins deux possibilités.");
      const ch = d.choix.map((x: Record<string, unknown>) => ({ piece_id: entier(x?.piece_id, "choix", 1), poids: entier(x?.poids ?? 1, "poids", 1) }));
      if (new Set(ch.map((x) => x.piece_id)).size !== ch.length) erreur("Un même élément apparaît deux fois dans le choix.");
      return { au_choix: true as const, quantite: entier(d.quantite, "capacité", 1), choix: ch };
    }
    return { au_choix: false as const, piece_id: entier(d?.piece_id, "ce qu'elle donne", 1), quantite: entier(d?.quantite, "quantité donnée", 1) };
  });
  const sorties = donne.flatMap((d) => (d.au_choix ? d.choix.map((x) => x.piece_id) : [d.piece_id]));
  if (new Set(sorties).size !== sorties.length) erreur("Un même élément apparaît deux fois dans « donne ».");
  if (sorties.some((id) => utilise.some((u) => u.piece_id === id))) erreur("Un élément ne peut pas être à la fois utilisé et donné.");
  return { famille_id, nom, mode, temps_min, ordre, utilise, donne };
}

async function verifierReferences(db: D1Database, e: EtapeSaisie) {
  if (!(await db.prepare("SELECT 1 FROM famille WHERE id = ?").bind(e.famille_id).first())) erreur("Famille introuvable.", 404);
  await lirePieces(db, [...e.utilise.map((u) => u.piece_id), ...e.donne.flatMap((d) => (d.au_choix ? d.choix.map((x) => x.piece_id) : [d.piece_id]))]);
}

/** Lignes « utilise » et « donne » d'une étape ; etapeId = null → la dernière étape créée dans le même lot. */
function instructionsContenu(db: D1Database, etapeId: number | null, e: EtapeSaisie) {
  // etapeId est un entier validé : on peut l'écrire directement dans la requête.
  const ref = etapeId === null ? "(SELECT MAX(id) FROM etape)" : String(Math.trunc(etapeId));
  const stmts: D1PreparedStatement[] = [];
  for (const u of e.utilise) stmts.push(db.prepare(`INSERT INTO etape_utilise (etape_id, piece_id, quantite) VALUES (${ref}, ?, ?)`).bind(u.piece_id, u.quantite));
  for (const d of e.donne) {
    if (!d.au_choix) {
      stmts.push(db.prepare(`INSERT INTO etape_donne (etape_id, piece_id, quantite) VALUES (${ref}, ?, ?)`).bind(d.piece_id, d.quantite));
    } else {
      stmts.push(db.prepare(`INSERT INTO etape_donne (etape_id, piece_id, quantite, au_choix) VALUES (${ref}, NULL, ?, 1)`).bind(d.quantite));
      for (const x of d.choix) stmts.push(db.prepare("INSERT INTO etape_choix (etape_donne_id, piece_id, poids) VALUES ((SELECT MAX(id) FROM etape_donne), ?, ?)").bind(x.piece_id, x.poids));
    }
  }
  return stmts;
}

type EtapeComplete = {
  id: number; famille_id: number; nom: string; mode: string; temps_min: number | null; ordre: number;
  utilise: { piece_id: number; nom: string; suivi: string; quantite: number }[];
  donne: { id: number; au_choix: boolean; piece_id: number | null; nom: string | null; quantite: number; choix: { piece_id: number; nom: string; poids: number }[] }[];
};

async function lireEtapes(db: D1Database, etapeId?: number): Promise<EtapeComplete[]> {
  const filtre = etapeId === undefined ? "" : " WHERE e.id = ?";
  const lier = (s: D1PreparedStatement) => (etapeId === undefined ? s : s.bind(etapeId));
  const [etapes, utilise, donne, choixRes] = await db.batch([
    lier(db.prepare(`SELECT e.id, e.famille_id, e.nom, e.mode, e.temps_min, e.ordre FROM etape e${filtre} ORDER BY e.ordre, e.id`)),
    lier(db.prepare(`SELECT u.etape_id, u.piece_id, p.nom, p.suivi, u.quantite FROM etape_utilise u JOIN piece p ON p.id = u.piece_id JOIN etape e ON e.id = u.etape_id${filtre} ORDER BY u.id`)),
    lier(db.prepare(`SELECT d.id, d.etape_id, d.au_choix, d.piece_id, p.nom, d.quantite FROM etape_donne d LEFT JOIN piece p ON p.id = d.piece_id JOIN etape e ON e.id = d.etape_id${filtre} ORDER BY d.id`)),
    lier(db.prepare(`SELECT c.etape_donne_id, c.piece_id, p.nom, c.poids FROM etape_choix c JOIN piece p ON p.id = c.piece_id JOIN etape_donne d ON d.id = c.etape_donne_id JOIN etape e ON e.id = d.etape_id${filtre} ORDER BY c.poids DESC, p.nom`)),
  ]);
  const choixPar = new Map<number, EtapeComplete["donne"][number]["choix"]>();
  for (const c of choixRes.results as { etape_donne_id: number; piece_id: number; nom: string; poids: number }[]) {
    if (!choixPar.has(c.etape_donne_id)) choixPar.set(c.etape_donne_id, []);
    choixPar.get(c.etape_donne_id)!.push({ piece_id: c.piece_id, nom: c.nom, poids: c.poids });
  }
  return (etapes.results as Omit<EtapeComplete, "utilise" | "donne">[]).map((e) => ({
    ...e,
    utilise: (utilise.results as (EtapeComplete["utilise"][number] & { etape_id: number })[])
      .filter((u) => u.etape_id === e.id).map(({ etape_id, ...u }) => u),
    donne: (donne.results as { id: number; etape_id: number; au_choix: number; piece_id: number | null; nom: string | null; quantite: number }[])
      .filter((d) => d.etape_id === e.id)
      .map((d) => ({ id: d.id, au_choix: !!d.au_choix, piece_id: d.piece_id, nom: d.nom, quantite: d.quantite, choix: choixPar.get(d.id) ?? [] })),
  }));
}

// ───────────── Lecture ─────────────
recettes.get("/etapes", async (c) => c.json(await lireEtapes(c.env.DB)));

// ───────────── Création / modification / suppression ─────────────
recettes.post("/etapes", async (c) => {
  const e = lireEtape(await corps(c));
  const db = c.env.DB;
  await verifierReferences(db, e);
  const res = await db.batch([
    db.prepare("INSERT INTO etape (famille_id, nom, mode, temps_min, ordre) VALUES (?, ?, ?, ?, ?)").bind(e.famille_id, e.nom, e.mode, e.temps_min, e.ordre),
    ...instructionsContenu(db, null, e),
    db.prepare("SELECT MAX(id) AS id FROM etape"),
  ]);
  return c.json({ id: (res[res.length - 1].results[0] as { id: number }).id }, 201);
});

recettes.put("/etapes/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const e = lireEtape(await corps(c));
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM etape WHERE id = ?").bind(id).first())) erreur("Étape introuvable.", 404);
  await verifierReferences(db, e);
  // Ce qui a déjà été fait reste dans le journal tel quel ; seule la recette change pour la suite.
  await db.batch([
    db.prepare("UPDATE etape SET famille_id = ?, nom = ?, mode = ?, temps_min = ?, ordre = ? WHERE id = ?").bind(e.famille_id, e.nom, e.mode, e.temps_min, e.ordre, id),
    db.prepare("DELETE FROM etape_utilise WHERE etape_id = ?").bind(id),
    db.prepare("DELETE FROM etape_donne WHERE etape_id = ?").bind(id),
    ...instructionsContenu(db, id, e),
  ]);
  return c.json({ ok: true });
});

recettes.delete("/etapes/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  if (await db.prepare("SELECT 1 FROM etape_faite WHERE etape_id = ? LIMIT 1").bind(id).first())
    erreur("Cette étape a déjà été faite : elle reste dans l'historique. Modifiez-la plutôt que de la supprimer.", 409);
  const r = await db.prepare("DELETE FROM etape WHERE id = ?").bind(id).run();
  if (!r.meta.changes) erreur("Étape introuvable.", 404);
  return c.json({ ok: true });
});

// ───────────── C'est fait ─────────────
// Corps : { fois, donne?: [{piece_id, quantite}], comptages?: [{piece_id, compte}] }
// - fois : pièces faites (à la pièce) ou matières entières utilisées (par matière entière).
// - donne : quantités réellement obtenues (par matière entière : rendement variable ; au choix : répartition obligatoire).
// - comptages : réponses à « combien en aviez-vous vraiment ? », enregistrées avant l'étape.
recettes.post("/etapes/:id/faite", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const fois = entier(b.fois, "nombre", 1);
  const comptages = b.comptages === undefined ? [] : lireLignesComptage(b.comptages);
  const declare = new Map<number, number>();
  if (b.donne !== undefined) {
    if (!Array.isArray(b.donne)) erreur("« donne » doit être une liste.");
    for (const d of b.donne as Record<string, unknown>[]) {
      const pid = entier(d?.piece_id, "ce qui est obtenu", 1);
      if (declare.has(pid)) erreur("Un même élément obtenu apparaît deux fois.");
      declare.set(pid, entier(d?.quantite, "quantité obtenue", 0));
    }
  }

  const db = c.env.DB;
  const [etape] = await lireEtapes(db, id);
  if (!etape) erreur("Étape introuvable.", 404);

  // Sorties : à la pièce → exactement prévu × fois ; par matière entière → ce qui est déclaré (prévu par défaut).
  const sorties: { piece_id: number; quantite: number }[] = [];
  const permises = new Set<number>();
  for (const d of etape.donne) {
    if (!d.au_choix) {
      permises.add(d.piece_id!);
      const prevu = d.quantite * fois;
      const q = etape.mode === "par_matiere" && declare.has(d.piece_id!) ? declare.get(d.piece_id!)! : prevu;
      sorties.push({ piece_id: d.piece_id!, quantite: q });
    } else {
      const capacite = d.quantite * fois;
      let utilisee = 0;
      for (const x of d.choix) {
        permises.add(x.piece_id);
        const q = declare.get(x.piece_id) ?? 0;
        utilisee += q * x.poids;
        sorties.push({ piece_id: x.piece_id, quantite: q });
      }
      if (utilisee === 0) erreur("Indiquez ce qui est sorti (quoi, combien).");
      if (utilisee > capacite) erreur(`Trop déclaré : la capacité est de ${capacite} part(s), vous en avez déclaré ${utilisee}.`);
    }
  }
  for (const pid of declare.keys()) if (!permises.has(pid)) erreur("Un élément déclaré ne sort pas de cette étape.");

  // Utilisations : vérifie le stock (après les comptages fournis).
  const pieces = await lirePieces(db, [...etape.utilise.map((u) => u.piece_id), ...comptages.map((l) => l.piece_id)]);
  for (const l of comptages) if (pieces.get(l.piece_id)!.suivi !== "quantite") erreur("Cet élément ne se compte pas.");
  const compte = new Map(comptages.map((l) => [l.piece_id, l.compte]));
  const manque = etape.utilise
    .filter((u) => u.suivi === "quantite")
    .map((u) => ({ piece_id: u.piece_id, nom: u.nom, stock: compte.get(u.piece_id) ?? pieces.get(u.piece_id)!.stock, besoin: u.quantite * fois }))
    .filter((m) => m.stock < m.besoin);
  if (manque.length) return c.json({ erreur: "Le stock de l'outil ne suffit pas.", manque }, 409);

  const ref = "(SELECT MAX(id) FROM etape_faite)";
  const stmts = [
    ...(comptages.length ? instructionsComptage(db, comptages, "libre", null) : []),
    db.prepare("INSERT INTO etape_faite (etape_id, fois) VALUES (?, ?)").bind(id, fois),
  ];
  for (const u of etape.utilise) {
    if (u.suivi !== "quantite") continue; // peinture : pas de quantité
    stmts.push(db.prepare(`INSERT INTO mouvement (piece_id, quantite, motif, source_type, source_id) VALUES (?, ?, 'etape', 'etape_faite', ${ref})`).bind(u.piece_id, -u.quantite * fois));
  }
  for (const s of sorties) {
    if (s.quantite === 0) continue;
    stmts.push(db.prepare(`INSERT INTO mouvement (piece_id, quantite, motif, source_type, source_id) VALUES (?, ?, 'etape', 'etape_faite', ${ref})`).bind(s.piece_id, s.quantite));
  }
  stmts.push(db.prepare("SELECT MAX(id) AS id FROM etape_faite"));
  const res = await db.batch(stmts);
  return c.json({ id: (res[res.length - 1].results[0] as { id: number }).id, sorties: sorties.filter((s) => s.quantite) }, 201);
});

// Dernières étapes faites (pour corriger une erreur de saisie).
recettes.get("/etapes-faites", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.etape_id, e.nom, f.fois, f.date FROM etape_faite f JOIN etape e ON e.id = f.etape_id ORDER BY f.id DESC LIMIT 20`,
  ).all();
  return c.json(results);
});

// Annuler une saisie « C'est fait » : retire ses mouvements (les comptages faits en même temps restent : ils sont vrais).
recettes.delete("/etapes-faites/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const res = await db.batch([
    db.prepare("DELETE FROM mouvement WHERE source_type = 'etape_faite' AND source_id = ?").bind(id),
    db.prepare("DELETE FROM etape_faite WHERE id = ?").bind(id),
  ]);
  if (!res[1].meta.changes) erreur("Saisie introuvable.", 404);
  return c.json({ ok: true });
});
