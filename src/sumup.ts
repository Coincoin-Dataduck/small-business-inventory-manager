// Import des ventes SumUp et application au stock.
// - Seuls les paiements réussis sont des ventes (les refusés arrivent aussi avec leurs articles).
// - SumUp ne donne pas d'identifiant d'article : nom + description nettoyés → table de correspondance.
// - Une vente ne retire une pièce du stock que si elle a eu lieu après le début de son suivi
//   (premier mouvement autre qu'une vente) : l'historique ancien sert aux statistiques, pas au stock.
// - Import par tranches : le Worker gratuit est limité à 50 appels externes par exécution.
import { Env } from "./outils";

const BASE = "https://api.sumup.com";
const PAGE = 100;

export function cleSumUp(nom: string, description?: string | null) {
  const n = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const d = description ? n(description) : "";
  return d ? `${n(nom)} | ${d}` : n(nom);
}

const jourParis = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));

type Produit = { name?: string; description?: string; quantity?: number; price?: number; price_with_vat?: number };
type Item = { id: string; transaction_code?: string; type?: string; status?: string; amount?: number; refunded_amount?: number; timestamp: string; product_summary?: string };

async function questionUnique(db: D1Database, type: string, cleDetail: string, valeur: string, detail: Record<string, unknown>, piece_id: number | null = null) {
  const existe = await db.prepare(`SELECT id FROM question WHERE type = ? AND repondu_le IS NULL AND json_extract(detail, '$.${cleDetail}') = ?`)
    .bind(type, valeur).first<{ id: number }>();
  if (!existe) await db.prepare("INSERT INTO question (type, piece_id, detail) VALUES (?, ?, ?)").bind(type, piece_id, JSON.stringify(detail)).run();
}

type LigneAAppliquer = { source_id: number; q: number; date: string; piece_id: number; suivi: string; debut_suivi: string | null };

