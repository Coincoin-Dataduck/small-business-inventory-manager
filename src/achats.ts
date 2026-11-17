// À acheter (spec §4) : chaque ligne détaille son calcul (« il en faut X − Y en stock − Z en route »)
// et une date « à commander avant le … » (premier salon − délai fournisseur).
// Boutons : Commandé / J'en ai déjà (= compter, côté écran) / Modifier. Puis Commandé → Reçu.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, entier, corps, choix } from "./outils";
import { planActuel } from "./atelier";
import { aujourdhui } from "./salons";

export const achats = new Hono<{ Bindings: Env }>();

const JOUR = 86_400_000;
const moinsJours = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") - n * JOUR).toISOString().slice(0, 10);

/** Quantité à commander arrondie au lot : la plus petite quantité ≥ besoin parmi des multiples d'une taille de lot. */
export function arrondirAuLot(besoin: number, lots: number[]) {
  if (besoin <= 0 || !lots.length) return { quantite: besoin, lots: null as null | { nombre: number; taille: number } };
  let meilleur = { quantite: Infinity, nombre: 0, taille: 0 };
  for (const t of [...lots].sort((a, b) => b - a)) {
    const n = Math.ceil(besoin / t);
    if (n * t < meilleur.quantite) meilleur = { quantite: n * t, nombre: n, taille: t };
  }
  return { quantite: meilleur.quantite, lots: { nombre: meilleur.nombre, taille: meilleur.taille } };
}

achats.get("/achats", async (c) => c.json(await calculerAchats(c.env.DB)));

/** Lignes à commander pour la préparation en cours (partagé par À acheter et l'Accueil). */
export async function calculerAchats(db: D1Database, planDeja?: Awaited<ReturnType<typeof planActuel>>) {
  const plan = planDeja ?? await planActuel(db);
  const [piecesR, lotsR, routeR, ajustR, commandesR] = await db.batch([
    db.prepare(`SELECT p.id, p.nom, p.niveau, p.suivi, p.delai_jours, p.mode_achat, p.presque_vide, f.nom AS famille, ${STOCK_SQL} AS stock
                FROM piece p JOIN famille f ON f.id = p.famille_id WHERE p.niveau IN ('achete', 'recup') AND p.retire = 0`),
    db.prepare("SELECT piece_id, taille FROM piece_lot ORDER BY taille"),
    db.prepare("SELECT piece_id, SUM(quantite) AS q FROM commande WHERE statut = 'commande' GROUP BY piece_id"),
    db.prepare("SELECT piece_id, quantite, avant_le FROM achat_ajustement"),
    db.prepare("SELECT c.id, c.piece_id, p.nom, p.suivi, c.quantite, c.taille_lot, c.commande_le FROM commande c JOIN piece p ON p.id = c.piece_id WHERE c.statut = 'commande' ORDER BY c.commande_le"),
  ]);
  type P = { id: number; nom: string; niveau: string; suivi: string; delai_jours: number | null; mode_achat: string | null; presque_vide: number; famille: string; stock: number };
  const pieces = piecesR.results as P[];
  const lots = new Map<number, number[]>();
  for (const l of lotsR.results as { piece_id: number; taille: number }[]) (lots.get(l.piece_id) ?? lots.set(l.piece_id, []).get(l.piece_id)!).push(l.taille);
  const enRoute = new Map((routeR.results as { piece_id: number; q: number }[]).map((x) => [x.piece_id, x.q]));
  const ajust = new Map((ajustR.results as { piece_id: number; quantite: number | null; avant_le: string | null }[]).map((x) => [x.piece_id, x]));

  // Besoin total de chaque fourniture dans le plan de la préparation en cours.
  const besoin = new Map<number, number>();
  if (plan.preparation) for (const t of plan.travaux) for (const e of t.entrees) if (!e.sans_quantite) besoin.set(e.piece_id, (besoin.get(e.piece_id) ?? 0) + e.besoin);
  const premier = plan.preparation ? plan.salons[0] : null;
  const ajd = aujourdhui();

  const lignes = [];
  const alertes: string[] = [];
  for (const p of pieces) {
    const a = ajust.get(p.id);
    if (p.suivi === "sans_quantite") {
      if (p.presque_vide && !enRoute.has(p.id))
        lignes.push({ piece_id: p.id, nom: p.nom, famille: p.famille, sans_quantite: true, calcul: "pot presque vide", a_commander: null, lots: null, avant_le: a?.avant_le ?? null, en_retard: false, tout_le_disponible: false, ajuste: !!a });
      continue;
    }
    const x = besoin.get(p.id) ?? 0, y = Math.max(0, p.stock), z = enRoute.get(p.id) ?? 0;
    const manque = Math.max(0, x - y - z);
    if (!manque && !a?.quantite) continue;
    if (p.mode_achat === "jamais" || p.niveau === "recup") {
      alertes.push(`Gardez de quoi faire ${manque} ${p.nom} (récup) : il en faut ${x}, il y en a ${y}.`);
      continue;
    }
    const arrondi = arrondirAuLot(manque, lots.get(p.id) ?? []);
    const avant_le = a?.avant_le ?? (premier && p.delai_jours !== null ? moinsJours(premier.date_debut, p.delai_jours) : null);
    lignes.push({
      piece_id: p.id, nom: p.nom, famille: p.famille, sans_quantite: false,
      calcul: `il en faut ${x} − ${y} en stock${z ? ` − ${z} en route` : ""} = ${manque}`,
      a_commander: a?.quantite ?? arrondi.quantite, lots: a?.quantite ? null : arrondi.lots, tailles_lot: lots.get(p.id) ?? [],
      avant_le, delai_inconnu: p.delai_jours === null && !a?.avant_le, en_retard: !!avant_le && avant_le < ajd,
      tout_le_disponible: p.mode_achat === "tout_le_disponible", ajuste: !!a,
    });
  }
  lignes.sort((a, b) => (a.avant_le ?? "9999").localeCompare(b.avant_le ?? "9999") || a.nom.localeCompare(b.nom));
  return { preparation: plan.preparation, salons: plan.preparation ? plan.salons : [], lignes, alertes, commandes: commandesR.results as { id: number; piece_id: number; nom: string }[] };
}

