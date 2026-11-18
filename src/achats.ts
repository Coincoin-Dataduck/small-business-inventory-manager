// Commandes (Commandé → Reçu) et réglages d'achat d'une fourniture. Ce qu'il faut commander vient de l'écran de préparation.
import { Hono } from "hono";
import { Env, STOCK_SQL, erreur, entier, corps, choix } from "./outils";

export const achats = new Hono<{ Bindings: Env }>();


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

achats.post("/commandes", async (c) => {
  const b = await corps(c);
  const piece_id = entier(b.piece_id, "fourniture", 1);
  const quantite = entier(b.quantite ?? 1, "quantité", 1);
  const taille_lot = b.taille_lot === undefined || b.taille_lot === null || b.taille_lot === "" ? null : entier(b.taille_lot, "taille du lot", 1);
  const db = c.env.DB;
  const p = await db.prepare("SELECT niveau FROM piece WHERE id = ?").bind(piece_id).first<{ niveau: string }>();
  if (!p) erreur("Fourniture introuvable.", 404);
  if (p.niveau !== "achete" && p.niveau !== "a_vendre") erreur("Seules les fournitures achetées (ou les articles revendus) se commandent.");
  const r = await db.prepare("INSERT INTO commande (piece_id, quantite, taille_lot) VALUES (?, ?, ?) RETURNING id").bind(piece_id, quantite, taille_lot).first<{ id: number }>();
  return c.json({ id: r!.id }, 201);
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
  const seuil = b.seuil === null || b.seuil === "" || b.seuil === undefined ? null : entier(b.seuil, "seuil d'alerte", 0);
  const r = await db.prepare("UPDATE piece SET delai_jours = ?, mode_achat = ?, seuil = ? WHERE id = ?").bind(delai, mode, seuil, id).run();
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
    db.prepare("SELECT delai_jours, mode_achat, seuil FROM piece WHERE id = ?").bind(id),
    db.prepare("SELECT taille FROM piece_lot WHERE piece_id = ? ORDER BY taille").bind(id),
  ]);
  if (!p.results.length) erreur("Fourniture introuvable.", 404);
  return c.json({ ...(p.results[0] as object), lots: (l.results as { taille: number }[]).map((x) => x.taille) });
});