/** Écrit les mouvements de vente (carte ou espèces) et pose la question « vente impossible » si une pièce passe sous zéro. */
async function ecrireVentes(db: D1Database, lignes: LigneAAppliquer[], motif: "vente" | "vente_especes", source_type: "vente_ligne" | "vente_especes") {
  const aAppliquer = lignes.filter((r) => r.suivi === "quantite" && r.debut_suivi !== null && r.date > r.debut_suivi && r.q > 0);
  if (!aAppliquer.length) return 0;
  const touchees = new Map<number, number>();
  for (const r of aAppliquer) touchees.set(r.piece_id, (touchees.get(r.piece_id) ?? 0) + r.q);

  // Stock avant ces ventes, pour la question éventuelle.
  const ids = [...touchees.keys()];
  const { results: avant } = await db.prepare(
    `SELECT piece_id, COALESCE(SUM(quantite), 0) AS stock FROM mouvement WHERE piece_id IN (${ids.map(() => "?").join(",")}) GROUP BY piece_id`,
  ).bind(...ids).all<{ piece_id: number; stock: number }>();
  const stockAvant = new Map(avant.map((x) => [x.piece_id, x.stock]));

  await db.batch(aAppliquer.map((r) => db.prepare(
    "INSERT INTO mouvement (piece_id, quantite, motif, date, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(r.piece_id, -r.q, motif, r.date, source_type, r.source_id)));

  for (const [pid, vendus] of touchees) {
    const s0 = stockAvant.get(pid) ?? 0;
    if (s0 - vendus >= 0) continue;
    // Anti-oubli : une seule question ouverte par pièce, qui cumule les ventes.
    const q = await db.prepare("SELECT id, detail FROM question WHERE type = 'vente_impossible' AND piece_id = ? AND repondu_le IS NULL").bind(pid).first<{ id: number; detail: string }>();
    if (q) {
      const d = JSON.parse(q.detail);
      d.vendus += vendus;
      await db.prepare("UPDATE question SET detail = ? WHERE id = ?").bind(JSON.stringify(d), q.id).run();
    } else {
      await db.prepare("INSERT INTO question (type, piece_id, detail) VALUES ('vente_impossible', ?, ?)")
        .bind(pid, JSON.stringify({ stock_avant: Math.max(0, s0), vendus })).run();
    }
  }
  return aAppliquer.length;
}

const DEBUT_SUIVI = "(SELECT MIN(m.date) FROM mouvement m WHERE m.piece_id = cp.piece_id AND m.motif NOT IN ('vente', 'vente_especes'))";

/** Applique au stock les ventes carte pas encore appliquées (filtrées par vente ou par nom de caisse). */
export async function appliquerVentes(db: D1Database, filtre: { vente_id?: number; cle?: string }) {
  const cond = filtre.vente_id !== undefined ? "vl.vente_id = ?" : "vl.cle = ?";
  const { results } = await db.prepare(
    `SELECT vl.id AS source_id, vl.quantite * cp.quantite AS q, v.date, cp.piece_id, p.suivi, ${DEBUT_SUIVI} AS debut_suivi
     FROM vente_ligne vl
     JOIN vente v ON v.id = vl.vente_id
     JOIN correspondance c ON c.cle = vl.cle AND c.ne_pas_suivre = 0
     JOIN correspondance_piece cp ON cp.cle = c.cle
     JOIN piece p ON p.id = cp.piece_id
     WHERE ${cond}
       AND NOT EXISTS (SELECT 1 FROM mouvement m2 WHERE m2.source_type = 'vente_ligne' AND m2.source_id = vl.id AND m2.piece_id = cp.piece_id)
     ORDER BY v.date`,
  ).bind(filtre.vente_id ?? filtre.cle).all<LigneAAppliquer>();
  return ecrireVentes(db, results, "vente", "vente_ligne");
}

/** Applique au stock les ventes en espèces saisies au bilan (datées du dernier jour du salon). */
export async function appliquerEspeces(db: D1Database, filtre: { salon_id?: number; cle?: string }) {
  const cond = filtre.salon_id !== undefined ? "ve.salon_id = ?" : "ve.cle = ?";
  const { results } = await db.prepare(
    `SELECT ve.id AS source_id, ve.quantite * cp.quantite AS q,
            date(s.date_debut, '+' || (s.nb_jours - 1) || ' days') || 'T18:00:00.000Z' AS date,
            cp.piece_id, p.suivi, ${DEBUT_SUIVI} AS debut_suivi
     FROM vente_especes ve
     JOIN salon s ON s.id = ve.salon_id
     JOIN correspondance c ON c.cle = ve.cle AND c.ne_pas_suivre = 0
     JOIN correspondance_piece cp ON cp.cle = c.cle
     JOIN piece p ON p.id = cp.piece_id
     WHERE ${cond}
       AND NOT EXISTS (SELECT 1 FROM mouvement m2 WHERE m2.source_type = 'vente_especes' AND m2.source_id = ve.id AND m2.piece_id = cp.piece_id)`,
  ).bind(filtre.salon_id ?? filtre.cle).all<LigneAAppliquer>();
  return ecrireVentes(db, results, "vente_especes", "vente_especes");
}

async function enregistrerVente(db: D1Database, item: Item, produits: Produit[]) {
  const jour = jourParis(item.timestamp);
  const salon = await db.prepare(
    "SELECT id FROM salon WHERE date_debut <= ?1 AND date(date_debut, '+' || (nb_jours - 1) || ' days') >= ?1 ORDER BY date_debut LIMIT 1",
  ).bind(jour).first<{ id: number }>();
  const v = await db.prepare(
    "INSERT INTO vente (sumup_id, transaction_code, date, jour, montant, salon_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (sumup_id) DO NOTHING RETURNING id",
  ).bind(item.id, item.transaction_code ?? null, item.timestamp, jour, item.amount ?? 0, salon?.id ?? null).first<{ id: number }>();
  if (!v) return false;

  const lignes = produits.length ? produits : [{ name: item.product_summary || "(vente sans détail)", quantity: 1, price: item.amount }];
  const cles = new Map<string, { nom: string; description: string | null }>();
  await db.batch(lignes.map((p) => {
    const nom = (p.name ?? "").trim() || "(sans nom)";
    const description = p.description?.trim() || null;
    const cle = cleSumUp(nom, description);
    cles.set(cle, { nom, description });
    return db.prepare("INSERT INTO vente_ligne (vente_id, nom, description, cle, quantite, prix) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(v.id, nom, description, cle, Math.max(1, Math.round(p.quantity ?? 1)), p.price_with_vat ?? p.price ?? null); // prix TTC (SumUp donne « price » hors TVA)
  }));

  for (const [cle, x] of cles) {
    const connue = await db.prepare("SELECT 1 FROM correspondance WHERE cle = ?").bind(cle).first();
    if (!connue) await questionUnique(db, "nom_inconnu", "cle", cle, { cle, nom: x.nom, description: x.description });
  }
  await appliquerVentes(db, { vente_id: v.id });
  if ((item.refunded_amount ?? 0) > 0)
    await questionUnique(db, "remboursement", "sumup_id", item.id, { sumup_id: item.id, date: item.timestamp, montant: item.refunded_amount, vente_id: v.id });
  return true;
}

export type BilanImport = { nouvelles: number; lues: number; a_jour: boolean; appels: number; erreur?: string };

export async function importer(env: Env, maxAppels = 40): Promise<BilanImport> {
  const db = env.DB;
  const bilan: BilanImport = { nouvelles: 0, lues: 0, a_jour: false, appels: 0 };
  if (!env.SUMUP_API_KEY) return { ...bilan, erreur: "Clé SumUp absente : à enregistrer comme secret du Worker (SUMUP_API_KEY)." };
  const base = env.SUMUP_BASE || BASE;

  const get = async (chemin: string, params: Record<string, string> = {}) => {
    bilan.appels++;
    const url = base + chemin + (Object.keys(params).length ? "?" + new URLSearchParams(params) : "");
    const r = await fetch(url, { headers: { Authorization: "Bearer " + env.SUMUP_API_KEY, Accept: "application/json" } });
    if (!r.ok) throw new Error(`SumUp a répondu ${r.status}.`);
    return r.json<Record<string, unknown>>();
  };

  const etat = await db.prepare("SELECT depuis, dernier_id FROM import_etat WHERE id = 1").first<{ depuis: string | null; dernier_id: string | null }>();
  const reglageDepuis = await db.prepare("SELECT valeur FROM reglage WHERE cle = 'import_depuis'").first<{ valeur: string }>();
  const depuis = etat?.depuis ?? `${reglageDepuis?.valeur ?? "2025-12-01"}T00:00:00Z`;
  let ref = etat?.dernier_id ?? null;

  try {
    let mc = (await db.prepare("SELECT valeur FROM reglage WHERE cle = 'sumup_merchant'").first<{ valeur: string }>())?.valeur;
    if (!mc) {
      const me = await get("/v0.1/me");
      mc = (me.merchant_profile as { merchant_code?: string } | undefined)?.merchant_code;
      if (!mc) throw new Error("Profil marchand SumUp illisible.");
      await db.prepare("INSERT INTO reglage (cle, valeur) VALUES ('sumup_merchant', ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur").bind(mc).run();
    }

    pages: while (bilan.appels < maxAppels) {
      const params: Record<string, string> = { limit: String(PAGE), order: "ascending", oldest_time: depuis };
      if (ref) params.oldest_ref = ref;
      const page = await get(`/v2.1/merchants/${mc}/transactions/history`, params);
      const items = (page.items as Item[]) ?? [];
      for (const it of items) {
        if (it.type === "PAYMENT" && it.status === "SUCCESSFUL") {
          const deja = await db.prepare("SELECT 1 FROM vente WHERE sumup_id = ?").bind(it.id).first();
          if (!deja) {
            if (bilan.appels >= maxAppels) break pages; // la suite au prochain passage
            const detail = await get(`/v2.1/merchants/${mc}/transactions`, { id: it.id });
            if (await enregistrerVente(db, it, (detail.products as Produit[]) ?? [])) bilan.nouvelles++;
          }
        } else if (it.type && it.type !== "PAYMENT" && it.status === "SUCCESSFUL") {
          // Remboursement ou autre opération : format jamais observé, on pose la question plutôt que de deviner.
          await questionUnique(db, "remboursement", "sumup_id", it.id, { sumup_id: it.id, date: it.timestamp, montant: it.amount, type: it.type });
        }
        ref = it.id;
        bilan.lues++;
      }
      if (items.length < PAGE) { bilan.a_jour = true; break; }
    }
  } catch (e) {
    bilan.erreur = String(e instanceof Error ? e.message : e);
  }

  await db.prepare(
    `INSERT INTO import_etat (id, depuis, dernier_id, maj_le, resultat, a_jour) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET depuis = excluded.depuis, dernier_id = excluded.dernier_id, maj_le = excluded.maj_le, resultat = excluded.resultat, a_jour = excluded.a_jour`,
  ).bind(depuis, ref, new Date().toISOString(), JSON.stringify(bilan), bilan.a_jour ? 1 : 0).run();
  return bilan;
}