// Modifier une ligne : quantité et/ou date choisies à la main ; tout vide = revenir au calcul.
achats.put("/achats/ajustement", async (c) => {
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "fourniture", 1);
  const quantite = b.quantite === null || b.quantite === "" || b.quantite === undefined ? null : entier(b.quantite, "quantité", 1);
  let avant_le: string | null = null;
  if (b.avant_le) {
    if (typeof b.avant_le !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.avant_le)) erreur("Date invalide.");
    avant_le = b.avant_le;
  }
  const db = c.env.DB;
  if (quantite === null && avant_le === null) await db.prepare("DELETE FROM achat_ajustement WHERE piece_id = ?").bind(piece_id).run();
  else await db.prepare("INSERT INTO achat_ajustement (piece_id, quantite, avant_le) VALUES (?, ?, ?) ON CONFLICT (piece_id) DO UPDATE SET quantite = excluded.quantite, avant_le = excluded.avant_le")
    .bind(piece_id, quantite, avant_le).run();
  return c.json({ ok: true });
});

achats.post("/commandes", async (c) => {
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "fourniture", 1);
  const quantite = entier(b.quantite ?? 1, "quantité", 1);
  const taille_lot = b.taille_lot === undefined || b.taille_lot === null || b.taille_lot === "" ? null : entier(b.taille_lot, "taille du lot", 1);
  const db = c.env.DB;
  const p = await db.prepare("SELECT niveau FROM piece WHERE id = ?").bind(piece_id).first<{ niveau: string }>();
  if (!p) erreur("Fourniture introuvable.", 404);
  if (p.niveau !== "achete") erreur("Seules les fournitures achetées se commandent.");
  const r = await db.batch([
    db.prepare("INSERT INTO commande (piece_id, quantite, taille_lot) VALUES (?, ?, ?) RETURNING id").bind(piece_id, quantite, taille_lot),
    db.prepare("DELETE FROM achat_ajustement WHERE piece_id = ?").bind(piece_id),
  ]);
  return c.json({ id: (r[0].results[0] as { id: number }).id }, 201);
});

// Reçu : la quantité reçue entre en stock ; une taille de lot jusque-là inconnue est retenue.
achats.post("/commandes/:id/recu", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const db = c.env.DB;
  const cmd = await db.prepare("SELECT c.piece_id, c.quantite, c.taille_lot, p.suivi FROM commande c JOIN piece p ON p.id = c.piece_id WHERE c.id = ? AND c.statut = 'commande'")
    .bind(id).first<{ piece_id: number; quantite: number; taille_lot: number | null; suivi: string }>();
  if (!cmd) erreur("Commande introuvable ou déjà reçue.", 404);
  const quantite = b.quantite === undefined || b.quantite === "" ? cmd.quantite : entier(b.quantite, "quantité reçue", 0);
  const taille = b.taille_lot === undefined || b.taille_lot === "" || b.taille_lot === null ? cmd.taille_lot : entier(b.taille_lot, "taille du lot", 1);
  const stmts = [db.prepare("UPDATE commande SET statut = 'recu', recu_le = strftime('%Y-%m-%dT%H:%M:%fZ','now'), quantite = ?, taille_lot = ? WHERE id = ?").bind(Math.max(quantite, 1), taille, id)];
  if (cmd.suivi === "quantite" && quantite > 0)
    stmts.push(db.prepare("INSERT INTO mouvement (piece_id, quantite, motif, source_type, source_id) VALUES (?, ?, 'reception', 'commande', ?)").bind(cmd.piece_id, quantite, id));
  if (cmd.suivi === "sans_quantite") stmts.push(db.prepare("UPDATE piece SET presque_vide = 0 WHERE id = ?").bind(cmd.piece_id));
  if (taille) stmts.push(db.prepare("INSERT INTO piece_lot (piece_id, taille) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(cmd.piece_id, taille));
  await db.batch(stmts);
  return c.json({ ok: true });
});

achats.delete("/commandes/:id", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const r = await c.env.DB.prepare("DELETE FROM commande WHERE id = ? AND statut = 'commande'").bind(id).run();
  if (!r.meta.changes) erreur("Commande introuvable ou déjà reçue.", 404);
  return c.json({ ok: true });
});

// Réglages d'achat d'une fourniture : délai, mode, tailles de lot.
achats.put("/pieces/:id/achat", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const b = await corps(c);
  const delai = b.delai_jours === null || b.delai_jours === "" || b.delai_jours === undefined ? null : entier(b.delai_jours, "délai", 0);
  const mode = b.mode_achat === null || b.mode_achat === undefined || b.mode_achat === "" ? "quantite" : choix(b.mode_achat, ["quantite", "tout_le_disponible", "jamais"] as const, "mode d'achat");
  if (b.lots !== undefined && !Array.isArray(b.lots)) erreur("« lots » doit être une liste.");
  const tailles = [...new Set(((b.lots as unknown[]) ?? []).map((t) => entier(t, "taille du lot", 1)))];
  const db = c.env.DB;
  const r = await db.prepare("UPDATE piece SET delai_jours = ?, mode_achat = ? WHERE id = ?").bind(delai, mode, id).run();
  if (!r.meta.changes) erreur("Fourniture introuvable.", 404);
  if (b.lots !== undefined) await db.batch([
    db.prepare("DELETE FROM piece_lot WHERE piece_id = ?").bind(id),
    ...tailles.map((t) => db.prepare("INSERT INTO piece_lot (piece_id, taille) VALUES (?, ?)").bind(id, t)),
  ]);
  return c.json({ ok: true });
});

achats.get("/pieces/:id/achat", async (c) => {
  const id = entier(c.req.param("id"), "id", 1);
  const db = c.env.DB;
  const [p, l] = await db.batch([
    db.prepare("SELECT delai_jours, mode_achat FROM piece WHERE id = ?").bind(id),
    db.prepare("SELECT taille FROM piece_lot WHERE piece_id = ? ORDER BY taille").bind(id),
  ]);
  if (!p.results.length) erreur("Fourniture introuvable.", 404);
  return c.json({ ...(p.results[0] as object), lots: (l.results as { taille: number }[]).map((x) => x.taille) });
});
