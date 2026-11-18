// Interface ordinateur. Aucun framework : petites fonctions qui construisent le DOM.

const NIVEAUX = { a_vendre: "À vendre", fait_maison: "Fourniture maison", achete: "Fourniture achetée", recup: "Récup" };
const SUIVIS = {
  quantite: "Compté à la pièce",
  sans_quantite: "Sans quantité (ex. peinture)",
};
const PAGES = [
  { id: "accueil", label: "Accueil" },
  { id: "stock", label: "Stock" },
  { id: "preparation", label: "Préparation" },
  { id: "salons", label: "Salons" },
  { id: "questions", label: "Questions" },
  { id: "reglages", label: "Réglages" },
];

// ───────────── Outils ─────────────
function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const e of enfants.flat(Infinity)) if (e !== null && e !== undefined && e !== false) el.append(e instanceof Node ? e : String(e));
  return el;
}

async function api(chemin, options = {}) {
  const r = await fetch("/api" + chemin, {
    ...options,
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erreur || "Le serveur n'a pas répondu correctement.");
  return data;
}

let flashTimer;
function flash(message, estErreur = false) {
  const el = document.getElementById("flash");
  el.textContent = message;
  el.className = "flash" + (estErreur ? " erreur" : "");
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.hidden = true), estErreur ? 8000 : 4000);
}

async function tenter(fn) {
  try { await fn(); } catch (e) { flash(e.message, true); }
}

function signe(n) { return n > 0 ? "+" + n : String(n); }

// ───────────── Navigation ─────────────
const etat = {
  page: "stock", filtre: null, filtreType: null, pasComptes: false, depuis: null, depuisSalon: null, comptage: null, ligneEnCours: null, stock: [], familles: [], edition: null,
  etapes: [], editeur: null, fait: null, faites: [],
  questions: [], nbQuestions: null, import: null, correspondances: [], corrEdition: null,
  params: [], salons: null, salonEdition: null, objectifs: null, plan: null, comptageAvant: null,
};

// Adresses : #stock, #stock/avant/<salon>, #preparation, #salons, #bilan/<salon>, #reglages, #reglages/recettes[/<cible>]
function pageCourante() {
  const [id, ...params] = location.hash.replace("#", "").split("/");
  etat.params = params;
  if (["atelier", "achats", "objectifs"].includes(id)) return "preparation"; // anciennes adresses
  if (id === "recettes") { etat.params = ["recettes", ...params]; return "reglages"; }
  if (id === "bilan" && params[0]) return "bilan";
  return PAGES.some((p) => p.id === id && !p.bientot) ? id : "accueil";
}

function dessinerMenu() {
  const nav = document.getElementById("nav");
  nav.replaceChildren(
    ...PAGES.map((p) =>
      h("button", {
        "aria-current": etat.page === p.id || (etat.page === "bilan" && p.id === "salons") ? "page" : null,
        disabled: p.bientot,
        title: p.bientot ? "Pas encore construit" : null,
        onclick: () => { location.hash = p.id; },
      }, p.label, p.bientot ? h("span", { class: "bientot" }, "bientôt") : null,
        p.id === "questions" && etat.nbQuestions ? h("span", { class: "pastille-nb" }, etat.nbQuestions) : null,
        p.id === "stock" && (etat.comptage || comptageGarde()) ? h("span", { class: "pastille-nb", title: "Comptage en cours (ce qui est compté est déjà enregistré)" }, "comptage") : null),
    ),
  );
}

async function afficher() {
  etat.page = pageCourante();
  dessinerMenu();
  if (etat.page !== "questions") compterQuestions();
  await tenter(async () => {
    if (etat.page === "accueil") await pageAccueil();
    if (etat.page === "stock") await pageStock();
    if (etat.page === "reglages") await pageReglages();
    if (etat.page === "preparation") await pagePreparation();
    if (etat.page === "salons") await pageSalons();
    if (etat.page === "questions") await pageQuestions();
    if (etat.page === "bilan") await pageBilan(Number(etat.params[0]));
  });
}

function entete(titre, action) {
  document.getElementById("titre").textContent = titre;
  document.getElementById("action").replaceChildren(...(action ? [action] : []));
}

// ───────────── Stock ─────────────
// Comptage : etat.comptage = { valeurs: { [id]: quantité confirmée }, ordre: [ids, le plus récent d'abord],
//   mode: "chercher" | "liste", recherche, choisi, creation, pasComptes, focus }.
// Une case affiche toujours un chiffre (l'attendu, ou ce qui a déjà été compté). « 12 » remplace,
// « +5 » / « -2 » ajoute ou retire au chiffre de la case. Entrée ou ✓ = compté.
async function pageStock() {
  const [stock, ce] = await Promise.all([api("/stock"), api("/comptages/etat")]);
  etat.stock = stock; etat.depuis = ce.depuis; etat.depuisSalon = ce.salon;
  reprendreComptage();
  // Comptage avant une préparation : #stock/avant/<premier salon>
  if (etat.params[0] === "avant" && etat.params[1] && etat.comptage === null) {
    const salons = await api("/salons");
    const prep = salons.preparations.find((p) => p.id === Number(etat.params[1]));
    if (prep) {
      etat.comptageAvant = { salon_id: prep.id, nom: nomPreparation(prep, salons.salons) };
      etat.filtreType = "a_vendre";
      demarrerComptage();
    }
  }
  dessinerStock();
}

const sansAccent = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const estComptable = (p) => p.suivi === "quantite";
const piecesListe = () => etat.stock.flatMap((f) => f.pieces.map((p) => ({ ...p, famille: f.nom })));
const pieceDe = (id) => piecesListe().find((p) => p.id === id);
const filtreOk = (p) => (etat.filtre === null || p.famille_id === etat.filtre) && (!etat.filtreType || p.niveau === etat.filtreType);
const valeurSession = (p) => etat.comptage?.valeurs[p.id];
const valeurCase = (p) => valeurSession(p) ?? p.stock;
const compteRecemment = (p) => !!p.dernier_comptage && !!etat.depuis && p.dernier_comptage >= etat.depuis;
const refComptage = () => (etat.depuisSalon ? "depuis " + etat.depuisSalon : "aujourd'hui");
// Fin de série sans stock : plus rien à compter.
const aSuivre = (p) => estComptable(p) && !(p.fin_de_serie && p.stock <= 0);
const aCompter = (p) => aSuivre(p) && !dejaCompte(p);
const dejaCompte = (p) => valeurSession(p) !== undefined || compteRecemment(p);

function lireSaisie(texte, base) {
  const t = String(texte).replace(/\s/g, "");
  let m;
  if ((m = /^([+-])(\d+)$/.exec(t))) {
    const r = m[1] === "+" ? base + Number(m[2]) : base - Number(m[2]);
    if (r < 0) throw new Error(`${base} ${m[1]} ${m[2]} donne ${r} : impossible de compter moins de 0.`);
    return r;
  }
  if (/^\d+$/.test(t)) return Number(t);
  throw new Error(`« ${texte} » : tapez un nombre (12), ou +5 / -2 pour ajouter ou retirer.`);
}

// Chaque ligne comptée est enregistrée tout de suite (comme partout ailleurs) ; ↺ l'annule.
async function confirmer(p, valeur) {
  const c = etat.comptage;
  const avant = etat.comptageAvant;
  const r = await api("/comptages", { method: "POST", body: { lignes: [{ piece_id: p.id, compte: valeur }], ...(avant ? { type: "avant", salon_id: avant.salon_id } : {}) } });
  const l = r.lignes[0];
  if (c.attendus[p.id] === undefined) c.attendus[p.id] = l.attendu;
  (c.lignes[p.id] ||= []).push(l.id);
  c.valeurs[p.id] = valeur;
  c.ordre = [p.id, ...c.ordre.filter((x) => x !== p.id)];
  garderComptage();
  await rafraichirStock();
}
async function retirer(p) {
  const c = etat.comptage;
  for (const id of [...(c.lignes[p.id] ?? [])].reverse()) await api("/comptages/lignes/" + id, { method: "DELETE" }).catch(() => {});
  oublierLigne(p.id);
  await rafraichirStock();
  flash(`« ${p.nom ?? "Ligne"} » : comptage annulé, le chiffre d'avant est revenu.`);
}
function oublierLigne(id) {
  const c = etat.comptage;
  delete c.valeurs[id]; delete c.lignes[id]; delete c.attendus[id];
  c.ordre = c.ordre.filter((x) => x !== Number(id));
  garderComptage();
}
async function rafraichirStock() {
  const [stock, ce] = await Promise.all([api("/stock"), api("/comptages/etat")]);
  etat.stock = stock; etat.depuis = ce.depuis; etat.depuisSalon = ce.salon;
}

// Comptage en cours gardé dans ce navigateur à chaque ligne : rien n'est perdu si la page se recharge
// ou si l'on change d'écran (chaque ligne est déjà enregistrée sur le serveur ; ceci garde la liste « comptés »).
const CLE_COMPTAGE = "stock-hervine:comptage-en-cours";
function garderComptage() {
  try {
    if (!etat.comptage || !Object.keys(etat.comptage.valeurs).length) { localStorage.removeItem(CLE_COMPTAGE); return; }
    localStorage.setItem(CLE_COMPTAGE, JSON.stringify({ valeurs: etat.comptage.valeurs, ordre: etat.comptage.ordre, lignes: etat.comptage.lignes, attendus: etat.comptage.attendus, mode: etat.comptage.mode, avant: etat.comptageAvant, le: new Date().toISOString() }));
  } catch {}
  finally { dessinerMenu(); }
}
function oublierComptage() { try { localStorage.removeItem(CLE_COMPTAGE); } catch {} dessinerMenu(); }
function comptageGarde() { try { return JSON.parse(localStorage.getItem(CLE_COMPTAGE) || "null"); } catch { return null; } }
function reprendreComptage() {
  const g = comptageGarde();
  if (!g || etat.comptage) return false;
  const existe = new Set(piecesListe().map((p) => p.id));
  demarrerComptage();
  for (const [id, v] of Object.entries(g.valeurs)) if (existe.has(Number(id))) {
    etat.comptage.valeurs[id] = v;
    etat.comptage.lignes[id] = g.lignes?.[id] ?? [];
    if (g.attendus?.[id] !== undefined) etat.comptage.attendus[id] = g.attendus[id];
  }
  etat.comptage.ordre = (g.ordre ?? []).filter((id) => etat.comptage.valeurs[id] !== undefined);
  etat.comptage.mode = g.mode ?? "chercher";
  if (g.avant) etat.comptageAvant = g.avant;
  const n = Object.keys(etat.comptage.valeurs).length;
  flash(`Comptage en cours repris : ${n} ligne${n > 1 ? "s" : ""} déjà comptée${n > 1 ? "s" : ""} (et enregistrée${n > 1 ? "s" : ""}).`);
  return true;
}

// Familles et lignes après les filtres famille et type (sans le filtre « pas encore comptés »).
function piecesVisibles() {
  return etat.stock.filter((f) => etat.filtre === null || f.id === etat.filtre)
    .map((f) => ({ ...f, pieces: f.pieces.filter((p) => !etat.filtreType || p.niveau === etat.filtreType) }));
}

function dessinerStock() {
  const c = etat.comptage, enComptage = c !== null;
  entete(etat.comptageAvant ? "Comptage avant · " + etat.comptageAvant.nom : enComptage ? "Comptage" : "Stock",
    enComptage ? null : h("button", { class: "btn", onclick: () => { demarrerComptage(); dessinerStock(); } }, "Faire un comptage"));
  const page = document.getElementById("page");

  if (!etat.stock.length) {
    page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" },
      h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucune famille pour l'instant. Créez la première :")), formNouvelleFamille()));
    return;
  }

  const pastille = (actif, texte, onclick) => h("button", { class: "pastille-filtre", "aria-pressed": String(actif), onclick }, texte);
  const filtres = h("div", { class: "filtres-stock" },
    h("div", { class: "filtres" }, [{ id: null, nom: "Toutes les familles" }, ...etat.stock].map((f) =>
      pastille(etat.filtre === f.id, f.nom, () => { etat.filtre = f.id; dessinerStock(); }))),
    h("div", { class: "filtres" },
      h("button", { class: "pastille-filtre filtre-a-compter", "aria-pressed": String(etat.pasComptes), title: "Pas compté " + refComptage(),
        onclick: () => { etat.pasComptes = !etat.pasComptes; dessinerStock(); } },
        `Pas encore comptés (${piecesVisibles().flatMap((f) => f.pieces).filter(aCompter).length})`),
      [[null, "Tous les types"], ...Object.entries(NIVEAUX)].map(([k, v]) =>
        pastille((etat.filtreType ?? null) === k, v, () => { etat.filtreType = k; dessinerStock(); }))));

  let corps;
  if (enComptage) {
    const modes = h("div", { class: "filtres" },
      pastille(c.mode === "chercher", "Chercher un article", () => { c.mode = "chercher"; dessinerStock(); }),
      pastille(c.mode === "liste", "Suivre la liste", () => { c.mode = "liste"; dessinerStock(); }));
    corps = [modes, ...(c.mode === "chercher" ? panneauRecherche() : cartesFamilles()), barreComptage()];
  } else {
    corps = [...cartesFamilles(), formNouvelleFamille()];
  }
  page.replaceChildren(h("div", { class: "stock" + (enComptage ? " en-comptage" : ""), style: "display:flex;flex-direction:column;gap:18px" }, filtres, ...corps));

  // Après une saisie : la case suivante (liste) ou la recherche (chercher) reprend le clavier.
  const f = c?.focus; if (c) c.focus = null;
  if (f) queueMicrotask(() => { const el = document.getElementById(f); if (el) { el.focus(); el.select?.(); } });
}

function cartesFamilles() {
  const c = etat.comptage;
  return piecesVisibles().map((f) => {
    const pieces = etat.pasComptes ? f.pieces.filter(aCompter) : f.pieces;
    if (etat.pasComptes && !pieces.length) return null;
    const suivis = f.pieces.filter(aSuivre), faits = suivis.filter(dejaCompte).length;
    return h("section", { class: "carte" },
      h("div", { class: "tete-famille" }, h("h2", {}, f.nom),
        suivis.length ? h("div", { class: "avancement-famille" + (faits === suivis.length ? " complet" : "") },
          h("span", {}, `${faits} / ${suivis.length} comptés ${refComptage()}`),
          h("span", { class: "jauge", "aria-hidden": "true" }, h("i", { style: `width:${Math.round((faits / suivis.length) * 100)}%` }))) : null),
      h("table", { class: "tbl tbl-stock" },
        h("colgroup", {}, h("col", { class: "c-badge" }), h("col", {}), h("col", { class: "c-qte" }), h("col", { class: "c-note" }), h("col", { class: "c-action" })),
        h("tbody", {}, lignesFamille(f, pieces))));
  });
}

// Dans une famille : les articles à vendre d'abord, puis les fournitures ; une ligne « + Ajouter » sous chaque groupe.
function lignesFamille(f, pieces) {
  const vente = pieces.filter((p) => p.niveau === "a_vendre"), fournitures = pieces.filter((p) => p.niveau !== "a_vendre");
  const titre = (t) => h("tr", { class: "groupe" }, h("td", { colspan: 5 }, t));
  const lignes = [];
  if (vente.length && fournitures.length) {
    lignes.push(titre("À vendre"), ...lignesProduits(vente), ligneAjout(f, "a_vendre"), titre("Fournitures"), ...lignesProduits(fournitures), ligneAjout(f, "achete"));
  } else {
    lignes.push(...lignesProduits(pieces));
    if (!pieces.length) lignes.push(h("tr", {}, h("td", { colspan: 5, class: "note" }, "Rien ici pour l'instant.")));
    lignes.push(ligneAjout(f, etat.filtreType ?? (fournitures.length ? "achete" : "a_vendre")));
    // Famille qui n'a qu'un des deux groupes : de quoi ajouter l'autre (hors filtre « pas encore comptés »).
    const tout = !etat.filtreType && !etat.pasComptes;
    if (tout && !f.pieces.some((p) => p.niveau === "a_vendre")) lignes.push(ligneAjout(f, "a_vendre", true));
    if (tout && !f.pieces.some((p) => p.niveau !== "a_vendre")) lignes.push(ligneAjout(f, "achete", true));
  }
  return lignes;
}

// Produits à variantes : une ligne de titre (nom du produit, « + variante »), puis une ligne par variante.
function lignesProduits(pieces) {
  const lignes = [];
  let courant = null;
  for (const p of pieces) {
    if (p.produit_id && p.produit_id !== courant) lignes.push(ligneProduit(p, pieces.filter((x) => x.produit_id === p.produit_id)));
    courant = p.produit_id ?? null;
    lignes.push(ligneStock(p));
  }
  return lignes;
}

function ligneProduit(p, variantes) {
  const ouvert = etat.ajoutVariante === p.produit_id;
  const suivis = variantes.filter(estComptable);
  const total = suivis.reduce((t, x) => t + x.stock, 0);
  let ajout = null;
  if (ouvert) {
    const champ = h("input", { id: "variante-" + p.produit_id, placeholder: "ex. A3, Miaou…", "aria-label": `Nouvelle variante de ${p.produit}`, autocomplete: "off" });
    ajout = h("form", { class: "ajout-ligne", onsubmit: (e) => { e.preventDefault(); tenter(async () => {
      if (!champ.value.trim()) return;
      await api(`/produits/${p.produit_id}/variantes`, { method: "POST", body: { variante: champ.value } });
      flash(`« ${p.produit} ${champ.value.trim()} » ajouté.`);
      etat.stock = await api("/stock");
      dessinerStock();
      queueMicrotask(() => document.getElementById("variante-" + p.produit_id)?.focus());
    }); } }, champ, h("button", { class: "btn-petit" }, "Ajouter"),
      h("button", { type: "button", class: "btn-petit", onclick: () => { etat.ajoutVariante = null; dessinerStock(); } }, "Fermer"));
    queueMicrotask(() => champ.focus());
  }
  return h("tr", { class: "produit" }, h("td", { colspan: 5 },
    h("div", { class: "tete-produit" },
      h("b", {}, p.produit),
      h("span", { class: "note" }, `${variantes.length} variante${variantes.length > 1 ? "s" : ""}` + (suivis.length ? ` · ${total} en tout` : "")),
      ouvert ? ajout : h("button", { type: "button", class: "btn-petit", onclick: () => { etat.ajoutVariante = p.produit_id; dessinerStock(); } }, "+ variante"),
      etat.comptage ? null : h("a", { class: "btn-petit lien-recette", href: "#reglages/recettes/p" + p.produit_id }, "Recette"))));
}

const variantesDe = (f) => (etat.stock.find((x) => x.id === f.id)?.variantes ?? []).join(", ");

// Ajouter un article ou une fourniture sans quitter le Stock (ni le comptage) ; la quantité tapée est son premier comptage.
// Avec des variantes (A3, A4, A5…), on crée un produit et une ligne par variante, chacune à compter.
function ligneAjout(f, niveau, secondaire = false) {
  const idNom = `aj-${f.id}-${niveau}${secondaire ? "-2" : ""}`;
  const nom = h("input", { id: idNom, placeholder: niveau === "a_vendre" ? "+ ajouter un article à vendre" : "+ ajouter une fourniture", "aria-label": `Nom (${f.nom})`, autocomplete: "off" });
  const type = h("select", { "aria-label": "Type" }, Object.entries(NIVEAUX).map(([k, v]) => h("option", { value: k, selected: k === niveau }, v)));
  const qte = h("input", { class: "compte", type: "text", inputmode: "numeric", placeholder: "combien ?", "aria-label": "Combien en avez-vous ?" });
  const variantes = h("input", { class: "champ-variantes", value: niveau === "a_vendre" ? variantesDe(f) : "", placeholder: "variantes (ex. A3, A4)", "aria-label": "Variantes, séparées par des virgules",
    oninput: () => { qte.hidden = !!variantes.value.trim(); } });
  qte.hidden = !!variantes.value.trim();
  const form = h("form", { class: "ajout-ligne", onsubmit: (e) => { e.preventDefault(); tenter(async () => {
    if (!nom.value.trim()) { nom.focus(); return; }
    if (variantes.value.trim()) {
      const r = await api("/produits", { method: "POST", body: { nom: nom.value, famille_id: f.id, niveau: type.value, variantes: variantes.value } });
      flash(`« ${nom.value.trim()} » ajouté avec ${r.pieces.length} variante(s), à compter.`);
      etat.stock = await api("/stock");
      if (etat.comptage) etat.comptage.focus = idNom; 
      dessinerStock();
      if (!etat.comptage) queueMicrotask(() => document.getElementById(idNom)?.focus());
      return;
    }
    const quantite = qte.value.trim() === "" ? null : lireSaisie(qte.value, 0);
    const { id } = await api("/pieces", { method: "POST", body: { nom: nom.value, famille_id: f.id, niveau: type.value, suivi: "quantite" } });
    if (etat.comptage) {
      etat.stock = await api("/stock");
      if (quantite !== null) await confirmer(pieceDe(id), quantite);
      flash(`« ${nom.value.trim()} » ajouté${quantite !== null ? `, compté ${quantite}` : ""}.`);
      etat.comptage.focus = idNom;
      dessinerStock();
    } else {
      if (quantite !== null) await api("/comptages", { method: "POST", body: { lignes: [{ piece_id: id, compte: quantite }] } });
      flash(`« ${nom.value.trim()} » ajouté${quantite !== null ? ` avec ${quantite} en stock` : " (stock à 0, à compter)"}.`);
      await pageStock();
      queueMicrotask(() => document.getElementById(idNom)?.focus());
    }
  }); } }, nom, type, variantes, qte, h("button", { class: "btn-petit" }, "Ajouter"));
  return h("tr", { class: "ajout" }, h("td", { colspan: 5 }, form));
}

function formNouvelleFamille() {
  const nom = h("input", { id: "nouvelle-famille", placeholder: "ex. Badges", "aria-label": "Nom de la nouvelle famille" });
  return h("form", { class: "ligne-editeur", onsubmit: (e) => { e.preventDefault(); tenter(async () => {
    await api("/familles", { method: "POST", body: { nom: nom.value, ordre: etat.stock.length } });
    flash("Famille ajoutée.");
    await pageStock();
  }); } }, nom, h("button", { class: "btn-sec" }, "+ Nouvelle famille"));
}

function noteStock(p) {
  const notes = [];
  if (p.fin_de_serie) notes.push("Fin de série");
  if (p.suivi === "sans_quantite") notes.push(p.presque_vide ? "Pot presque vide" : "Sans quantité");
  if (p.suivi === "quantite" && p.stock < 0) notes.push("Négatif : à compter");
  return notes.join(" · ");
}

// Case de comptage : préremplie, « 12 » / « +5 » / « -2 », Entrée = compté.
function caseComptage(p, id, apres) {
  const base = valeurCase(p);
  const input = h("input", { id, class: "compte", type: "text", inputmode: "text", enterkeyhint: "done", autocomplete: "off", value: String(base), "aria-label": "Compté pour " + p.nom });
  const valider = (v) => tenter(async () => { await confirmer(p, v); apres(); });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); tenter(async () => valider(lireSaisie(input.value, base))); }
    if (e.key === "Escape") { input.value = String(base); input.blur(); }
  });
  return h("div", { class: "actions-ligne" },
    input,
    h("button", { class: "btn-petit", type: "button", title: "Compté (le chiffre de la case est juste)", onclick: () => tenter(async () => valider(lireSaisie(input.value, base))) }, "✓"),
    h("button", { class: "btn-petit", type: "button", title: "Compté : il n'y en a pas", onclick: () => valider(0) }, "0"),
    valeurSession(p) !== undefined ? h("button", { class: "btn-petit", type: "button", title: "Pas compté finalement (annule)", onclick: () => tenter(async () => { await retirer(p); dessinerStock(); }) }, "↺") : null);
}

function ligneStock(p) {
  const comptable = estComptable(p);
  const c = etat.comptage;
  let action = null;

  if (c && comptable) {
    const id = "c" + p.id;
    action = h("div", { class: "actions-ligne" }, caseComptage(p, id, () => {
      // Case suivante dans la liste affichée.
      const ids = [...document.querySelectorAll(".tbl-stock input.compte[id^='c']")].map((e) => e.id);
      c.focus = ids[ids.indexOf(id) + 1] ?? null;
      dessinerStock();
    }), ecartTexte(p));
  } else if (!c && etat.ligneEnCours === p.id) {
    const input = h("input", { id: "l" + p.id, class: "compte", type: "text", inputmode: "text", value: String(p.stock), "aria-label": "Combien de " + p.nom + " en avez-vous vraiment ?" });
    const valider = () => tenter(async () => {
      await enregistrerComptage([{ piece_id: p.id, compte: lireSaisie(input.value, p.stock) }]);
      etat.ligneEnCours = null;
      await pageStock();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") valider(); if (e.key === "Escape") { etat.ligneEnCours = null; dessinerStock(); } });
    action = h("div", { class: "actions-ligne" }, input,
      h("button", { class: "btn-petit", onclick: valider }, "OK"),
      h("button", { class: "btn-petit", onclick: () => { etat.ligneEnCours = null; dessinerStock(); } }, "Annuler"));
    queueMicrotask(() => { input.focus(); input.select(); });
  } else if (!c && comptable) {
    action = h("div", { class: "actions-ligne" }, h("button", { class: "btn-petit", onclick: () => { etat.ligneEnCours = p.id; dessinerStock(); } }, "Compter"));
  } else if (!c && p.suivi === "sans_quantite") {
    action = h("div", { class: "actions-ligne" },
      h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        await api("/pieces/" + p.id, { method: "PATCH", body: { presque_vide: !p.presque_vide } });
        await pageStock();
      }) }, p.presque_vide ? "Pot remplacé" : "Pot presque vide"));
  }

  const compte = c && comptable && valeurSession(p) !== undefined;
  const statut = !comptable ? null
    : !aSuivre(p) ? h("small", { class: "statut" }, "fin de série, plus en stock")
    : valeurSession(p) !== undefined ? h("small", { class: "statut ok" }, "✓ compté maintenant")
    : compteRecemment(p) ? h("small", { class: "statut ok" }, "✓ compté le " + fmtDate(p.dernier_comptage))
    : h("small", { class: "statut ko" }, "pas compté " + refComptage() + (p.dernier_comptage ? ` (dernier : ${fmtDate(p.dernier_comptage)})` : " (jamais)"));
  return h("tr", { class: [compte ? "compte-fait" : "", aCompter(p) ? "a-compter" : "", p.produit_id ? "ligne-variante" : ""].join(" ").trim() || null },
    h("td", { class: "col-badge" }, h("span", { class: "badge badge-" + p.niveau }, NIVEAUX[p.niveau])),
    h("td", { style: "font-weight:600" }, p.produit_id ? h("span", { class: "variante", title: p.nom }, p.variante) : p.nom,
      c && comptable ? h("small", { class: "attendu" }, (p.produit_id ? p.produit + " · " : "") + "attendu " + (c.attendus[p.id] ?? p.stock)) : null, statut),
    h("td", { class: "num qte" + (comptable && p.stock < 0 ? " neg" : comptable && p.stock === 0 ? " zero" : "") }, comptable ? p.stock : "—"),
    h("td", { class: "note" }, noteStock(p)),
    h("td", { class: "col-action" }, h("div", { class: "actions-ligne" }, action, menuLigne(p))),
  );
}

// « ⋯ » : fin de série et suppression sans passer par Réglages (aussi pendant un comptage).
function menuLigne(p) {
  if (etat.menuLigne !== p.id) return h("button", { type: "button", class: "btn-petit btn-menu", title: "Fin de série, supprimer…", "aria-label": "Plus d'actions pour " + p.nom, onclick: () => { etat.menuLigne = p.id; dessinerStock(); } }, "⋯");
  return h("div", { class: "menu-ligne" },
    h("button", { type: "button", class: "btn-petit", onclick: () => tenter(async () => {
      await api("/pieces/" + p.id, { method: "PATCH", body: { fin_de_serie: !p.fin_de_serie } });
      flash(p.fin_de_serie ? `« ${p.nom} » remis en vente.` : `« ${p.nom} » passé en fin de série.`);
      etat.menuLigne = null; await rechargerStock();
    }) }, p.fin_de_serie ? "Remettre en vente" : "Fin de série"),
    h("button", { type: "button", class: "btn-petit danger", onclick: () => tenter(() => supprimerPiece(p)) }, "Supprimer…"),
    h("button", { type: "button", class: "btn-petit", "aria-label": "Fermer", onclick: () => { etat.menuLigne = null; dessinerStock(); } }, "×"));
}

// Recharge le stock sans perdre un comptage en cours.
async function rechargerStock() {
  const [stock, ce] = await Promise.all([api("/stock"), api("/comptages/etat")]);
  etat.stock = stock; etat.depuis = ce.depuis; etat.depuisSalon = ce.salon;
  if (etat.comptage) for (const id of Object.keys(etat.comptage.valeurs)) if (!pieceDe(Number(id))) oublierLigne(id);
  dessinerStock();
}

async function supprimerPiece(p) {
  const d = await api(`/pieces/${p.id}/suppression`);
  const etapes = d.etapes.length ? `\n\nAttention : il est utilisé dans ${d.etapes.length > 1 ? "les étapes" : "l'étape"} ${d.etapes.map((e) => `« ${e} »`).join(", ")}. Il en sera enlevé.` : "";
  const texte = d.vendu
    ? `« ${d.nom} » a déjà été vendu : il sera retiré du stock et du comptage (ses ventes restent dans les bilans ; on peut le remettre depuis Réglages).${etapes}\n\nRetirer ?`
    : `Supprimer « ${d.nom} » ? Il n'a jamais été vendu : il disparaît, avec ses comptages.`
      + (estComptable(p) && p.stock > 0 ? `\n\nIl en reste ${p.stock} en stock selon l'outil.` : "") + etapes;
  if (!confirm(texte)) return;
  const r = await api("/pieces/" + p.id, { method: "DELETE" });
  flash(r.action === "retire" ? `« ${d.nom} » retiré du stock.` : `« ${d.nom} » supprimé.`);
  etat.menuLigne = null;
  if (etat.comptage?.choisi === p.id) etat.comptage.choisi = null;
  await rechargerStock();
}

function ecartTexte(p) {
  const v = valeurSession(p);
  if (v === undefined) return h("span", { class: "ecart" });
  const d = v - (etat.comptage.attendus[p.id] ?? p.stock);
  return h("span", { class: "ecart" + (d > 0 ? " plus" : d === 0 ? " juste" : "") }, d ? signe(d) : "juste");
}

// Mode « Chercher » : on part de l'objet qu'on a en main.
function panneauRecherche() {
  const c = etat.comptage;
  const candidats = piecesListe().filter((p) => estComptable(p) && filtreOk(p));
  const choisi = c.choisi ? pieceDe(c.choisi) : null;

  const choisir = (p) => { c.choisi = p.id; c.creation = null; c.focus = "q-choisi"; dessinerStock(); };
  const recherche = h("input", { id: "q-recherche", type: "search", value: c.recherche, placeholder: "Tapez quelques lettres : « gren caf », « buvard »…", "aria-label": "Chercher un article", autocomplete: "off" });
  recherche.addEventListener("input", (e) => { c.recherche = e.target.value; c.choisi = null; c.creation = null; dessinerResultats(); });
  recherche.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const premiers = resultatsCourants();
    if (premiers.length) choisir(premiers[0]);
    else if (c.recherche.trim()) ouvrirCreation();
  });
  const zoneResultats = h("div", { class: "resultats" });
  const resultatsCourants = () => {
    const m = sansAccent(c.recherche.trim()).split(/\s+/).filter(Boolean);
    return m.length ? candidats.filter((p) => m.every((x) => sansAccent(p.nom).includes(x))).slice(0, 8) : [];
  };
  // Une variante qui manque à un produit existant (« baleine a2 » → ajouter A2 à Baleine).
  const ajouterVariante = (produit_id, nomProduit, variante) => tenter(async () => {
    let v = variante.trim();
    if (!v) return;
    // Même écriture que les variantes connues (« a2 » → « A2 » comme A3, A4…).
    const connues = [...piecesListe().map((p) => p.variante), ...etat.stock.flatMap((f) => f.variantes ?? [])].filter(Boolean);
    v = connues.find((x) => sansAccent(x) === sansAccent(v)) ?? (/^[a-z]\d+$/i.test(v) ? v.toUpperCase() : v);
    const { id } = await api(`/produits/${produit_id}/variantes`, { method: "POST", body: { variante: v } });
    etat.stock = await api("/stock");
    flash(`« ${nomProduit} ${v} » ajouté : comptez-le.`);
    c.recherche = ""; c.creation = null; c.choisi = id; c.focus = "q-choisi";
    dessinerStock();
  });
  function suggestionsVariante(texte, resultats) {
    const mots = texte.trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return [];
    const produits = [...new Map(piecesListe().filter((p) => p.produit_id && filtreOk(p)).map((p) => [p.produit_id, p])).values()];
    const out = [];
    for (const p of produits) {
      const nomP = sansAccent(p.produit);
      let k = 0;
      while (k < mots.length && nomP.includes(sansAccent(mots[k]))) k++;
      if (!k) continue;
      const reste = mots.slice(k).join(" ");
      const variantes = piecesListe().filter((x) => x.produit_id === p.produit_id).map((x) => sansAccent(x.variante ?? ""));
      if (reste && variantes.includes(sansAccent(reste))) continue; // existe déjà : elle est dans les résultats
      out.push(reste
        ? h("button", { type: "button", class: "resultat creer", onclick: () => ajouterVariante(p.produit_id, p.produit, reste) },
            h("b", {}, `+ Ajouter « ${p.produit} ${reste} »`), h("span", { class: "note" }, `nouvelle variante de ${p.produit}`))
        : h("form", { class: "resultat creer variante-form", onsubmit: (e) => { e.preventDefault(); ajouterVariante(p.produit_id, p.produit, e.target.elements.v.value); } },
            h("b", {}, `+ Autre variante de ${p.produit} :`),
            h("input", { name: "v", placeholder: "ex. A2, Hérisson…", "aria-label": `Nouvelle variante de ${p.produit}`, autocomplete: "off" }),
            h("button", { class: "btn-petit" }, "Ajouter")));
      if (out.length >= 3) break;
    }
    return out;
  }
  const ouvrirCreation = () => {
    const derniere = c.ordre.length ? pieceDe(c.ordre[0])?.famille_id : null;
    const famille = etat.filtre ?? derniere ?? etat.stock[0].id;
    c.creation = { nom: c.recherche.trim(), famille, niveau: etat.filtreType ?? "a_vendre", variantes: variantesDe({ id: famille }) };
    c.focus = "q-creation-qte";
    dessinerStock();
  };
  function dessinerResultats() {
    const r = resultatsCourants();
    zoneResultats.replaceChildren(...[
      ...r.map((p) => h("button", { type: "button", class: "resultat" + (valeurSession(p) !== undefined ? " fait" : ""), onclick: () => choisir(p) },
        h("span", {}, h("b", {}, p.nom), h("small", {}, `${p.famille} · ${NIVEAUX[p.niveau]}`)),
        h("span", { class: "note" }, valeurSession(p) !== undefined ? `compté ${valeurSession(p)}` : `attendu ${p.stock}`))),
      ...suggestionsVariante(c.recherche, r),
      c.recherche.trim().length >= 2 && !r.some((p) => sansAccent(p.nom) === sansAccent(c.recherche.trim()))
        ? h("button", { type: "button", class: "resultat creer", onclick: ouvrirCreation }, h("b", {}, `+ Créer « ${c.recherche.trim()} »`), h("span", { class: "note" }, "il manque dans la liste")) : null,
      c.recherche.trim() && !r.length && c.recherche.trim().length < 2 ? h("span", { class: "note" }, "Encore une lettre…") : null].filter(Boolean));
  }
  dessinerResultats();

  let zoneSaisie = null;
  if (choisi) {
    zoneSaisie = h("div", { class: "saisie-choisi" },
      h("div", {}, h("b", {}, choisi.nom), h("div", { class: "note" }, `${choisi.famille} · attendu ${choisi.stock}` + (valeurSession(choisi) !== undefined ? ` · déjà compté ${valeurSession(choisi)} (tapez +5 pour ajouter)` : ""))),
      caseComptage(choisi, "q-choisi", () => { c.choisi = null; c.recherche = ""; c.focus = "q-recherche"; dessinerStock(); }),
      menuLigne(choisi),
      h("button", { type: "button", class: "btn-petit", onclick: () => { c.choisi = null; c.focus = "q-recherche"; dessinerStock(); } }, "Annuler"));
  } else if (c.creation) {
    const cr = c.creation;
    const nom = h("input", { value: cr.nom, "aria-label": "Nom du nouvel article", oninput: (e) => { cr.nom = e.target.value; } });
    const champVar = h("input", { class: "champ-variantes", value: cr.variantes, placeholder: "variantes (ex. A3, A4)", "aria-label": "Variantes, séparées par des virgules",
      oninput: (e) => { cr.variantes = e.target.value; qte.hidden = !!cr.variantes.trim(); } });
    const fam = h("select", { "aria-label": "Famille", onchange: (e) => { cr.famille = Number(e.target.value); cr.variantes = variantesDe({ id: cr.famille }); champVar.value = cr.variantes; qte.hidden = !!cr.variantes.trim(); } },
      etat.stock.map((f) => h("option", { value: String(f.id), selected: f.id === cr.famille }, f.nom)));
    const type = h("select", { "aria-label": "Type", onchange: (e) => { cr.niveau = e.target.value; } },
      Object.entries(NIVEAUX).map(([k, v]) => h("option", { value: k, selected: k === cr.niveau }, v)));
    const qte = h("input", { id: "q-creation-qte", class: "compte", type: "text", inputmode: "numeric", placeholder: "combien ?", "aria-label": "Combien en avez-vous ?" });
    qte.hidden = !!(cr.variantes ?? "").trim();
    zoneSaisie = h("form", { class: "saisie-choisi", onsubmit: (e) => { e.preventDefault(); tenter(async () => {
      if ((cr.variantes ?? "").trim()) {
        // Produit à variantes : on le crée, puis on retrouve ses variantes dans la recherche pour les compter une à une.
        const r = await api("/produits", { method: "POST", body: { nom: cr.nom, famille_id: cr.famille, niveau: cr.niveau, variantes: cr.variantes } });
        etat.stock = await api("/stock");
        flash(`« ${cr.nom.trim()} » créé avec ${r.pieces.length} variante(s) : comptez-les ci-dessous.`);
        c.creation = null; c.recherche = cr.nom.trim(); c.focus = "q-recherche";
        dessinerStock();
        return;
      }
      if (qte.value.trim() === "") { qte.focus(); throw new Error("Indiquez combien vous en avez (0 si aucun)."); }
      const quantite = lireSaisie(qte.value, 0);
      const { id } = await api("/pieces", { method: "POST", body: { nom: cr.nom, famille_id: cr.famille, niveau: cr.niveau, suivi: "quantite" } });
      etat.stock = await api("/stock");
      await confirmer(pieceDe(id), quantite);
      flash(`« ${cr.nom.trim()} » créé et compté ${quantite}.`);
      c.creation = null; c.recherche = ""; c.focus = "q-recherche";
      dessinerStock();
    }); } },
      h("b", {}, "Nouvel article"), h("div", { class: "ligne-editeur" }, nom, fam, type, champVar, qte),
      h("div", { class: "ligne-editeur" }, h("button", { class: "btn" }, (cr.variantes ?? "").trim() ? "Créer" : "Créer et compter"),
        h("button", { type: "button", class: "btn-sec", onclick: () => { c.creation = null; c.focus = "q-recherche"; dessinerStock(); } }, "Annuler")));
  }

  // Ce qui vient d'être compté (le plus récent en haut), puis ce qui reste.
  const comptes = c.ordre.map(pieceDe).filter(Boolean);
  const restants = candidats.filter(aCompter);
  const parFamille = etat.stock.map((f) => ({ f, ps: restants.filter((p) => p.famille_id === f.id) })).filter((x) => x.ps.length);

  return [
    h("section", { class: "carte panneau-recherche" }, recherche, zoneResultats, zoneSaisie),
    h("section", { class: "carte pas-comptes" },
      h("div", { class: "tete-famille" }, h("h2", {}, `Pas encore comptés ${refComptage()} (${restants.length})`)),
      parFamille.length ? h("div", { class: "liste-restants" }, parFamille.map(({ f, ps }) => h("div", {},
        h("strong", {}, f.nom),
        h("div", { class: "puces" }, ps.map((p) => h("button", { type: "button", class: "btn-petit", onclick: () => choisir(p) }, p.nom))))))
        : h("div", { class: "vide" }, "Tout est compté.")),
    h("section", { class: "carte" }, h("h2", {}, `Comptés dans ce comptage (${comptes.length})`),
      comptes.length ? h("table", { class: "tbl" }, h("tbody", {}, comptes.map((p) => h("tr", {},
        h("td", { style: "font-weight:600" }, h("a", { href: "#stock", onclick: (e) => { e.preventDefault(); choisir(p); } }, p.nom)),
        h("td", { class: "num qte" }, valeurSession(p)),
        h("td", {}, ecartTexte(p)),
        h("td", { class: "num" }, h("button", { class: "btn-petit", title: "Pas compté finalement (annule)", onclick: () => tenter(async () => { await retirer(p); dessinerStock(); }) }, "↺")))))) 
        : h("div", { class: "vide" }, "Rien encore. Prenez un objet, tapez son nom, puis la quantité.")),

  ];
}

function lignesSaisies() {
  return Object.entries(etat.comptage?.valeurs || {}).map(([id, v]) => ({ piece_id: Number(id), compte: v }));
}

function nbEcarts() {
  const stocks = new Map(piecesListe().map((p) => [p.id, p.stock]));
  return lignesSaisies().filter((l) => l.compte !== (etat.comptage.attendus[l.piece_id] ?? stocks.get(l.piece_id))).length;
}

function barreComptage() {
  const vis = piecesListe().filter((p) => aSuivre(p) && filtreOk(p));
  const faits = vis.filter(dejaCompte).length;
  const pct = vis.length ? Math.round((faits / vis.length) * 100) : 0;
  return h("div", { class: "barre-comptage", id: "barre-comptage" },
    h("div", { class: "progression", "aria-hidden": "true" }, h("i", { style: `width:${pct}%` })),
    h("span", {}, `${lignesSaisies().length} compté(s), déjà enregistré(s) · ${nbEcarts()} écart(s) · ${faits} / ${vis.length} comptés ${refComptage()}`),
    h("button", { class: "btn", onclick: () => {
      const n = lignesSaisies().length, e = nbEcarts();
      etat.comptage = null; oublierComptage();
      flash(n ? `Comptage terminé : ${n} ligne(s), ${e} chiffre(s) corrigé(s). Tout est déjà enregistré.` : "Comptage terminé.");
      if (etat.comptageAvant) { etat.comptageAvant = null; location.hash = "accueil"; } else pageStock();
    } }, "Terminer le comptage"),
  );
}

function demarrerComptage() {
  etat.comptage = { valeurs: {}, ordre: [], lignes: {}, attendus: {}, mode: "chercher", recherche: "", choisi: null, creation: null, focus: "q-recherche" };
  etat.ligneEnCours = null;
}

async function enregistrerComptage(lignes, avant = null) {
  if (lignes.some((l) => !Number.isInteger(l.compte) || l.compte < 0)) throw new Error("Les quantités comptées doivent être des nombres entiers, 0 ou plus.");
  const r = await api("/comptages", { method: "POST", body: avant ? { lignes, type: "avant", salon_id: avant.salon_id } : { lignes } });
  flash(r.ecarts ? `Comptage enregistré : ${r.ecarts} chiffre(s) corrigé(s).` : "Comptage enregistré : tout était juste.");
  return r;
}

async function sauverComptage() {
  const lignes = lignesSaisies();
  if (!lignes.length) throw new Error("Rien n'a été compté.");
  await enregistrerComptage(lignes, etat.comptageAvant);
  etat.comptage = null;
  oublierComptage();
  if (etat.comptageAvant) { etat.comptageAvant = null; location.hash = "accueil"; return; }
  await pageStock();
}

// ───────────── Réglages : familles, articles et fournitures ─────────────
// Réglages : deux onglets, « Général » et « Recettes ».
function ongletsReglages(actif) {
  return h("nav", { class: "onglets", "aria-label": "Réglages" },
    [["general", "Général", "#reglages"], ["recettes", "Recettes", "#reglages/recettes"]].map(([id, t, href]) =>
      h("a", { href, class: "onglet", "aria-current": actif === id ? "page" : null }, t)));
}

async function pageReglages() {
  if (etat.params[0] === "recettes") { await pageRecettes(etat.params[1]); return; }
  [etat.familles, etat.stock, etat.etapes, etat.correspondances, etat.reglages, etat.retires] = await Promise.all([api("/familles"), api("/stock"), api("/etapes"), api("/correspondances"), api("/reglages"), api("/pieces/retires")]);
  dessinerReglages();
}

function selectFamille(valeur, id) {
  return h("select", { id }, etat.familles.map((f) => h("option", { value: String(f.id), selected: f.id === valeur }, f.nom)));
}
function selectDepuis(objet, valeur, id) {
  return h("select", { id }, Object.entries(objet).map(([k, v]) => h("option", { value: k, selected: k === valeur }, v)));
}

function dessinerReglages() {
  entete("Réglages");
  const page = document.getElementById("page");

  const nomFamille = h("input", { id: "nf", placeholder: "ex. Mini-presses" });
  const formFamille = h("form", {
    class: "formulaire",
    onsubmit: (e) => { e.preventDefault(); tenter(async () => {
      await api("/familles", { method: "POST", body: { nom: nomFamille.value, ordre: etat.familles.length } });
      flash("Famille ajoutée.");
      await pageReglages();
    }); },
  }, h("label", { for: "nf" }, "Nouvelle famille", nomFamille), h("button", { class: "btn" }, "Ajouter"));

  const familles = h("section", { class: "carte" },
    h("h2", {}, "Familles"),
    etat.familles.length
      ? h("table", { class: "tbl" }, h("tbody", {}, etat.familles.map((f) =>
          h("tr", {}, h("td", { style: "font-weight:600" }, f.nom),
            h("td", {}, h("label", { class: "ligne-editeur note", title: "Ex. Tampons : la caisse vend « Tampon unité » sans dire quel motif." },
              h("input", { type: "checkbox", checked: !!f.modele_non_precise, onchange: (e) => tenter(async () => {
                await api("/familles/" + f.id, { method: "PATCH", body: { modele_non_precise: e.target.checked } });
                await pageReglages();
              }) }), "La caisse ne précise pas le modèle")),
            h("td", {}, h("input", { value: (f.variantes ?? []).join(", "), placeholder: "variantes proposées (ex. A3, A4, A5)", "aria-label": `Variantes proposées pour ${f.nom}`,
              title: "Proposées à chaque nouveau produit de la famille ; on peut en retirer à la création.", style: "min-width:220px",
              onchange: (e) => tenter(async () => { await api("/familles/" + f.id, { method: "PATCH", body: { variantes: e.target.value } }); flash("Variantes enregistrées."); await pageReglages(); }) })),
            h("td", { class: "num" },
            h("button", { class: "btn-petit", onclick: () => tenter(async () => {
              const nom = prompt("Nouveau nom de la famille", f.nom);
              if (!nom || nom === f.nom) return;
              await api("/familles/" + f.id, { method: "PATCH", body: { nom } });
              await pageReglages();
            }) }, "Renommer"))))))
      : h("div", { class: "vide" }, "Aucune famille."),
    formFamille,
  );

  let pieces = null;
  if (etat.familles.length) {
    const nom = h("input", { id: "np", placeholder: "ex. Mini-presse Sauge" });
    const fam = selectFamille(etat.filtre ?? etat.familles[0].id, "npf");
    const niv = selectDepuis(NIVEAUX, "a_vendre", "npn");
    const sui = selectDepuis(SUIVIS, "quantite", "nps");
    const formPiece = h("form", {
      class: "formulaire",
      onsubmit: (e) => { e.preventDefault(); tenter(async () => {
        await api("/pieces", { method: "POST", body: { nom: nom.value, famille_id: Number(fam.value), niveau: niv.value, suivi: sui.value } });
        flash("Ajouté. Son stock part de 0 : comptez-le depuis l'écran Stock.");
        await pageReglages();
      }); },
    },
      h("label", { for: "np" }, "Nom", nom),
      h("label", { for: "npf" }, "Famille", fam),
      h("label", { for: "npn" }, "Type", niv),
      h("label", { for: "nps" }, "Suivi", sui),
      h("button", { class: "btn" }, "Ajouter"),
    );

    const toutes = etat.stock.flatMap((f) => f.pieces.map((p) => ({ ...p, famille: f.nom })));
    pieces = h("section", { class: "carte" },
      h("h2", {}, "Articles et fournitures"),
      toutes.length
        ? h("table", { class: "tbl" },
            h("thead", {}, h("tr", {}, ["Nom", "Famille", "Type", "Suivi", ""].map((t) => h("th", {}, t)))),
            h("tbody", {}, toutes.flatMap((p) => [lignePieceReglage(p), etat.achatEdition?.id === p.id ? editeurAchat(p) : null])))
        : h("div", { class: "vide" }, "Rien pour l'instant."),
      formPiece,
    );
  }

  const retires = etat.retires?.length ? h("section", { class: "carte" },
    h("h2", {}, "Articles retirés"),
    h("p", { class: "note", style: "margin:0;padding:0 14px" }, "Déjà vendus, donc gardés pour les bilans, mais absents du stock et du comptage."),
    h("table", { class: "tbl" }, h("tbody", {}, etat.retires.map((p) => h("tr", {},
      h("td", { style: "font-weight:600" }, p.nom), h("td", { class: "note" }, p.famille),
      h("td", { class: "num" }, h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        await api("/pieces/" + p.id, { method: "PATCH", body: { retire: false } }); flash(`« ${p.nom} » remis dans le stock.`); await pageReglages();
      }) }, "Remettre dans le stock"))))))) : null;
  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, ongletsReglages("general"), sectionFondCaisse(), sectionThermometre(), familles, pieces, retires,
    sectionCorrespondances()));
}

// Article thermomètre : ses ventes mesurent le passage devant le stand (Tampon lot = × 4, Collection = × 20).
// Famille thermomètre : ses ventes mesurent le passage devant le stand (Tampon lot = × 4, Collection = × 20).
function sectionFondCaisse() {
  const r = etat.reglages ?? {};
  const coupures = { ...(r.fond_caisse_coupures ?? {}) };
  const totalEl = h("strong", {}, euros(totalCoupures(coupures)));
  return h("section", { class: "carte" }, h("h2", {}, "Fond de caisse"),
    h("p", { class: "note", style: "margin:0;padding:0 14px" }, "Toujours le même : ce qu'il y a dans la caisse en début de salon. Retiré du comptage de caisse dans le bilan de chaque salon. Enregistré à chaque saisie."),
    grilleCoupures(coupures, () => { totalEl.textContent = euros(totalCoupures(coupures)); },
      () => tenter(async () => { await api("/reglages/fond-caisse", { method: "PUT", body: { coupures } }); etat.reglages = await api("/reglages"); }), "fond"),
    h("div", { class: "total-caisse" }, h("span", { class: "note" }, "Fond de caisse"), totalEl));
}

function sectionThermometre() {
  const r = etat.reglages ?? {};
  const effectif = r.famille_thermometre_effectif ?? null;
  const candidates = etat.familles.filter((f) => f.modele_non_precise);
  return h("section", { class: "carte" },
    h("h2", {}, "Thermomètre des salons"),
    h("div", { class: "formulaire" },
      candidates.length
        ? h("label", {}, "Famille dont les ventes mesurent le passage",
            h("select", { "aria-label": "Famille thermomètre", onchange: (e) => tenter(async () => {
              await api("/reglages", { method: "PUT", body: { cle: "famille_thermometre", valeur: e.target.value || null } });
              flash("Thermomètre enregistré.");
              await pageReglages();
            }) }, candidates.map((f) => h("option", { value: String(f.id), selected: f.id === effectif }, f.nom))))
        : h("div", { class: "note" }, "Cochez « La caisse ne précise pas le modèle » sur la famille Tampons (ci-dessous)."),
      h("p", { class: "note", style: "margin:0;max-width:560px;font-size:13px" },
        "Dans les questions, reliez « Tampon unité » à « Tampons, modèle non précisé » × 1, « Tampon lot » × 4, « Collection » × 20 : le nombre de tampons vendus en découle. Le stock de chaque motif se suit par les comptages.")));
}

function lignePieceReglage(p) {
  if (etat.edition === p.id) {
    const nom = h("input", { value: p.nom, "aria-label": "Nom" });
    const fam = selectFamille(p.famille_id, "ef" + p.id);
    const niv = selectDepuis(NIVEAUX, p.niveau, "en" + p.id);
    const sui = selectDepuis(SUIVIS, p.suivi, "es" + p.id);
    fam.setAttribute("aria-label", "Famille"); niv.setAttribute("aria-label", "Type"); sui.setAttribute("aria-label", "Suivi");
    return h("tr", {},
      h("td", {}, nom), h("td", {}, fam), h("td", {}, niv), h("td", {}, sui),
      h("td", {}, h("div", { class: "actions-ligne" },
        h("button", { class: "btn-petit", onclick: () => tenter(async () => {
          await api("/pieces/" + p.id, { method: "PATCH", body: { nom: nom.value, famille_id: Number(fam.value), niveau: niv.value, suivi: sui.value } });
          etat.edition = null;
          await pageReglages();
        }) }, "Enregistrer"),
        h("button", { class: "btn-petit", onclick: () => { etat.edition = null; dessinerReglages(); } }, "Annuler"))),
    );
  }
  return h("tr", {},
    h("td", { style: "font-weight:600" }, p.nom, p.fin_de_serie ? h("span", { class: "note" }, " · fin de série") : null),
    h("td", {}, p.famille),
    h("td", {}, h("span", { class: "badge badge-" + p.niveau }, NIVEAUX[p.niveau])),
    h("td", { class: "note" }, SUIVIS[p.suivi]),
    h("td", {}, h("div", { class: "actions-ligne" },
      h("button", { class: "btn-petit", onclick: () => { etat.edition = p.id; dessinerReglages(); } }, "Modifier"),
      p.niveau === "achete" || p.niveau === "recup" ? h("button", { class: "btn-petit", disabled: !!etat.achatEdition, onclick: () => tenter(() => ouvrirReglageAchat(p)) }, "Achat") : null,
      h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        await api("/pieces/" + p.id, { method: "PATCH", body: { fin_de_serie: !p.fin_de_serie } });
        await pageReglages();
      }) }, p.fin_de_serie ? "Remettre en vente" : "Fin de série"))),
  );
}


// ───────────── Préparation ─────────────
// Décisions du 18/11/2026 : 1. quoi produire (conseil, on tape le nombre), 2. fournitures à vérifier,
// 3. commander, 4. ce qu'on a produit (checklist). Le comptage avant reste dans Compter (jalon de l'Accueil).
// Une saisie s'enregistre à la sortie du champ (Tab, Entrée, clic ailleurs) ; rien d'autre ne bouge :
// seules les lignes dont les chiffres ont changé sont redessinées, le curseur reste où on l'a mis.
async function pagePreparation() {
  etat.prep = await api("/preparation");
  etat.prepOuverts ??= new Set();
  // Les lignes visibles du 1 sont fixées à l'ouverture de la page : taper un nombre ne fait pas changer une ligne de place.
  etat.prepVues = new Set((etat.prep.articles ?? []).filter((a) => a.conseil > 0 || a.stock <= 0 || (a.decide && a.a_produire > 0)).map((a) => a.piece_id));
  dessinerPreparation();
}

// Après un enregistrement : relit, puis remplace uniquement ce qui a changé, sans toucher au champ où se trouve le curseur.
async function rafraichirPreparation() {
  etat.prep = await api("/preparation");
  for (const neuf of sectionsPreparation(etat.prep)) {
    const ancien = document.getElementById(neuf.id);
    if (!ancien || ancien._html === neuf._html) continue;
    const actif = document.activeElement;
    if (!ancien.contains(actif)) { ancien.replaceWith(neuf); continue; }
    const cles = (el) => [...el.querySelectorAll("[data-cle]")].map((x) => x.dataset.cle).join("|");
    if (cles(ancien) !== cles(neuf)) { remplacerEnGardantLeCurseur(ancien, neuf, actif); continue; }
    for (const el of [...neuf.querySelectorAll("[data-cle]")]) {
      const o = ancien.querySelector(`[data-cle="${CSS.escape(el.dataset.cle)}"]`);
      if (o && o._html !== el._html) remplacerEnGardantLeCurseur(o, el, actif);
    }
    ancien._html = neuf._html;
  }
}

// Remplace un bloc. Si le curseur y est : on le remet dans le même champ, avec ce qui y est tapé ;
// mais si l'on est en train d'y taper autre chose que ce qui est enregistré, on ne touche pas à la ligne.
function remplacerEnGardantLeCurseur(ancien, neuf, actif) {
  if (!ancien.contains(actif) || !actif.id) { ancien.replaceWith(neuf); return; }
  const cible = neuf.querySelector("#" + CSS.escape(actif.id)) ?? (neuf.id === actif.id ? neuf : null);
  const tape = actif.value;
  if (ancien.querySelector("[data-cle]") === null && cible && cible.value !== undefined && cible.value !== tape) return;
  const pos = actif.selectionStart;
  ancien.replaceWith(neuf);
  const el = document.getElementById(actif.id);
  if (!el) return;
  el.focus();
  if (tape !== undefined && el.value !== tape) el.value = tape;
  try { el.setSelectionRange(pos, pos); } catch {}
}

// Mémorise le HTML d'un élément au moment où il est construit (pour savoir s'il a changé).
function fige(el) { el._html = el.innerHTML; for (const x of el.querySelectorAll("[data-cle]")) x._html = x.innerHTML; return el; }

const ETATS_FOURNITURE = {
  manque: (f) => ["pr-alerte", `manque ${f.il_en_faut - Math.max(0, f.stock)}`],
  jamais: () => ["pr-inconnu", "jamais compté"],
  bas: (f) => ["pr-bas", `zone critique : il en restera ${f.stock - f.il_en_faut} (alerte sous ${f.seuil})`],
  inconnu_q: () => ["pr-inconnu", "quantité inconnue (rendement à renseigner)"],
  ok: () => ["pr-ok", "devrait suffire"],
  sans: () => ["pr-sans", "vérifie qu'il en reste"],
};

function dessinerPreparation() {
  const d = etat.prep;
  entete("Préparation");
  const page = document.getElementById("page");
  if (!d.preparation) {
    page.replaceChildren(h("div", { class: "carte" }, h("div", { class: "vide" },
      "Aucun salon à venir. Ajoutez le prochain salon dans ", h("a", { href: "#salons" }, "Salons"), " : la préparation commence 15 jours avant.")));
    return;
  }
  page.replaceChildren(h("div", { class: "pr" },
    h("p", { class: "note", style: "margin:0" }, d.salons.map((s) => `${s.nom} (${datesSalon(s)})`).join(" · "),
      ` · la préparation commence 15 jours avant, le ${fmtDate(d.debut)}.`),
    ...sectionsPreparation(d)));
}

function sectionsPreparation(d) {
  return [frisePreparation(d), problemesPreparation(d), sectionProduire(d), sectionVerifier(d), sectionCommander(d), sectionChecklist(d)];
}

function frisePreparation(d) {
  const toutDecide = d.articles.every((a) => a.decide);
  const aVerifier = d.fournitures.filter((f) => !f.verifie).length;
  const checkFaits = d.checklist.filter((x) => x.fait !== null).length;
  const tempo = [
    ["pr-produire", "1. Quoi produire", toutDecide ? "liste arrêtée" : "vous décidez", toutDecide],
    ["pr-verifier", "2. Fournitures à vérifier", d.fournitures.length ? (aVerifier ? `${aVerifier} à vérifier` : "tout est vérifié") : "rien à vérifier", d.fournitures.length > 0 && !aVerifier],
    ["pr-commander", "3. Commander", d.commander.length ? `${d.commander.length} à commander` : d.commandes.length ? `${d.commandes.length} en attente` : aVerifier ? "après vérification" : "rien à commander", !aVerifier && !d.commander.length && !d.commandes.length],
    ["pr-checklist", "4. Ce qu'on a produit", d.checklist.length ? `${checkFaits} / ${d.checklist.length}` : "rien à produire", d.checklist.length > 0 && checkFaits === d.checklist.length],
  ];
  return fige(h("nav", { class: "pr-frise", id: "pr-frise", "aria-label": "Les quatre temps de la préparation" },
    tempo.map(([id, t, s, fait]) => h("a", { href: "#preparation", class: fait ? "fait" : null, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); } },
      h("b", {}, t), h("span", {}, s)))));
}

function problemesPreparation(d) {
  return fige(h("div", { id: "pr-problemes" }, d.problemes.length ? h("div", { class: "question" }, h("strong", {}, "À régler dans Réglages › Recettes"), d.problemes.map((p) => h("div", {}, p))) : null));
}

// Petit menu « ⋯ » d'une ligne : les actions rares, à l'écart pour éviter un clic malheureux.
function menuPoints(nom, actions) {
  // Le tableau défile horizontalement (il couperait un menu en position absolue) : le menu est placé par rapport à la fenêtre.
  const placer = (e) => {
    const d = e.target;
    if (!d.open) return;
    for (const autre of document.querySelectorAll(".pr-menu[open]")) if (autre !== d) autre.open = false;
    const r = d.querySelector("summary").getBoundingClientRect(), liste = d.querySelector(".pr-menu-liste");
    // Un parent avec transform devient la référence du position:fixed : on corrige par sa position.
    liste.style.left = "0px"; liste.style.top = "0px";
    const o = liste.getBoundingClientRect();
    liste.style.left = Math.max(8, r.right - liste.offsetWidth) - o.left + "px";
    liste.style.top = r.bottom + 4 - o.top + "px";
    const fermer = (ev) => { if (ev.type === "scroll" || !d.contains(ev.target)) { d.open = false; removeEventListener("scroll", fermer, true); removeEventListener("pointerdown", fermer, true); } };
    addEventListener("scroll", fermer, true); addEventListener("pointerdown", fermer, true);
  };
  return h("details", { class: "pr-menu", ontoggle: placer },
    h("summary", { tabindex: "-1", "aria-label": "Plus d'actions pour " + nom, title: "Plus d'actions" }, "⋯"),
    h("div", { class: "pr-menu-liste" }, actions.map(([texte, fn]) => h("button", { type: "button", onclick: (e) => { e.target.closest("details").open = false; fn(); } }, texte))));
}

// Champ numérique enregistré à la sortie (Tab, Entrée, clic ailleurs). Entrée ne déplace pas le curseur.
function champNombre(attrs, enregistrer) {
  return h("input", { class: "pr-q", type: "text", inputmode: "numeric", autocomplete: "off", ...attrs,
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.dispatchEvent(new Event("change")); } },
    onchange: (e) => {
      const el = e.target;
      if (el.value === el._dernier) return;
      tenter(async () => { await enregistrer(el.value.trim()); el._dernier = el.value; await rafraichirPreparation(); });
    } });
}

function sectionProduire(d) {
  const prep = d.preparation;
  const familles = [];
  for (const a of d.articles) {
    let f = familles.find((x) => x.id === a.famille_id);
    if (!f) familles.push(f = { id: a.famille_id, nom: a.famille, lignes: [] });
    f.lignes.push(a);
  }
  const ligne = (a) => {
    const champ = champNombre({ id: "prod-" + a.piece_id, value: String(a.a_produire), "aria-label": (a.achete ? "À racheter : " : "À produire : ") + a.nom },
      async (v) => {
        if (v !== "" && !/^\d+$/.test(v)) throw new Error("Un nombre entier, ou vide pour revenir au conseil.");
        await api(`/preparation/${prep.id}/production`, { method: "PUT", body: { piece_id: a.piece_id, a_produire: v === "" ? null : Number(v) } });
      });
    champ._dernier = String(a.a_produire);
    return h("tr", { "data-cle": "a" + a.piece_id },
      h("td", {}, h("span", { style: "font-weight:600" }, a.nom), " ",
        a.stock <= 0 ? h("span", { class: "pr-pill pr-alerte" }, "épuisé") : a.conseil > 0 ? h("span", { class: "pr-pill pr-bas" }, "à refaire") : null,
        a.achete ? h("span", { class: "pr-calc" }, " · acheté puis revendu") : null),
      h("td", { class: "num" }, a.stock),
      h("td", { class: "pr-calc" }, a.calcul),
      h("td", { class: "num" }, champ),
      h("td", { class: "col-menu" }, menuPoints(a.nom, [["Fin de série (ne plus en produire)", () => tenter(async () => {
        await api("/pieces/" + a.piece_id, { method: "PATCH", body: { fin_de_serie: true } });
        flash(`« ${a.nom} » passé en fin de série : il ne sera plus proposé. Pour revenir en arrière : Stock, menu ⋯ de l'article.`);
        await rafraichirPreparation();
      })]])));
  };
  const corps = familles.flatMap((f) => {
    const vues = f.lignes.filter((a) => etat.prepVues.has(a.piece_id));
    const autres = f.lignes.filter((a) => !vues.includes(a));
    const cle = "autres-" + f.id;
    const ouvert = etat.prepOuverts.has(cle);
    // Les autres lignes sont dans le même tableau (colonnes alignées), masquées ou montrées sans rien redessiner.
    const basculer = (e) => {
      const o = !etat.prepOuverts.has(cle);
      o ? etat.prepOuverts.add(cle) : etat.prepOuverts.delete(cle);
      for (const tr of document.querySelectorAll(`#pr-produire tr[data-groupe="${cle}"]`)) tr.hidden = !o;
      e.currentTarget.textContent = (o ? "▾ " : "▸ ") + texteAutres;
      e.currentTarget.setAttribute("aria-expanded", String(o));
    };
    const texteAutres = `${autres.length} autre${autres.length > 1 ? "s" : ""} : rien de conseillé`;
    return [
      h("tr", { class: "pr-famille" }, h("td", { colspan: "5" }, f.nom, f.lignes[0].modele_non_precise ? h("span", { class: "pr-calc" }, " · la caisse ne dit pas le modèle : on compare les stocks entre eux") : null)),
      ...vues.map(ligne),
      autres.length ? h("tr", {}, h("td", { colspan: "5", class: "pr-autres" }, h("button", { type: "button", class: "pr-bascule", "aria-expanded": String(ouvert), onclick: basculer }, (ouvert ? "▾ " : "▸ ") + texteAutres))) : null,
      ...autres.map((a) => { const tr = ligne(a); tr.dataset.groupe = cle; tr.hidden = !ouvert; return tr; }),
    ];
  });
  const total = (filtre) => d.articles.filter(filtre).reduce((t, a) => t + a.a_produire, 0);
  const toutDecide = d.articles.every((a) => a.decide);
  return fige(h("section", { class: "carte pr-temps", id: "pr-produire" },
    h("div", { class: "pr-tete" }, h("span", { class: "pr-num" }, "1"), h("h2", {}, "Quoi produire")),
    h("p", { class: "pr-regle" }, h("strong", {}, "Conseil"), " : vendus au meilleur salon + la marge, moins le stock. Tampons (la caisse ne dit pas le modèle) : on remonte au niveau des autres modèles ceux qui en ont la moitié ou moins. La case contient le conseil : tapez le nombre que vous voulez (vide = revenir au conseil)."),
    h("div", { class: "pr-defile" }, h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Article", "Stock", "Conseil", "À produire", ""].map((t, i) => h("th", { class: i === 1 || i === 3 ? "num" : null }, t)))),
      h("tbody", {}, corps))),
    h("div", { class: "pr-pied", "data-cle": "pied-produire" },
      h("span", { class: "note" }, `À produire : ${total((a) => !a.achete)} · à racheter : ${total((a) => a.achete)}`),
      h("button", { class: toutDecide ? "btn-sec" : "btn", onclick: () => tenter(async () => {
        await api(`/preparation/${prep.id}/production/lot`, { method: "PUT", body: { lignes: d.articles.map((a) => ({ piece_id: a.piece_id, a_produire: a.a_produire })) } });
        flash("Liste arrêtée. Vous pouvez encore changer un nombre.");
        await rafraichirPreparation();
      }) }, toutDecide ? "Liste arrêtée ✓" : "La liste est arrêtée"))));
}

function sectionVerifier(d) {
  const prep = d.preparation;
  const verifier = (f, body) => api(`/preparation/${prep.id}/verif`, { method: "PUT", body: { piece_id: f.piece_id, ...body } });
  const ligne = (f) => {
    const [cls, txt] = ETATS_FOURNITURE[f.etat](f);
    let saisie;
    if (f.suivi === "quantite") {
      saisie = champNombre({ id: "verif-" + f.piece_id, value: f.verifie ? String(f.verifie_quantite) : "", placeholder: "combien ?", "aria-label": "J'en ai : " + f.nom },
        async (v) => {
          if (v === "") { if (f.verifie) await api(`/preparation/${prep.id}/verif/${f.piece_id}`, { method: "DELETE" }); return; }
          if (!/^\d+$/.test(v)) throw new Error("Un nombre entier.");
          await verifier(f, { quantite: Number(v) });
        });
      saisie._dernier = f.verifie ? String(f.verifie_quantite) : "";
    } else {
      const choix = f.verifie ? (f.verifie_quantite === 0 ? "racheter" : "reste") : null;
      const bouton = (val, texte, body) => h("button", { type: "button", class: "btn-petit" + (choix === val ? " pr-choisi" : ""), "aria-pressed": choix === val ? "true" : "false",
        onclick: () => tenter(async () => {
          if (choix === val) await api(`/preparation/${prep.id}/verif/${f.piece_id}`, { method: "DELETE" });
          else await verifier(f, body);
          await rafraichirPreparation();
        }) }, texte);
      saisie = h("div", { class: "actions-ligne" }, bouton("reste", "il en reste", {}), bouton("racheter", "à racheter", { a_racheter: true }));
    }
    return h("tr", { "data-cle": "f" + f.piece_id, class: f.verifie ? "pr-verifiee" : null },
      h("td", {}, h("span", { style: "font-weight:600" }, f.verifie ? "✓ " : "", f.nom), h("span", { class: "pr-calc" }, " · " + f.famille + (f.recup ? " · récup" : ""))),
      h("td", { class: "num" }, f.il_en_faut === null ? (f.suivi === "quantite" ? "?" : "un peu") : f.il_en_faut),
      h("td", { class: "num" }, f.suivi !== "quantite" ? "—" : f.compte ? f.stock : "?"),
      h("td", {}, h("span", { class: "pr-pill " + cls }, txt), f.avant_le ? h("span", { class: "pr-calc" }, ` · commander avant le ${fmtDate(f.avant_le)}`) : null),
      h("td", { class: "num" }, saisie));
  };
  return fige(h("section", { class: "carte pr-temps", id: "pr-verifier" },
    h("div", { class: "pr-tete" }, h("span", { class: "pr-num" }, "2"), h("h2", {}, "Fournitures à vérifier")),
    h("p", { class: "pr-regle" }, "Ce qu'il faut pour produire la liste du 1 (les fournitures maison en stock sont utilisées d'abord), et ce qu'il y a d'après l'outil. Comptez chaque fourniture, même celles qui semblent bonnes : le chiffre tapé devient le stock. Gomme, peinture : dites seulement s'il en reste."),
    d.fournitures.length ? h("div", { class: "pr-defile" }, h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Fourniture", "Il en faut", "D'après l'outil", "État", "J'en ai"].map((t, i) => h("th", { class: [1, 2, 4].includes(i) ? "num" : null }, t)))),
      h("tbody", {}, d.fournitures.map(ligne)))) : h("div", { class: "vide" }, "Rien à vérifier : la liste du 1 est vide, ou ce sont des articles achetés puis revendus.")));
}

function sectionCommander(d) {
  const restants = d.fournitures.filter((f) => !f.verifie).length;
  const recup = d.commander.filter((f) => f.recup);
  const lignes = d.commander.filter((f) => !f.recup);
  const ligne = (f) => {
    const q = h("input", { class: "pr-q", id: "cmd-" + f.piece_id, type: "text", inputmode: "numeric", value: String(f.a_commander), "aria-label": "Quantité commandée : " + f.nom });
    const calcul = f.mode_achat === "tout_le_disponible" ? "prendre tout le disponible"
      : f.revente ? `${f.il_en_faut} à racheter (décidé au 1)${f.en_route ? ` − ${f.en_route} en route` : ""}`
      : f.suivi !== "quantite" ? "il n'en reste plus assez"
      : `il en faut ${f.il_en_faut} − ${f.verifie_quantite} en stock${f.en_route ? ` − ${f.en_route} en route` : ""}`;
    return h("tr", { "data-cle": "c" + f.piece_id },
      h("td", { style: "font-weight:600" }, f.nom),
      h("td", { class: "pr-calc" }, calcul, f.lot ? ` → ${f.lot.nombre} lot${f.lot.nombre > 1 ? "s" : ""} de ${f.lot.taille}` : ""),
      h("td", { class: "pr-calc" }, f.avant_le ? "avant le " + fmtDate(f.avant_le) : ""),
      h("td", { class: "num" }, q),
      h("td", {}, h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        if (!/^\d+$/.test(q.value.trim()) || Number(q.value) < 1) throw new Error("Indiquez la quantité commandée.");
        await api("/commandes", { method: "POST", body: { piece_id: f.piece_id, quantite: Number(q.value), taille_lot: f.lot ? f.lot.taille : null } });
        flash("Noté comme commandé."); await rafraichirPreparation();
      }) }, "Commandé")));
  };
  return fige(h("section", { class: "carte pr-temps", id: "pr-commander" },
    h("div", { class: "pr-tete" }, h("span", { class: "pr-num" }, "3"), h("h2", {}, "Commander")),
    h("p", { class: "pr-regle" }, "Ce qui manque d'après vos vérifications du 2 (arrondi aux lots), et les articles achetés puis revendus décidés au 1. « Commandé » met la ligne en attente ; « Reçu » l'entre en stock."),
    restants ? h("div", { class: "note", style: "margin:0 14px", "data-cle": "restants" }, restants > 1 ? `${restants} fournitures pas encore vérifiées au 2 : elles s'ajouteront ici si elles manquent.` : "1 fourniture pas encore vérifiée au 2 : elle s'ajoutera ici si elle manque.") : null,
    recup.map((f) => h("div", { class: "note", style: "margin:0 14px", "data-cle": "r" + f.piece_id }, `Gardez de quoi faire : ${f.nom}, il en faut ${f.il_en_faut}, vous en avez ${f.verifie_quantite} (récup).`)),
    lignes.length ? h("div", { class: "pr-defile" }, h("table", { class: "tbl" }, h("tbody", {}, lignes.map(ligne))))
      : h("div", { class: "vide" }, restants ? "Rien à commander pour l'instant." : "Rien à commander."),
    d.commandes.length ? blocEnAttente(d) : null));
}

function blocEnAttente(d) {
  return h("div", { class: "pr-commande pr-attente" }, h("strong", {}, "Commandé, en attente"),
    h("table", { class: "tbl" }, h("tbody", {}, d.commandes.map((cmd) => {
      const q = h("input", { class: "pr-q", id: "recu-" + cmd.id, type: "text", inputmode: "numeric", value: String(cmd.quantite), "aria-label": "Quantité reçue : " + cmd.nom });
      return h("tr", { "data-cle": "e" + cmd.id },
        h("td", { style: "font-weight:600" }, cmd.nom),
        h("td", { class: "pr-calc" }, `${cmd.suivi === "quantite" ? cmd.quantite : "1"} commandé${cmd.quantite > 1 ? "s" : ""} le ${fmtDate(cmd.commande_le.slice(0, 10))}`),
        h("td", { class: "num" }, cmd.suivi === "quantite" ? q : null),
        h("td", {}, h("div", { class: "actions-ligne" },
          h("button", { class: "btn-petit", onclick: () => tenter(async () => {
            await api(`/commandes/${cmd.id}/recu`, { method: "POST", body: cmd.suivi === "quantite" ? { quantite: Number(q.value) } : {} });
            flash("Reçu : entré en stock."); await rafraichirPreparation();
          }) }, "Reçu"),
          h("button", { class: "btn-petit", onclick: () => tenter(async () => {
            if (!confirm(`Annuler la commande de ${cmd.nom} ?`)) return;
            await api("/commandes/" + cmd.id, { method: "DELETE" }); await rafraichirPreparation();
          }) }, "Annuler"))));
    }))));
}

function sectionChecklist(d) {
  const prep = d.preparation;
  const detail = (x) => {
    if (x.type === "utilise") return "feuilles partagées entre plusieurs articles (formats mélangés) : combien en avez-vous utilisé ?";
    if (x.type !== "maison") return "";
    if (!x.manque) return `il en faut ${x.besoin}, la réserve suffit (${x.stock})`;
    if (x.fois === null) return `il en faut ${x.besoin}, il en reste ${x.stock} → au moins ${x.manque} · rendement inconnu : indiquez aussi combien de ${x.matiere ?? "feuilles"} vous avez utilisé`;
    const reserve = x.produit - x.manque;
    return `il en faut ${x.besoin}, il en reste ${x.stock} → au moins ${x.manque}` + (x.pour > 1 ? ` · ${x.fois} × ${x.matiere ?? "matière"} → ${x.produit}${reserve > 0 ? ` (${reserve} en réserve)` : ""}` : "");
  };
  const ligne = (x) => {
    const fait = x.fait !== null;
    const q = fait ? null : h("input", { class: "pr-q", id: "fait-" + x.piece_id, type: "text", inputmode: "numeric", placeholder: String(x.prevu || 0), "aria-label": (x.type === "utilise" ? "Utilisées : " : "Produit : ") + x.nom,
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); valider(); } } });
    const matiere = !fait && x.type === "maison" && x.fois === null && x.manque > 0
      ? h("input", { class: "pr-q", id: "matiere-" + x.piece_id, type: "text", inputmode: "numeric", placeholder: x.matiere ? x.matiere.split(" ")[0].toLowerCase() + "s ?" : "feuilles ?", "aria-label": "Matière utilisée pour " + x.nom }) : null;
    const valider = () => tenter(async () => {
      const v = q.value.trim() === "" ? String(x.prevu || 0) : q.value.trim();
      if (!/^\d+$/.test(v)) throw new Error("Un nombre entier.");
      await api(`/preparation/${prep.id}/fait`, { method: "PUT", body: { piece_id: x.piece_id, quantite: Number(v), sens: x.type === "utilise" ? "utilise" : "produit", matiere: matiere && matiere.value !== "" ? Number(matiere.value) : null } });
      await rafraichirPreparation();
    });
    return h("tr", { "data-cle": "k" + x.type + x.piece_id, class: fait ? "pr-faite" : null },
      h("td", { style: "font-weight:600" }, x.type === "utilise" ? x.nom + " utilisées" : x.nom),
      h("td", { class: "num" }, x.prevu || "—"),
      h("td", { class: "pr-calc cache-tel" }, detail(x)),
      h("td", { class: "num" }, fait ? String(x.fait) : h("div", { class: "pr-cellule" }, q, matiere)),
      h("td", {}, fait
        ? h("button", { class: "btn-petit", title: "Annuler (le stock revient comme avant)", onclick: () => tenter(async () => {
            await api(`/preparation/${prep.id}/fait/${x.piece_id}`, { method: "DELETE" }); await rafraichirPreparation();
          }) }, "↺")
        : h("button", { class: "btn-petit", onclick: valider }, "c'est fait")));
  };
  const groupes = [];
  const maison = d.checklist.filter((x) => x.type !== "article");
  if (maison.length) groupes.push(h("tr", { class: "pr-famille" }, h("td", { colspan: "5" }, "Fournitures maison")), ...maison.map(ligne));
  let fam = null;
  for (const x of d.checklist.filter((y) => y.type === "article")) {
    if (x.famille !== fam) { fam = x.famille; groupes.push(h("tr", { class: "pr-famille" }, h("td", { colspan: "5" }, fam))); }
    groupes.push(ligne(x));
  }
  return fige(h("section", { class: "carte pr-temps", id: "pr-checklist" },
    h("div", { class: "pr-tete" }, h("span", { class: "pr-num" }, "4"), h("h2", {}, "Ce qu'on a produit")),
    h("p", { class: "pr-regle" }, "Au fil de la préparation. « C'est fait » ajoute au stock ce qui a été produit et retire les fournitures utilisées (calcul théorique, recalé au comptage avant le salon). On commence par les fournitures maison : le surplus reste en réserve."),
    d.checklist.length ? h("div", { class: "pr-defile" }, h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["À produire", "Prévu", "Détail", "Produit", ""].map((t, i) => h("th", { class: i === 1 || i === 3 ? "num" : i === 2 ? "cache-tel" : null }, t)))),
      h("tbody", {}, groupes))) : h("div", { class: "vide" }, "Rien à produire.")));
}

// ───────────── Recettes ─────────────
// « Ce qu'il faut pour en faire » (spec §1) : pour un article ou une fourniture maison, un produit (toutes ses variantes),
// ou toute une famille pour une variante (« tous les prints A5 »). Enregistré à chaque changement.
async function pageRecettes(cle) {
  [etat.stock, etat.recettes] = await Promise.all([api("/stock"), api("/recettes")]);
  dessinerRecettes();
  // #reglages/recettes/p<produit> (lien « Recette » du Stock) : on va à sa carte, ou à celle de sa famille.
  if (cle) {
    const pr = cle.startsWith("p") ? toutesPieces().find((p) => p.produit_id === Number(cle.slice(1))) : null;
    const el = document.querySelector(`[data-cle="${cle}"]`) ?? (pr ? document.querySelector(`[data-cle="f${pr.famille_id}:${pr.variante}"]`) : null);
    el?.scrollIntoView({ block: "center" }); el?.classList.add("rc-vise");
  }
}

function ciblesRecettes() {
  const cibles = [];
  for (const f of etat.stock) {
    for (const niveau of ["a_vendre", "fait_maison"]) {
      const pieces = f.pieces.filter((p) => p.niveau === niveau);
      if (!pieces.length) continue;
      const produits = [...new Set(pieces.filter((p) => p.produit_id).map((p) => p.produit_id))];
      // Plusieurs produits qui partagent les variantes de la famille (prints) : une recette par variante pour toute la famille.
      const parVariante = niveau === "a_vendre" && f.variantes.length && produits.length >= 2;
      if (parVariante) for (const v of f.variantes) cibles.push({ cle: `f${f.id}:${v}`, famille: f.nom, niveau, nom: `Tous les ${f.nom.toLowerCase()} ${v}`, corps: { famille_id: f.id, variante: v }, variantes: [v], exemples: pieces.filter((p) => p.variante === v) });
      for (const pr of produits) {
        if (parVariante) continue;
        const vs = pieces.filter((p) => p.produit_id === pr);
        cibles.push({ cle: "p" + pr, famille: f.nom, niveau, nom: vs[0].produit, corps: { produit_id: pr }, variantes: vs.map((p) => p.variante), exemples: vs });
      }
      for (const p of pieces.filter((x) => !x.produit_id)) cibles.push({ cle: "a" + p.id, famille: f.nom, niveau, nom: p.nom, corps: { piece_id: p.id }, variantes: [], exemples: [p] });
    }
  }
  for (const c of cibles) {
    const b = c.corps;
    c.recette = etat.recettes.find((r) => b.piece_id ? r.piece_id === b.piece_id : b.produit_id ? r.produit_id === b.produit_id : r.famille_id === b.famille_id && r.variante === b.variante) ?? null;
    // Recette héritée (un article d'un produit ou d'une famille qui a déjà sa recette).
  }
  return cibles;
}

function choixElements(c) {
  const out = [];
  const tous = toutesPieces().filter((p) => p.niveau !== "a_vendre" && !c.exemples.some((x) => x.id === p.id));
  // Produits à variantes : « de la même variante » quand leurs variantes recouvrent celles de la cible.
  const produits = new Map();
  for (const p of toutesPieces()) if (p.produit_id && p.niveau !== "a_vendre") (produits.get(p.produit_id) ?? produits.set(p.produit_id, { nom: p.produit, variantes: new Set() }).get(p.produit_id)).variantes.add(p.variante);
  if (c.variantes.length) for (const [id, pr] of produits) if (c.variantes.every((v) => pr.variantes.has(v))) out.push({ label: `${pr.nom} (même ${c.niveau === "a_vendre" && c.corps.famille_id ? "format" : "variante"})`, produit_id: id });
  for (const p of tous) out.push({ label: p.nom, piece_id: p.id });
  return out;
}

function texteQuantite(q) {
  if (Number.isInteger(q)) return String(q);
  for (const den of [2, 3, 4, 5, 6, 8, 10, 16, 20, 25, 45, 50]) if (Math.abs(q * den - Math.round(q * den)) < 1e-6) return `${Math.round(q * den)}/${den}`;
  return String(q).replace(".", ",");
}

// Enregistre, puis redessine seulement la carte de cette recette.
async function sauverRecette(c, pour, elements) {
  await api("/recettes", { method: "PUT", body: { ...c.corps, pour, elements } });
  etat.recettes = await api("/recettes");
  const neuve = ciblesRecettes().find((x) => x.cle === c.cle);
  const ancienne = document.querySelector(`[data-cle="${CSS.escape(c.cle)}"]`);
  if (neuve && ancienne) ancienne.replaceWith(carteRecette(neuve, choixElements(neuve)));
  else dessinerRecettes();
}

function carteRecette(c, options) {
  const r = c.recette;
  const elements = r ? r.elements.map((e) => ({ ...e })) : [];
  const pour = r ? r.pour : 1;
  const nomEl = (e) => e.piece_id ? nomPiece(e.piece_id) : options.find((o) => o.produit_id === e.produit_id)?.label ?? "?";
  const liste = "dl-" + c.cle.replace(/[^a-z0-9]/gi, "");
  const choisir = (texte) => options.find((o) => o.label.toLowerCase() === texte.trim().toLowerCase());
  const lignes = elements.map((e, i) => h("div", { class: "rc-ligne" },
    h("input", { class: "pr-q", value: texteQuantite(e.quantite), "aria-label": "Quantité de " + nomEl(e), onchange: (ev) => tenter(async () => {
      const n = elements.map((x, j) => ({ piece_id: x.piece_id, produit_id: x.produit_id, quantite: j === i ? ev.target.value : x.quantite }));
      await sauverRecette(c, pour, n);
    }) }),
    h("span", {}, nomEl(e)),
    h("button", { class: "btn-petit", "aria-label": "Retirer " + nomEl(e), onclick: () => tenter(() => sauverRecette(c, pour, elements.filter((_, j) => j !== i))) }, "×")));
  const qNouv = h("input", { class: "pr-q", value: "1", "aria-label": "Quantité" });
  const elNouv = h("input", { list: liste, placeholder: "chercher une fourniture…", "aria-label": "Fourniture à ajouter", class: "rc-chercher",
    onkeydown: (ev) => { if (ev.key === "Enter") ajouter(); } });
  const ajouter = () => tenter(async () => {
    const o = choisir(elNouv.value);
    if (!o) throw new Error("Choisissez une fourniture dans la liste (ou créez-la d'abord dans le Stock).");
    await sauverRecette(c, pour, [...elements, { piece_id: o.piece_id ?? null, produit_id: o.produit_id ?? null, quantite: qNouv.value }]);
    document.querySelector(`[data-cle="${c.cle}"] .rc-chercher`)?.focus();
  });
  const maison = c.niveau === "fait_maison";
  const champPour = h("input", { class: "pr-q", value: pour === null ? "" : String(pour), placeholder: "?", "aria-label": "Pour en faire combien",
    onchange: (ev) => tenter(async () => {
      const v = ev.target.value.trim();
      if (v !== "" && !/^\d+$/.test(v)) throw new Error("Un nombre entier (vide = rendement inconnu).");
      if (!elements.length) throw new Error("Ajoutez d'abord ce qu'il faut.");
      await sauverRecette(c, v === "" ? null : Number(v), elements);
    }) });
  return h("div", { class: "rc-carte", "data-cle": c.cle },
    h("div", { class: "rc-titre" }, h("strong", {}, c.nom),
      c.variantes.length > 1 ? h("span", { class: "pr-calc" }, " · " + (c.variantes.length > 6 ? `${c.variantes.length} modèles` : c.variantes.join(", "))) : null,
      !r ? h("span", { class: "pr-pill " + (c.niveau === "a_vendre" ? "pr-inconnu" : "pr-sans") }, c.niveau === "a_vendre" ? "sans recette : acheté puis revendu ?" : "sans recette")
        : r.pour === null ? h("span", { class: "pr-pill pr-bas" }, "rendement inconnu") : null),
    h("div", { class: "rc-pour" }, "Pour en faire ", maison || (r && r.pour !== 1) ? champPour : h("strong", {}, "1"), ", il faut :"),
    lignes,
    h("div", { class: "rc-ligne rc-ajout" }, qNouv, elNouv, h("button", { class: "btn-petit", onclick: ajouter }, "+ ajouter"),
      h("datalist", { id: liste }, options.map((o) => h("option", { value: o.label })))));
}

function dessinerRecettes() {
  entete("Réglages");
  const page = document.getElementById("page");
  const cibles = ciblesRecettes();
  const blocs = [ongletsReglages("recettes"), h("p", { class: "note", style: "margin:0" },
    "Ce qu'il faut pour en faire un (ou, pour une fourniture maison, pour en faire une plaque ou une feuille : 25 planchettes = 1 plaque MDF). ",
    "« Même variante » : la planchette du même modèle, le carton du même format. Une quantité décimale (¼ = 1/4) est partagée : les prints A5 se mélangent sur une feuille A3. ",
    "La peinture et la gomme n'ont pas de quantité : elles apparaissent seulement « à vérifier ». Un article à vendre sans recette est considéré comme acheté puis revendu.")];
  for (const f of etat.stock) {
    const cs = cibles.filter((c) => c.famille === f.nom);
    if (!cs.length) continue;
    blocs.push(h("section", { class: "carte rc-famille" }, h("h2", {}, f.nom),
      h("div", { class: "rc-grille" }, cs.map((c) => carteRecette(c, choixElements(c))))));
  }
  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, ...blocs));
}

// ───────────── Choisir un article ou une fourniture ─────────────
function toutesPieces() {
  return etat.stock.flatMap((f) => f.pieces.map((p) => ({ ...p, famille: f.nom })));
}
function nomPiece(id) {
  return toutesPieces().find((p) => p.id === id)?.nom ?? "?";
}

// filtre : "articles" (à vendre), "fournitures" (le reste) ou rien (tout).
function selectPiece(valeur, onchange, label, filtre) {
  const garde = (p) => !filtre || (filtre === "articles" ? p.niveau === "a_vendre" : p.niveau !== "a_vendre");
  return h("select", { "aria-label": label, onchange: (e) => onchange(Number(e.target.value)) },
    h("option", { value: "", selected: !valeur }, "— choisir —"),
    etat.stock.filter((f) => f.pieces.some(garde)).map((f) => h("optgroup", { label: f.nom },
      f.pieces.filter(garde).map((p) => h("option", { value: String(p.id), selected: p.id === valeur }, filtre ? p.nom : `${p.nom} (${NIVEAUX[p.niveau]})`)))),
  );
}
// Article, ou famille dont la caisse ne précise pas le modèle (valeur « f<id> »).
function selectArticleOuFamille(l, label) {
  const familles = etat.stock.filter((f) => f.modele_non_precise);
  const valeur = l.famille_id ? "f" + l.famille_id : l.piece_id ? String(l.piece_id) : "";
  return h("select", { "aria-label": label, onchange: (e) => {
      const v = e.target.value;
      if (v.startsWith("f")) { l.famille_id = Number(v.slice(1)); l.piece_id = null; }
      else { l.piece_id = v ? Number(v) : null; l.famille_id = null; }
    } },
    h("option", { value: "", selected: !valeur }, "— choisir —"),
    familles.length ? h("optgroup", { label: "Modèle non précisé à la caisse" },
      familles.map((f) => h("option", { value: "f" + f.id, selected: valeur === "f" + f.id }, `${f.nom}, modèle non précisé`))) : null,
    etat.stock.filter((f) => f.pieces.some((p) => p.niveau === "a_vendre")).map((f) => h("optgroup", { label: f.nom },
      f.pieces.filter((p) => p.niveau === "a_vendre").map((p) => h("option", { value: String(p.id), selected: valeur === String(p.id) }, p.nom)))));
}
const choisie = (l) => !!(l.piece_id || l.famille_id);
const corpsReponse = (lignes) => ({
  pieces: lignes.filter((l) => l.piece_id).map((l) => ({ piece_id: l.piece_id, quantite: Number(l.quantite) })),
  familles: lignes.filter((l) => l.famille_id).map((l) => ({ famille_id: l.famille_id, quantite: Number(l.quantite) })),
});
const estFourniture = (id) => { const p = toutesPieces().find((x) => x.id === id); return !!p && p.niveau !== "a_vendre"; };

// ───────────── Dates ─────────────
const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDateLongue = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
function joursEntre(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
function datesSalon(s) { return s.nb_jours > 1 ? `${fmtDate(s.date_debut)} → ${fmtDate(s.fin)}` : fmtDate(s.date_debut); }
function nomPreparation(prep, salons) {
  return prep.salon_ids.map((id) => salons.find((s) => s.id === id)?.nom ?? "?").join(" + ");
}
function dureeTexte(min) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// ───────────── Salons ─────────────
async function pageSalons() {
  [etat.salons, etat.passes] = await Promise.all([api("/salons"), api("/salons-passes")]);
  dessinerSalons();
}

function formulaireSalon(s) {
  const v = s ?? { nom: "", type: "", date_debut: "", nb_jours: 1, frequentation: "" };
  const champ = (id, label, attrs) => h("label", { for: id }, label, h("input", { id, ...attrs }));
  const form = h("form", {
    class: "formulaire",
    onsubmit: (e) => { e.preventDefault(); tenter(async () => {
      const f = new FormData(form);
      const corps = {
        nom: f.get("nom"), type: f.get("type") || null, date_debut: f.get("date_debut"),
        nb_jours: Number(f.get("nb_jours") || 1), frequentation: f.get("frequentation") === "" ? null : Number(f.get("frequentation")),
      };
      await api(s ? "/salons/" + s.id : "/salons", { method: s ? "PATCH" : "POST", body: corps });
      etat.salonEdition = null;
      flash(s ? "Salon modifié." : "Salon ajouté.");
      await pageSalons();
    }); },
  },
    champ("sn", "Nom", { name: "nom", value: v.nom, placeholder: "ex. Festival de Noël", required: true }),
    champ("st", "Type", { name: "type", value: v.type ?? "", placeholder: "ex. convention, marché" }),
    champ("sd", "Premier jour", { name: "date_debut", type: "date", value: v.date_debut, required: true }),
    champ("sj", "Jours", { name: "nb_jours", type: "number", min: "1", step: "1", value: String(v.nb_jours), style: "width:80px" }),
    champ("sf", "Fréquentation attendue", { name: "frequentation", type: "number", min: "0", step: "1", value: v.frequentation ?? "", placeholder: "visiteurs", style: "width:150px" }),
    h("button", { class: "btn" }, s ? "Enregistrer" : "Ajouter"),
    h("button", { type: "button", class: "btn-sec", onclick: () => { etat.salonEdition = null; dessinerSalons(); } }, "Annuler"),
  );
  return form;
}

function dessinerSalons() {
  const d = etat.salons;
  entete("Salons", etat.salonEdition ? null : h("button", { class: "btn", onclick: () => { etat.salonEdition = "nouveau"; dessinerSalons(); } }, "Ajouter un salon"));
  const page = document.getElementById("page");
  const aVenir = d.salons.filter((s) => s.fin >= d.aujourdhui);
  const passes = d.salons.filter((s) => s.fin < d.aujourdhui).reverse();
  const seuil = d.reglages.regroupement_auto ? `écart de moins de ${d.reglages.seuil_jours} jours` : "regroupement automatique désactivé";

  const ligneSalon = (s) => etat.salonEdition === s.id
    ? h("div", { class: "salon salon-edition" }, formulaireSalon(s))
    : h("div", { class: "salon" },
        h("div", {}, h("strong", {}, s.nom),
          h("div", { class: "note" }, [datesSalon(s), `${s.nb_jours} jour${s.nb_jours > 1 ? "s" : ""}`, s.type, s.frequentation ? `~${s.frequentation.toLocaleString("fr-FR")} visiteurs` : null].filter(Boolean).join(" · "))),
        h("div", { class: "actions-ligne" },
          h("button", { class: "btn-petit", disabled: !!etat.salonEdition, onclick: () => { etat.salonEdition = s.id; dessinerSalons(); } }, "Modifier"),
          h("button", { class: "btn-petit", disabled: !!etat.salonEdition, onclick: () => tenter(async () => {
            if (!confirm(`Supprimer le salon « ${s.nom} » ?`)) return;
            await api("/salons/" + s.id, { method: "DELETE" });
            flash("Salon supprimé.");
            await pageSalons();
          }) }, "Supprimer")));

  const ligneEcart = (s) => h("div", { class: "ecart-salons" },
    h("span", {}, `${s.ecart_avant} jour${s.ecart_avant > 1 ? "s" : ""} d'écart`),
    h("strong", {}, s.regroupe ? "Préparés ensemble" : "Préparés séparément"),
    s.manuel ? h("span", { class: "note" }, "(votre choix)") : null,
    h("button", { class: "btn-petit", onclick: () => tenter(async () => {
      await api(`/salons/${s.id}/regroupement`, { method: "PUT", body: { regroupe: !s.regroupe } });
      await pageSalons();
    }) }, s.regroupe ? "Séparer" : "Regrouper"),
    s.manuel ? h("button", { class: "btn-petit", onclick: () => tenter(async () => {
      await api(`/salons/${s.id}/regroupement`, { method: "PUT", body: { regroupe: null } });
      await pageSalons();
    }) }, "Revenir à la proposition") : null);

  const timeline = h("section", { class: "carte" },
    h("h2", {}, "Prochains salons"),
    h("p", { class: "note", style: "margin:0;padding:0 14px 8px" },
      `Les salons trop rapprochés pour refaire du stock entre eux sont préparés ensemble. L'outil propose un regroupement (${seuil}), vous pouvez séparer ou regrouper à la main.`),
    aVenir.length ? h("div", { class: "timeline" }, aVenir.flatMap((s, i) => [i > 0 ? ligneEcart(s) : null, ligneSalon(s)]))
      : h("div", { class: "vide" }, "Aucun salon à venir."),
    etat.salonEdition === "nouveau" ? h("div", { class: "salon-edition" }, formulaireSalon(null)) : null,
  );

  const prep = d.preparations.find((p) => p.id === d.en_cours);
  let preparation = null;
  if (prep) {
    const premier = d.salons.find((s) => s.id === prep.id);
    const j = joursEntre(d.aujourdhui, premier.date_debut);
    const phases = [
      { label: "Préparation", fait: false, quand: "quoi produire, fournitures à vérifier, ce qu'on a produit" },
      { label: "Comptage avant", fait: !!prep.comptage_avant, quand: prep.comptage_avant ? "fait le " + fmtDate(prep.comptage_avant.slice(0, 10)) : "juste avant de charger le stand" },
      { label: "Bilan", fait: false, quand: "après le salon : espèces à recopier, « mal exposé » à cocher" },
    ];
    preparation = h("section", { class: "carte" },
      h("h2", {}, "Préparation en cours : " + nomPreparation(prep, d.salons)),
      h("div", { class: "note", style: "padding:0 14px" }, `Tout prêt avant le ${fmtDateLongue(premier.date_debut)} · ${j > 0 ? `dans ${j} jour${j > 1 ? "s" : ""}` : "c'est maintenant"}`),
      h("ol", { class: "phases" }, phases.map((ph) => h("li", { class: ph.fait ? "fait" : "" }, h("strong", {}, (ph.fait ? "✓ " : "") + ph.label), h("span", { class: "note" }, ph.quand)))),
      h("div", { class: "formulaire" },
        h("button", { class: "btn", onclick: () => { location.hash = "preparation"; } }, "Ouvrir la préparation"),
        h("button", { class: "btn-sec", onclick: () => { location.hash = "stock/avant/" + prep.id; } }, prep.comptage_avant ? "Refaire le comptage avant" : "Faire le comptage avant")),
    );
  }

  const tablePasses = h("section", { class: "carte" },
    h("h2", {}, "Salons passés"),
    passes.length
      ? h("table", { class: "tbl" },
          h("thead", {}, h("tr", {}, ["Salon", "Type", "Jours", "Fréquentation", "Ventes carte", "Tampons", "Tampons / 1 000 vis.", ""].map((t, i) => h("th", { class: i >= 2 && i <= 6 ? "num" : null }, t)))),
          h("tbody", {}, passes.map((s) => etat.salonEdition === s.id
            ? h("tr", {}, h("td", { colspan: "8" }, formulaireSalon(s)))
            : h("tr", {},
                h("td", {}, h("strong", {}, s.nom), h("div", { class: "note" }, datesSalon(s))),
                h("td", {}, s.type ?? ""), h("td", { class: "num" }, s.nb_jours),
                h("td", { class: "num" }, s.frequentation ? s.frequentation.toLocaleString("fr-FR") : "—"),
                ...(() => { const st = etat.passes.find((x) => x.salon_id === s.id); return [
                  h("td", { class: "num" }, st ? euros(st.carte_suivi) : "—"),
                  h("td", { class: "num" }, st?.tampons || "—"),
                  h("td", { class: "num", style: "font-weight:700" }, st?.pour_1000 == null ? "—" : String(st.pour_1000).replace(".", ",")),
                ]; })(),
                h("td", {}, h("div", { class: "actions-ligne" },
                  etat.passes.find((x) => x.salon_id === s.id && !x.especes_saisies) ? h("span", { class: "note", style: "font-size:12px" }, "espèces à saisir") : null,
                  h("button", { class: "btn-petit", onclick: () => { location.hash = "bilan/" + s.id; } }, "Bilan"),
                  h("button", { class: "btn-petit", disabled: !!etat.salonEdition, onclick: () => { etat.salonEdition = s.id; dessinerSalons(); } }, "Modifier")))))))
      : h("div", { class: "vide" }, "Aucun. Les salons passés servent aux recommandations : saisissez ceux de l'historique (dates, fréquentation)."),
    h("div", { class: "note", style: "padding:8px 14px 14px;font-size:13px" }, "Ventes carte : seulement les noms de caisse suivis (les ventes de Lucile et autres « non suivis » sont écartées). Tampons = unités + lots + collections, carte et espèces saisies."),
  );

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, preparation, timeline, tablePasses));
}

// ───────────── Questions ─────────────
const ORDRE_QUESTIONS = { vente_impossible: 0, remboursement: 1, etape_depasse_stock: 2, nom_inconnu: 3, especes_a_saisir: 4 };

async function compterQuestions() {
  try { etat.nbQuestions = (await api("/questions/nombre")).n; } catch { etat.nbQuestions = null; }
  dessinerMenu();
}

async function pageQuestions() {
  [etat.questions, etat.stock, etat.import] = await Promise.all([api("/questions"), api("/stock"), api("/import")]);
  etat.nbQuestions = etat.questions.length;
  dessinerMenu();
  dessinerQuestions();
}

function texteImport(im) {
  if (!im.maj_le) return "Aucun import pour l'instant.";
  const quand = new Date(im.maj_le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const r = im.resultat ?? {};
  let t = `${im.ventes} vente(s) importée(s). Dernier passage : ${quand}`;
  if (r.erreur) t += ` · problème : ${r.erreur}`;
  else if (!im.a_jour) t += " · rattrapage de l'historique en cours (environ 40 ventes par passage, toutes les 15 minutes)";
  else t += " · à jour";
  return t;
}

function boutonImport() {
  return h("button", { class: "btn", onclick: (e) => tenter(async () => {
    e.target.disabled = true; e.target.textContent = "Import en cours…";
    try {
      const r = await api("/import", { method: "POST" });
      flash(r.erreur ? "Import interrompu : " + r.erreur : `${r.nouvelles} nouvelle(s) vente(s) importée(s)${r.a_jour ? "." : " ; il en reste, relancez ou attendez le prochain passage automatique."}`, !!r.erreur);
    } finally { await pageQuestions(); }
  }) }, "Importer les ventes maintenant");
}

function dessinerQuestions() {
  entete("Questions", boutonImport());
  const page = document.getElementById("page");
  const autres = etat.questions.filter((q) => q.type !== "nom_inconnu")
    .sort((a, b) => (ORDRE_QUESTIONS[a.type] ?? 9) - (ORDRE_QUESTIONS[b.type] ?? 9) || a.id - b.id);
  // Noms inconnus : une carte par nom, ses variantes (options SumUp) dedans.
  const groupes = new Map();
  for (const q of etat.questions.filter((q) => q.type === "nom_inconnu")) {
    const k = cleGroupe(q.detail);
    (groupes.get(k) ?? groupes.set(k, []).get(k)).push(q);
  }
  etat.selection ??= new Set();
  for (const id of [...etat.selection]) if (!etat.questions.some((q) => q.id === id)) etat.selection.delete(id);
  const nbSel = etat.selection.size;
  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" },
    h("div", { class: "note" }, texteImport(etat.import)),
    autres.map(carteQuestion),
    groupes.size ? h("p", { class: "note", style: "margin:0" },
      `${groupes.size} nom(s) de la caisse à relier à vos articles. Une seule fois par nom : les ventes suivantes seront reconnues. ` +
      "Les articles qui ne sont pas les vôtres (ventes de Lucile, par exemple) : cochez-les puis « Ne pas suivre la sélection ».") : null,
    [...groupes.values()].map(carteGroupeNom),
    !autres.length && !groupes.size ? h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucune question en attente.")) : null,
    nbSel ? h("div", { class: "barre-selection" },
      h("span", {}, `${nbSel} nom(s) sélectionné(s)`),
      h("button", { class: "btn-sec", onclick: () => { etat.selection.clear(); dessinerQuestions(); } }, "Tout désélectionner"),
      h("button", { class: "btn", onclick: () => tenter(async () => {
        const r = await api("/questions/reponse-groupee", { method: "POST", body: { ids: [...etat.selection], ne_pas_suivre: true } });
        etat.selection.clear();
        flash(`${r.noms} nom(s) marqué(s) « Ne pas suivre ».`);
        await pageQuestions();
      }) }, "Ne pas suivre la sélection")) : null));
}

// Une option « • vert » = un encreur vendu avec ; la couleur ne compte pas, seul leur nombre compte.
function nbCouleurs(description) {
  return description ? (description.match(/•/g) || []).length : 0;
}
function texteCouleurs(n) {
  return n === 0 ? "" : n === 1 ? " + 1 couleur (encreur)" : ` + ${n} couleurs (encreurs)`;
}

// Regroupement : les couleurs (encreurs) se regroupent par nombre ; toute autre option (A5, grandes…) est un article à part.
function cleGroupe(d) {
  const n = nbCouleurs(d.description);
  return d.nom.trim().toLowerCase() + "#" + (n ? "c" + n : (d.description ?? "").trim().toLowerCase());
}

function carteGroupeNom(groupe) {
  const n = nbCouleurs(groupe[0].detail.description);
  const cle = "g:" + cleGroupe(groupe[0].detail);
  const b = brouillons.get(cle) ?? brouillons.set(cle, { lignes: [{ piece_id: null, quantite: 1 }], tampons: "0", choisies: new Set(groupe.map((q) => q.id)) }).get(cle);
  const ids = groupe.map((q) => q.id);
  const toutesSel = ids.every((id) => etat.selection.has(id));
  const periode = (d) => d.premier ? (d.premier === d.dernier ? `le ${fmtDate(d.premier)}` : `du ${fmtDate(d.premier)} au ${fmtDate(d.dernier)}`) : "";
  const vendus = groupe.reduce((t, q) => t + (q.detail.quantite ?? 0), 0);
  const choisies = () => ids.filter((id) => b.choisies.has(id));
  const repondre = (corps, msg) => tenter(async () => {
    const sel = choisies();
    if (!sel.length) throw new Error("Cochez au moins une variante.");
    const r = await api("/questions/reponse-groupee", { method: "POST", body: { ids: sel, ...corps } });
    if (sel.length === ids.length) brouillons.delete(cle);
    flash(msg(r));
    await pageQuestions();
  });
  const variantes = groupe.length > 1 || groupe[0].detail.description
    ? h("div", { class: "bloc-editeur" },
        h("div", { class: "note" }, n
          ? `Couleur${n > 1 ? "s" : ""} vue${n > 1 ? "s" : ""} à la caisse (non suivie${n > 1 ? "s" : ""}) : ajoutez l'article Encreur × ${n} dans la réponse.`
          : "Option vue à la caisse :"),
        groupe.map((q) => h("label", { class: "ligne-editeur" },
          groupe.length > 1 ? h("input", { type: "checkbox", checked: b.choisies.has(q.id), onchange: (e) => { e.target.checked ? b.choisies.add(q.id) : b.choisies.delete(q.id); } }) : null,
          h("span", {}, h("strong", {}, q.detail.description || "(sans option)"),
            h("span", { class: "note" }, ` · ${q.detail.quantite} vendu(s) ${periode(q.detail)}${q.detail.prix ? ` · ${q.detail.prix} €` : ""}`)))))
    : null;
  return h("section", { class: "carte" + (toutesSel ? " selectionnee" : "") },
    h("div", { class: "tete-article" },
      h("h2", { style: "padding:0" }, `SumUp vend « ${groupe[0].detail.nom}${!n && groupe[0].detail.description ? " · " + groupe[0].detail.description : ""} »${texteCouleurs(n)}`),
      h("label", { class: "ligne-editeur note" }, h("input", { type: "checkbox", checked: toutesSel, onchange: (e) => {
        ids.forEach((id) => (e.target.checked ? etat.selection.add(id) : etat.selection.delete(id)));
        dessinerQuestions();
      } }), "sélectionner")),
    h("div", { class: "editeur", style: "border-top:0;padding-top:0" },
      groupe.length === 1 && !groupe[0].detail.description
        ? h("div", { class: "note" }, `${vendus} vendu(s) ${periode(groupe[0].detail)}${groupe[0].detail.prix ? ` · ${groupe[0].detail.prix} €` : ""}.`) : null,
      variantes,
      h("div", {}, "Quel article est-ce ? Chaque vente le retirera du stock :"),
      lignesPieces(b.lignes, "Article vendu"),
      creationRapide(b, n ? groupe[0].detail.nom : [groupe[0].detail.nom, groupe[0].detail.description].filter(Boolean).join(" ")),
      h("div", { class: "barre-comptage" },
        h("button", { class: "btn-sec", onclick: () => repondre({ ne_pas_suivre: true }, (r) => `${r.noms} nom(s) marqué(s) « Ne pas suivre ».`) }, "Ne pas suivre"),
        h("button", { class: "btn", onclick: () => {
          if (!b.lignes.every(choisie)) return flash("Choisissez un article sur chaque ligne.", true);
          repondre(corpsReponse(b.lignes),
            (r) => `Enregistré pour ${r.noms} nom(s). ${r.ventes_appliquees} vente(s) retirée(s) du stock ; les ventes antérieures au début du suivi d'un article ne servent qu'aux statistiques.`);
        } }, "Enregistrer"))));
}

// « Créer cet article » sans quitter la question : famille existante ou nouvelle, puis l'article est choisi dans la réponse.
function creationRapide(b, nomPropose) {
  if (!b.creation) {
    return h("div", {}, h("button", { type: "button", class: "btn-petit", onclick: () => {
      b.creation = { nom: nomPropose.replace(/\s+-\s+print fine art/i, "").trim(), famille: etat.stock[0]?.id ? String(etat.stock[0].id) : "nouvelle", nouvelleFamille: "", niveau: "a_vendre", suivi: "quantite" };
      dessinerQuestions();
    } }, "+ Créer cet article"));
  }
  const c = b.creation;
  const fam = h("select", { "aria-label": "Famille", onchange: (e) => { c.famille = e.target.value; dessinerQuestions(); } },
    etat.stock.map((f) => h("option", { value: String(f.id), selected: c.famille === String(f.id) }, f.nom)),
    h("option", { value: "nouvelle", selected: c.famille === "nouvelle" }, "+ nouvelle famille…"));
  return h("div", { class: "choix-editeur" },
    h("strong", {}, "Nouvel article"),
    h("div", { class: "ligne-editeur" },
      h("input", { value: c.nom, "aria-label": "Nom de l'article", style: "min-width:240px", oninput: (e) => { c.nom = e.target.value; } }),
      fam,
      c.famille === "nouvelle" ? h("input", { value: c.nouvelleFamille, placeholder: "nom de la famille", "aria-label": "Nouvelle famille", oninput: (e) => { c.nouvelleFamille = e.target.value; } }) : null,
      h("select", { "aria-label": "Type", onchange: (e) => { c.niveau = e.target.value; } }, Object.entries(NIVEAUX).map(([k, v]) => h("option", { value: k, selected: c.niveau === k }, v))),
      h("select", { "aria-label": "Suivi", onchange: (e) => { c.suivi = e.target.value; } }, Object.entries(SUIVIS).map(([k, v]) => h("option", { value: k, selected: c.suivi === k }, v)))),
    h("div", { class: "ligne-editeur" },
      h("button", { type: "button", class: "btn", onclick: () => tenter(async () => {
        let famille_id = Number(c.famille);
        if (c.famille === "nouvelle") famille_id = (await api("/familles", { method: "POST", body: { nom: c.nouvelleFamille, ordre: etat.stock.length } })).id;
        const { id } = await api("/pieces", { method: "POST", body: { nom: c.nom, famille_id, niveau: c.niveau, suivi: c.suivi } });
        etat.stock = await api("/stock");
        const vide = b.lignes.find((l) => !choisie(l) && !l.fourniture);
        if (vide) vide.piece_id = id; else b.lignes.push({ piece_id: id, quantite: 1 });
        b.creation = null;
        flash(`« ${c.nom} » créé et choisi ci-dessus. Vérifiez puis « Enregistrer ».`);
        dessinerQuestions();
      }) }, "Créer"),
      h("button", { type: "button", class: "btn-sec", onclick: () => { b.creation = null; dessinerQuestions(); } }, "Annuler")));
}

function lignesReponse(etatLignes, label, redessiner) {
  const ligne = (l, i) => h("div", { class: "ligne-editeur" },
    l.fourniture ? h("span", { class: "note" }, "fourniture") : null,
    l.fourniture ? selectPiece(l.piece_id, (v) => { l.piece_id = v; }, "Fourniture utilisée à la vente", "fournitures") : selectArticleOuFamille(l, label),
    h("span", { class: "note" }, "×"),
    h("input", { type: "number", min: "1", step: "1", class: "compte", value: String(l.quantite), "aria-label": "Quantité", oninput: (e) => { l.quantite = e.target.value; } }),
    etatLignes.length > 1 ? h("button", { type: "button", class: "btn-petit", onclick: () => { etatLignes.splice(i, 1); redessiner(); } }, "Retirer") : null);
  return h("div", { class: "bloc-editeur" },
    etatLignes.map(ligne),
    h("div", { class: "ligne-editeur" },
      h("button", { type: "button", class: "btn-petit", onclick: () => { etatLignes.push({ piece_id: null, quantite: 1 }); redessiner(); } }, "+ un autre article"),
      h("button", { type: "button", class: "btn-petit", onclick: () => { etatLignes.push({ piece_id: null, quantite: 1, fourniture: true }); redessiner(); } }, "+ une fourniture utilisée à la vente (emballage…)")));
}

function lignesPieces(etatLignes, label) {
  return lignesReponse(etatLignes, label, dessinerQuestions);
}

const brouillons = new Map(); // id question → saisie en cours (survit au redessin)

function carteQuestion(q) {
  const d = q.detail;
  const repondre = (corps, message) => tenter(async () => {
    const r = await api(`/questions/${q.id}/reponse`, { method: "POST", body: corps });
    brouillons.delete(q.id);
    flash(message(r));
    await pageQuestions();
  });

  if (q.type === "especes_a_saisir") {
    return h("section", { class: "question" },
      h("strong", {}, `Espèces de « ${d.nom} » à recopier`),
      h("div", {}, "Recopiez la table manuscrite dans le bilan du salon : c'est ce qui retire les ventes en espèces du stock."),
      h("div", {}, h("button", { class: "btn", onclick: () => { location.hash = "bilan/" + d.salon_id; } }, "Ouvrir le bilan")));
  }

  if (q.type === "vente_impossible") {
    const input = h("input", { type: "number", min: "0", step: "1", class: "compte", placeholder: "ex. 4", "aria-label": "Nombre réel" });
    return h("section", { class: "question" },
      h("strong", {}, "Vente alors qu'il n'en restait plus"),
      h("div", {}, `SumUp a vendu ${d.vendus} ${q.piece} alors qu'il n'en restait ${d.stock_avant ? "que " + d.stock_avant : "plus"} selon l'outil. Vous en avez sûrement fabriqué sans le noter. Combien en aviez-vous vraiment avant ces ventes ?`),
      h("div", { class: "ligne-editeur" }, input,
        h("button", { class: "btn", onclick: () => {
          if (input.value === "") return flash("Indiquez un nombre.", true);
          repondre({ compte: Number(input.value) }, (r) => `C'est corrigé : il en reste ${r.stock}.`);
        } }, "Valider")));
  }

  if (q.type === "nom_inconnu") {
    const b = brouillons.get(q.id) ?? brouillons.set(q.id, { lignes: [{ piece_id: null, quantite: 1 }], tampons: "0" }).get(q.id);
    const nom = d.description ? `${d.nom} · ${d.description}` : d.nom;
    const periode = d.premier ? (d.premier === d.dernier ? `le ${fmtDate(d.premier)}` : `du ${fmtDate(d.premier)} au ${fmtDate(d.dernier)}`) : "";
    return h("section", { class: "carte" },
      h("h2", {}, `SumUp vend « ${nom} »`),
      h("div", { class: "editeur", style: "border-top:0" },
        h("div", { class: "note" }, `${d.quantite ?? 0} vendu(s) en ${d.ventes ?? 0} vente(s) ${periode}${d.prix ? ` · ${d.prix} €` : ""}. Quel article est-ce ? Une vente retirera ces pièces du stock.`),
        lignesPieces(b.lignes, "Article vendu"),
        h("div", { class: "note", style: "font-size:13px" }, "Article absent de la liste ? Créez-le d'abord dans ", h("a", { href: "#reglages" }, "Réglages"), "."),
        h("div", { class: "barre-comptage" },
          h("button", { class: "btn-sec", onclick: () => repondre({ ne_pas_suivre: true }, () => "Noté : ce nom ne sera pas suivi.") }, "Ne pas suivre"),
          h("button", { class: "btn", onclick: () => {
            if (!b.lignes.every(choisie)) return flash("Choisissez un article sur chaque ligne.", true);
            repondre(corpsReponse(b.lignes),
              (r) => `Enregistré. ${r.ventes_appliquees} vente(s) récente(s) retirée(s) du stock (les ventes antérieures au début du suivi d'un article ne comptent que pour les statistiques).`);
          } }, "Enregistrer"))));
  }

  if (q.type === "remboursement") {
    const b = brouillons.get(q.id) ?? brouillons.set(q.id, { lignes: [{ piece_id: null, quantite: 1 }] }).get(q.id);
    const quand = d.date ? new Date(d.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
    return h("section", { class: "carte" },
      h("h2", {}, `Remboursement de ${d.montant ?? "?"} € ${quand ? "(" + quand + ")" : ""}`),
      h("div", { class: "editeur", style: "border-top:0" },
        h("div", { class: "note" }, "L'article est-il revenu en stock ?" + (d.type ? ` (opération SumUp : ${d.type})` : "")),
        lignesPieces(b.lignes, "Article revenu en stock"),
        h("div", { class: "barre-comptage" },
          h("button", { class: "btn-sec", onclick: () => repondre({ rien: true }, () => "Noté.") }, "Rien n'est revenu"),
          h("button", { class: "btn", onclick: () => {
            if (!b.lignes.every(choisie)) return flash("Choisissez un article sur chaque ligne.", true);
            repondre({ pieces: corpsReponse(b.lignes).pieces }, () => "Remis en stock.");
          } }, "Remettre en stock"))));
  }
  return h("section", { class: "carte" }, h("div", { class: "vide" }, "Question : " + q.type));
}

// ───────────── Noms SumUp (Réglages) ─────────────
function sectionCorrespondances() {
  const liste = etat.correspondances ?? [];
  if (!liste.length) return null;
  const ed = etat.corrEdition;
  return h("section", { class: "carte" },
    h("h2", {}, "Noms SumUp"),
    h("p", { class: "note", style: "margin:0;padding:0 14px 8px;font-size:13px" }, "Ce que chaque nom de la caisse retire du stock. Modifier une ligne réapplique toutes ses ventes."),
    h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Nom à la caisse", "Retire du stock", "Vendus", ""].map((t, i) => h("th", { class: i === 2 ? "num" : null }, t)))),
      h("tbody", {}, liste.map((c) => ed && ed.cle === c.cle
        ? h("tr", {}, h("td", { colspan: "4" }, h("div", { class: "editeur", style: "border-top:0" },
            h("strong", {}, c.nom_affiche),
            lignesPiecesReglages(ed.lignes),
            h("div", { class: "barre-comptage" },
              h("button", { class: "btn-sec", onclick: () => { etat.corrEdition = null; dessinerReglages(); } }, "Annuler"),
              h("button", { class: "btn-sec", onclick: () => sauverCorrespondance({ cle: c.cle, ne_pas_suivre: true }) }, "Ne pas suivre"),
              h("button", { class: "btn", onclick: () => {
                if (!ed.lignes.every(choisie)) return flash("Choisissez un article sur chaque ligne.", true);
                sauverCorrespondance({ cle: c.cle, ...corpsReponse(ed.lignes) });
              } }, "Enregistrer")))))
        : h("tr", {},
            h("td", { style: "font-weight:600" }, c.nom_affiche),
            h("td", {}, c.ne_pas_suivre ? h("span", { class: "note" }, "non suivi") : [
              ...c.familles.map((f) => `${f.quantite > 1 ? f.quantite + " × " : ""}${f.nom} (modèle non précisé)`),
              ...c.pieces.map((p) => `${p.quantite > 1 ? p.quantite + " × " : ""}${p.nom}`)].join(" + ")),
            h("td", { class: "num" }, c.vendus),
            h("td", {}, h("div", { class: "actions-ligne" }, h("button", { class: "btn-petit", disabled: !!ed, onclick: () => {
              const lignes = [...c.familles.map((f) => ({ famille_id: f.famille_id, quantite: f.quantite })),
                ...c.pieces.map((p) => ({ piece_id: p.piece_id, quantite: p.quantite, fourniture: estFourniture(p.piece_id) }))];
              etat.corrEdition = { cle: c.cle, lignes: lignes.length ? lignes : [{ piece_id: null, quantite: 1 }] };
              dessinerReglages();
            } }, "Modifier"))))))));
}

function lignesPiecesReglages(lignes) {
  return lignesReponse(lignes, "Article", dessinerReglages);
}

function sauverCorrespondance(corps) {
  tenter(async () => {
    const r = await api("/correspondances", { method: "PUT", body: corps });
    etat.corrEdition = null;
    flash(`Enregistré : ${r.ventes_appliquees} vente(s) réappliquée(s) au stock.`);
    await pageReglages();
  });
}

// ───────────── Bilan d'un salon ─────────────
const euros = (x) => (Math.round(x * 100) / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: x % 1 ? 2 : 0 });

async function pageBilan(id) {
  [etat.bilan, etat.caisse] = await Promise.all([api(`/salons/${id}/bilan`), api(`/salons/${id}/caisse`)]);
  // Une ligne par chose vendue : les noms de caisse qui retirent exactement la même chose du stock sont regroupés
  // (anciens noms SumUp, « Édition 2025 », couleurs d'encreur…), au nom de l'article quand il n'y en a qu'un.
  const groupes = new Map();
  for (const c of etat.bilan.caisse) {
    const k = c.signature || "cle:" + c.cle;
    const g = groupes.get(k) ?? groupes.set(k, { membres: [], especes: 0, tampons: c.tampons, contenu: c.contenu }).get(k);
    g.membres.push(c); g.especes += c.especes;
  }
  etat.bilan.groupes = [...groupes.values()].map((g) => {
    const ventes = (c) => c.prix.reduce((t, x) => t + x.n, 0);
    const principal = [...g.membres].sort((a, b) => ventes(b) - ventes(a))[0];
    const [base, option] = principal.nom_affiche.split(" · ");
    const nom = g.contenu.length === 1 && !g.contenu[0].includes("×") && g.membres.every((m) => m.signature.startsWith("p"))
      ? g.contenu[0] : base + texteCouleurs(nbCouleurs(option));
    const parPrix = new Map();
    for (const m of g.membres) for (const x of m.prix) parPrix.set(x.prix, (parPrix.get(x.prix) ?? 0) + x.n);
    const prix = [...parPrix].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
    return { nom, cle: principal.cle, tampons: g.tampons, especes: g.especes, prix, relie: g.contenu.length > 0,
      recherche: sansAccent([nom, ...g.membres.map((m) => m.nom_affiche), ...g.contenu].join(" ")) };
  }).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  etat.bilanEspeces = { q: Object.fromEntries(etat.bilan.groupes.filter((g) => g.especes).map((g) => [g.cle, String(g.especes)])), filtre: "", saisis: false };
  dessinerBilan();
}

function dessinerBilan() {
  const d = etat.bilan, e = etat.bilanEspeces;
  entete("Bilan · " + d.salon.nom, h("button", { class: "btn-sec", onclick: () => { location.hash = "salons"; } }, "← Salons"));
  const page = document.getElementById("page");

  const tuile = (titre, valeur, sous) => h("div", { class: "tuile" }, h("span", { class: "note" }, titre), h("strong", {}, valeur), sous ? h("span", { class: "note", style: "font-size:13px" }, sous) : null);
  const autres = d.jours.reduce((t, j) => t + j.autres, 0), aRelier = d.jours.reduce((t, j) => t + j.a_relier, 0);
  const tuiles = h("div", { class: "tuiles" },
    tuile("Ventes carte", euros(d.carte_suivi), d.jours.map((j) => `${euros(j.suivi)} le ${fmtDate(j.jour)}`).join(" · ") || "aucune"),
    tuile("Espèces notées", etat.caisse ? euros(etat.caisse.especes_notees.total) : "—", "recopiées du cahier, ci-dessous"),
    tuile("Tampons (thermomètre)", String(d.tampons.total), d.tampons.pour_1000 === null ? "fréquentation inconnue" : `${String(d.tampons.pour_1000).replace(".", ",")} pour 1 000 visiteurs` + (d.tampons.especes ? ` · dont ${d.tampons.especes} en espèces` : "")),
    tuile("Fréquentation", d.salon.frequentation ? "~" + d.salon.frequentation.toLocaleString("fr-FR") : "?", [d.salon.type, `${d.salon.nb_jours} jour(s)`].filter(Boolean).join(" · ")));

  const alertes = [];
  if (aRelier) alertes.push(h("div", { class: "question" }, h("strong", {}, `${euros(aRelier)} de ventes avec des noms pas encore reliés`),
    h("div", {}, "Ils ne comptent ni dans les articles ni dans les tampons. ", h("a", { href: "#questions" }, "Les relier dans Questions"), ".")));
  if (autres) alertes.push(h("div", { class: "note" }, `${euros(autres)} de ventes « non suivies » (ex. articles de Lucille) écartées du bilan.`));

  const articles = h("section", { class: "carte" }, h("h2", {}, "Par article"),
    d.articles.length ? h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Article", "Vendus", "dont espèces", "Pour 100 tampons", "Mal exposé ou épuisé ?"].map((t, i) => h("th", { class: i && i < 4 ? "num" : null }, t)))),
      h("tbody", {}, d.articles.map((a) => h("tr", {},
        h("td", {}, h("strong", {}, a.nom), h("div", { class: "note", style: "font-size:12px" }, a.famille)),
        h("td", { class: "num qte" }, a.vendus), h("td", { class: "num" }, a.especes || ""),
        h("td", { class: "num" }, a.pour_100 === null ? "—" : String(a.pour_100).replace(".", ",")),
        h("td", {}, h("button", { class: "pastille-filtre", "aria-pressed": String(a.mal_expose), onclick: () => tenter(async () => {
          await api(`/salons/${d.salon.id}/mal-expose`, { method: "PUT", body: { piece_id: a.piece_id, mal_expose: !a.mal_expose } });
          a.mal_expose = !a.mal_expose; dessinerBilan();
        }) }, a.mal_expose ? "Oui · ne compte pas" : "Non")))))) : h("div", { class: "vide" }, "Aucune vente d'article reliée pour ce salon."),
    h("p", { class: "note", style: "margin:0;padding:8px 14px 14px;font-size:13px" }, "Les articles marqués « ne compte pas » sont écartés des recommandations des prochains salons (mal mis en avant, ou épuisés en cours de salon)."));

  // Espèces : une ligne par chose vendue, recherche souple, total en direct, enregistrement par le bouton.
  const mots = sansAccent(e.filtre.trim()).split(/\s+/).filter(Boolean);
  const visibles = d.groupes.filter((g) => (!e.saisis || Number(e.q[g.cle]) > 0) && mots.every((m) => g.recherche.includes(m)));
  const totalEl = h("strong", {}), nbEl = h("span", { class: "note" });
  const majTotal = () => {
    let t = 0, n = 0, inconnus = 0;
    for (const g of d.groupes) { const q = Number(e.q[g.cle]) || 0; if (!q) continue; n += q; if (g.prix === null) inconnus++; else t += q * g.prix; }
    totalEl.textContent = euros(t);
    nbEl.textContent = `${n} article(s) vendu(s) en espèces` + (inconnus ? ` · ${inconnus} sans prix connu, pas compté(s)` : "");
  };
  majTotal();
  const recherche = h("input", { id: "esp-filtre", type: "search", value: e.filtre, placeholder: "ex. sauge, lot, salamandre a5", autocomplete: "off",
    oninput: (ev) => { e.filtre = ev.target.value; dessinerBilan(); const el = document.getElementById("esp-filtre"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  const especes = h("section", { class: "carte" }, h("h2", {}, "Ventes en espèces (cahier)"),
    h("p", { class: "note", style: "margin:0;padding:0 14px" }, "Recopiez le cahier : combien de chaque chose vendue en espèces. Les noms de caisse qui désignent la même chose sont regroupés."),
    h("div", { class: "formulaire" },
      h("label", { for: "esp-filtre" }, "Chercher", recherche),
      h("label", { class: "ligne-editeur note" }, h("input", { type: "checkbox", checked: e.saisis, onchange: (ev) => { e.saisis = ev.target.checked; dessinerBilan(); } }), "seulement ce qui est saisi")),
    h("table", { class: "tbl" }, h("tbody", {}, visibles.length ? visibles.map((g) => h("tr", {},
      h("td", {}, h("strong", {}, g.nom), g.tampons ? h("span", { class: "note" }, ` · ${g.tampons} tampon(s)`) : null, g.relie ? null : h("span", { class: "note" }, " · pas relié à un article")),
      h("td", { class: "num note", style: "width:110px", title: g.prix !== null && g.prix % 1 ? "Vendu seulement avec une remise sur le panier : prix réel inconnu" : null },
        g.prix === null ? "prix ?" : g.prix % 1 ? `≈ ${euros(g.prix)} ?` : euros(g.prix)),
      h("td", { class: "num", style: "width:110px" }, h("input", { class: "compte", type: "number", min: "0", step: "1", value: e.q[g.cle] ?? "", placeholder: "0", "aria-label": "Vendus en espèces : " + g.nom,
        oninput: (ev) => { e.q[g.cle] = ev.target.value; majTotal(); } })))) : h("tr", {}, h("td", { class: "note" }, "Rien ne correspond.")))),
    h("div", { class: "barre-comptage", style: "padding:14px" },
      h("div", { class: "total-caisse", style: "padding:0;flex:1" }, h("span", { class: "note" }, "Total espèces notées"), totalEl, nbEl),
      h("button", { class: "btn", onclick: () => tenter(async () => {
        const lignes = Object.entries(e.q).filter(([, v]) => v !== "" && Number(v) > 0).map(([cle, v]) => ({ cle, quantite: Number(v) }));
        if (lignes.some((l) => !Number.isInteger(l.quantite))) throw new Error("Les quantités doivent être des nombres entiers.");
        const r = await api(`/salons/${d.salon.id}/especes`, { method: "PUT", body: { montant: d.especes_montant, lignes } });
        flash(`Espèces enregistrées (${lignes.length} ligne(s), ${r.appliquees} retrait(s) de stock).`);
        await pageBilan(d.salon.id);
      }) }, "Enregistrer les espèces")));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, tuiles, ...alertes, articles, especes, sectionComptageCaisse(), sectionCaisse()));
}

// Comptage de caisse en fin de salon : billets et pièces, total en direct, enregistré à chaque saisie.
const BILLETS = ["500", "200", "100", "50", "20", "10", "5"], PIECES = ["2", "1", "0.5", "0.2", "0.1", "0.05", "0.02", "0.01"];
const libelleCoupure = (k) => (Number(k) >= 1 ? `${k} €` : `${Math.round(Number(k) * 100)} c`);
// Grille billets / pièces : coupures = { "50": 3, … } ; surSaisie à chaque frappe, surFin quand une case est quittée.
function grilleCoupures(coupures, surSaisie, surFin, prefixe) {
  const champ = (v) => h("label", { class: "coupure" }, h("span", {}, libelleCoupure(v)),
    h("input", { id: `${prefixe}-${v}`, type: "number", min: "0", step: "1", inputmode: "numeric", value: coupures[v] ?? "", placeholder: "0", "aria-label": `Nombre de ${libelleCoupure(v)}`,
      oninput: (e) => { coupures[v] = e.target.value === "" ? 0 : Number(e.target.value); surSaisie(); }, onchange: surFin }));
  return h("div", { class: "coupures" }, h("div", {}, h("h3", { class: "sous-titre" }, "Billets"), h("div", { class: "grille-coupures" }, BILLETS.map(champ))),
    h("div", {}, h("h3", { class: "sous-titre" }, "Pièces"), h("div", { class: "grille-coupures" }, PIECES.map(champ))));
}
const totalCoupures = (c) => Math.round(Object.entries(c).reduce((t, [v, n]) => t + Number(v) * 100 * (Number(n) || 0), 0)) / 100;

function sectionComptageCaisse() {
  const k = etat.caisse;
  if (!k) return null;
  const coupures = { ...k.caisse_comptee.coupures };
  const totalEl = h("strong", {}), detailEl = h("div", { class: "lecture-caisse" });
  const total = () => totalCoupures(coupures);
  const majTotaux = () => {
    const t = total(), fond = k.fond_caisse, liquide = fond === null ? null : Math.round((t - fond) * 100) / 100;
    totalEl.textContent = euros(t);
    const reste = liquide === null ? null : Math.round((liquide - k.especes_notees.total) * 100) / 100;
    const v = k.sans_trace.valeur_manquants;
    detailEl.replaceChildren(
      h("p", {}, "Compté : ", h("b", {}, euros(t)), fond === null ? h("span", {}, " · fond de caisse à indiquer dans ", h("a", { href: "#reglages" }, "Réglages")) : [" − fond ", euros(fond), " = liquide du salon ", h("b", {}, euros(liquide))]),
      reste === null || !t ? null : h("p", {}, "− tes espèces notées ", euros(k.especes_notees.total), " = ", h("b", {}, euros(reste)), " restant",
        reste < 0 ? h("span", { class: "manque-txt" }, ` : il manque ${euros(-reste)} dans la caisse (rendu de monnaie, vente notée deux fois, ou espèces pas toutes notées ?).`)
          : ` : à comparer aux ${euros(v)} d'articles sortis sans trace ; ce qui dépasse correspond aux ventes de Lucille (notées ou oubliées).`));
  };
  const enregistrer = () => tenter(async () => {
    await api(`/salons/${k.salon.id}/caisse`, { method: "PUT", body: { coupures } });
    k.caisse_comptee = { coupures: { ...coupures }, total: total() };
  });
  majTotaux();
  return h("section", { class: "carte" }, h("h2", {}, "Comptage de caisse"),
    h("p", { class: "note", style: "margin:0;padding:0 14px" }, "Fin de salon, fond de caisse compris. Enregistré à chaque saisie."),
    grilleCoupures(coupures, majTotaux, enregistrer, "caisse"),
    h("div", { class: "total-caisse" }, h("span", { class: "note" }, "Total compté"), totalEl),
    detailEl);
}

// Caisse et écarts : ce qui est sorti du stock sans trace (ni carte ni espèces notées), et sa valeur.
function sectionCaisse() {
  const k = etat.caisse;
  if (!k) return null;
  const st = k.sans_trace, en = k.especes_notees;
  const titre = h("h2", {}, "Caisse et écarts");
  if (!k.comptes_avant || !k.comptes_apres) return h("section", { class: "carte" }, titre, h("div", { class: "vide" },
    !k.comptes_avant ? "Pas de comptage avant ce salon : impossible de savoir ce qui est sorti sans trace." : "Pas encore de comptage après ce salon : comptez le stock au retour pour voir les écarts."));
  const manquants = st.lignes.filter((l) => l.sans_trace > 0), enTrop = st.lignes.filter((l) => l.sans_trace < 0);
  const tableau = (lignes, signe) => h("table", { class: "tbl" },
    h("thead", {}, h("tr", {}, ["Article", "Avant", "Vendus (carte + espèces notées)", "Autres mouvements", "Après", signe > 0 ? "Manquent" : "En trop", "Prix", "Valeur"].map((t, i) => h("th", { class: i ? "num" : null }, t)))),
    h("tbody", {}, lignes.map((l) => h("tr", {},
      h("td", {}, h("strong", {}, l.nom), h("div", { class: "note", style: "font-size:12px" }, l.famille)),
      h("td", { class: "num" }, l.avant), h("td", { class: "num" }, l.vendus || ""), h("td", { class: "num" }, l.autres ? signe1(l.autres) : ""),
      h("td", { class: "num" }, l.apres), h("td", { class: "num qte" + (signe > 0 ? " neg" : "") }, Math.abs(l.sans_trace)),
      h("td", { class: "num" }, l.prix === null ? "?" : euros(l.prix)), h("td", { class: "num" }, l.valeur === null ? "?" : euros(Math.abs(l.valeur)))))));
  const fond = k.fond_caisse;
  const attenduCaisse = (fond ?? 0) + en.total;
  return h("section", { class: "carte" }, titre,
    h("div", { class: "bandeau-caisse" },
      h("div", {}, h("span", { class: "note" }, "Tes ventes en espèces notées"), h("strong", {}, euros(en.total)),
        h("span", { class: "note" }, en.lignes.length ? `${en.lignes.reduce((t, e) => t + e.quantite, 0)} article(s), au prix SumUp` : "rien de noté (section Espèces ci-dessus)")),
      h("div", {}, h("span", { class: "note" }, "Sortis sans trace (valeur)"), h("strong", {}, euros(st.valeur_manquants)),
        h("span", { class: "note" }, `${manquants.reduce((t, l) => t + l.sans_trace, 0)} article(s) : vendus en espèces sans être notés, ou perdus, donnés…`)),
      h("div", {}, h("span", { class: "note" }, "Fond de caisse"), h("strong", {}, fond === null ? "?" : euros(fond)),
        fond === null ? h("a", { href: "#reglages", class: "note" }, "à indiquer dans Réglages") : h("span", { class: "note" }, "réglage"))),
    h("div", { class: "lecture-caisse" },
      h("p", {}, "Dans la caisse, pour tes articles, il devrait y avoir ", h("b", {}, euros(attenduCaisse)), ` (fond${fond === null ? " ?" : ""} + tes espèces notées), et jusqu'à `,
        h("b", {}, euros(attenduCaisse + st.valeur_manquants)), " si tous les articles sortis sans trace ont été vendus en espèces."),
      h("p", { class: "note" }, "Le reste du liquide compté revient à Lucille (ses ventes notées au cahier, plus celles qui auraient été oubliées).")),
    st.manquants_sans_prix.length || en.sans_prix.length ? h("div", { class: "question", style: "margin:0 14px 14px" },
      h("strong", {}, "Prix inconnu (non compté dans les totaux) : "), [...st.manquants_sans_prix, ...en.sans_prix].join(", ")) : null,
    manquants.length ? [h("h3", { class: "sous-titre" }, "Articles manquants"), tableau(manquants, 1)] : h("div", { class: "vide" }, "Aucun article manquant : le stock tombe juste."),
    enTrop.length ? [h("h3", { class: "sous-titre" }, "Articles en trop"),
      h("p", { class: "note", style: "margin:0 14px" }, "Plus que prévu : souvent produits sans « C'est fait » dans la préparation, ou une erreur au comptage d'avant. Pas comptés dans la valeur ci-dessus."),
      tableau(enTrop, -1)] : null,
    h("p", { class: "note", style: "margin:0;padding:8px 14px 14px;font-size:13px" },
      `Calcul : pour chaque article compté avant (${k.comptes_avant}) et après (${k.comptes_apres}) le salon, attendu = compté avant − vendus + autres mouvements (fabrication, réceptions) ; l'écart avec le compté après est « sans trace ». Ventes en ligne entre le salon et le comptage comprises.`));
}
const signe1 = (n) => (n > 0 ? "+" + n : String(n));

// ───────────── À acheter ─────────────
// Réglages d'achat d'une fourniture (délai, mode, lots).
async function ouvrirReglageAchat(p) {
  const r = await api(`/pieces/${p.id}/achat`);
  etat.achatEdition = { id: p.id, delai: r.delai_jours ?? "", mode: r.mode_achat ?? "quantite", lots: r.lots.join(", "), seuil: r.seuil ?? "" };
  dessinerReglages();
}

function editeurAchat(p) {
  const e = etat.achatEdition;
  return h("tr", {}, h("td", { colspan: "5", style: "background:#FBF8F2" }, h("div", { class: "formulaire", style: "padding:4px 0" },
    h("strong", { style: "align-self:center" }, "Achat · " + p.nom),
    h("label", {}, "Délai du fournisseur (jours)", h("input", { type: "number", min: "0", step: "1", value: String(e.delai), style: "width:120px", oninput: (ev) => { e.delai = ev.target.value; } })),
    h("label", {}, "Se commande", h("select", { onchange: (ev) => { e.mode = ev.target.value; } },
      [["quantite", "à la quantité"], ["tout_le_disponible", "tout le disponible (stock fournisseur limité)"], ["jamais", "jamais (récup)"]]
        .map(([k, v]) => h("option", { value: k, selected: e.mode === k }, v)))),
    h("label", {}, "Tailles de lot (ex. 30, 80, 160)", h("input", { value: e.lots, placeholder: "inconnues", oninput: (ev) => { e.lots = ev.target.value; } })),
    h("label", {}, "Alerte sous (vide : pas d'alerte)", h("input", { type: "number", min: "0", step: "1", value: String(e.seuil), style: "width:120px", oninput: (ev) => { e.seuil = ev.target.value; } })),
    h("button", { class: "btn", onclick: () => tenter(async () => {
      const lots = e.lots.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (lots.some((t) => !Number.isInteger(t) || t < 1)) throw new Error("Tailles de lot : des nombres entiers séparés par des virgules.");
      await api(`/pieces/${p.id}/achat`, { method: "PUT", body: { delai_jours: e.delai === "" ? null : Number(e.delai), mode_achat: e.mode, lots, seuil: e.seuil === "" ? null : Number(e.seuil) } });
      etat.achatEdition = null; flash("Réglages d'achat enregistrés."); await pageReglages();
    }) }, "Enregistrer"),
    h("button", { class: "btn-sec", onclick: () => { etat.achatEdition = null; dessinerReglages(); } }, "Annuler"))));
}

// ───────────── Accueil : rétro-planning ─────────────
const glisserPossible = () => window.matchMedia("(pointer: fine)").matches;
const plusJours = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

async function pageAccueil() {
  etat.accueil = await api("/accueil");
  dessinerAccueil();
}

async function deplacerJalon(j, date) {
  const prep = etat.accueil.preparation.id;
  if (j.type === "perso") await api("/jalons/" + j.id, { method: "PATCH", body: { date } });
  else await api("/jalons/standard", { method: "PUT", body: { salon_id: prep, type: j.type, date } });
}

function dessinerAccueil() {
  const d = etat.accueil;
  entete("Accueil");
  const page = document.getElementById("page");
  if (!d.preparation) {
    page.replaceChildren(h("div", { class: "carte" }, h("div", { class: "vide" },
      "Aucun salon à venir. Ajoutez le prochain dans ", h("a", { href: "#salons" }, "Salons"), " : le rétro-planning apparaîtra ici.")),
      d.sous_seuil?.length ? h("div", { class: "tuiles" }, tuileSeuil(d.sous_seuil)) : null);
    return;
  }
  const premier = d.salons[0];
  const dernierFin = d.salons.reduce((m, s) => (s.fin > m ? s.fin : m), premier.fin);
  const dates = [d.aujourdhui, ...d.jalons.map((j) => j.date), dernierFin];
  const debut = plusJours(dates.reduce((m, x) => (x < m ? x : m)), -2);
  const fin = plusJours(dates.reduce((m, x) => (x > m ? x : m)), 3);
  const total = joursEntre(debut, fin) + 1;
  const pct = (date) => (joursEntre(debut, date) / total) * 100;
  const avertDe = (j) => d.avertissements.filter((a) => a.type === j.type && (a.id === null || a.id === j.id));
  const jAvant = joursEntre(d.aujourdhui, premier.date_debut);

  // Frise en ligne de métro : une ligne, les jalons comme des stations, les étiquettes
  // au-dessus ou en dessous (rangées calculées pour qu'elles ne se chevauchent pas).
  const frise = h("div", { class: "metro" + (glisserPossible() ? " glissable" : "") });
  const voie = h("div", { class: "metro-voie" });
  const centre = (date) => pct(date) + 50 / total;
  const dateDepuis = (clientX) => {
    const r = frise.getBoundingClientRect();
    const k = Math.round(((clientX - r.left) / r.width) * total - 0.5);
    return plusJours(debut, Math.max(0, Math.min(total - 1, k)));
  };

  voie.append(h("span", { class: "metro-ligne" }));
  voie.append(h("span", { class: "metro-fait", style: `width:${Math.max(0, Math.min(100, centre(d.aujourdhui)))}%` }));

  // Salons (fixes), hachurés.
  for (const s of d.salons) {
    voie.append(h("div", { class: "metro-salon", title: s.nom, style: `left:${pct(s.date_debut)}%;width:${((joursEntre(s.date_debut, s.fin) + 1) / total) * 100}%` }));
  }

  // Fabrication : accolade sous la ligne, bords glissables.
  const fab0 = d.jalons.find((j) => j.type === "fabrication_debut"), fab1 = d.jalons.find((j) => j.type === "fabrication_fin");
  const texteFab = h("span", { class: "metro-fab-texte" });
  const bande = h("div", { class: "metro-fab" + (avertDe(fab1).length ? " alerte" : "") }, texteFab);
  const placerBande = (a, b) => {
    const n = Math.max(0, joursEntre(a, b) + 1);
    bande.style.left = centre(a) + "%";
    bande.style.width = Math.max(0, centre(b) - centre(a)) + "%";
    texteFab.textContent = `Production · ${n} jour${n > 1 ? "s" : ""}`;
  };
  placerBande(fab0.date, fab1.date);
  for (const [j, cote] of [[fab0, "g"], [fab1, "d"]]) bande.append(poignee(j, cote));
  voie.append(bande);

  // Étiquettes : jalons (hors fabrication) et noms de salons. Placement au-dessus/en dessous, par rangées.
  const largeurPx = Math.max(680, (document.getElementById("page").clientWidth || 900) - 140);
  const items = [
    ...d.jalons.filter((j) => !j.type.startsWith("fabrication")).map((j) => ({ j, x: centre(j.date), titre: j.nom,
      sous: fmtDate(j.date) + (j.type === "comptage" && d.comptage?.total && !j.fait ? ` · ${d.comptage.comptes}/${d.comptage.total} comptés` + (d.comptage.depuis_salon ? ` depuis ${d.comptage.depuis_salon}` : "") : "") })),
    ...d.salons.map((s) => ({ salon: s, x: pct(s.date_debut) + ((joursEntre(s.date_debut, s.fin) + 1) / total) * 50, titre: s.nom, sous: s.date_debut === s.fin ? fmtDate(s.date_debut) : `${fmtDate(s.date_debut)} → ${fmtDate(s.fin)}` })),
  ].sort((a, b) => a.x - b.x);
  const rangees = { h: [], b: [] };
  for (const it of items) {
    const w = ((Math.max(it.titre.length, it.sous.length) * 7.2 + 16) / largeurPx) * 100;
    it.align = it.x < 7 ? "g" : it.x > 93 ? "d" : "";
    const x0 = it.align === "g" ? it.x - 1 : it.align === "d" ? it.x - w : it.x - w / 2;
    const x1 = x0 + w + 1;
    for (let k = 0; ; k++) {
      const cote = k % 2 === 0 ? "h" : "b", r = Math.floor(k / 2);
      const occ = (rangees[cote][r] ||= []);
      if (occ.every(([a, b]) => x1 < a || x0 > b)) { occ.push([x0, x1]); it.cote = cote; it.rang = r; break; }
    }
  }
  const nh = rangees.h.length, nb = rangees.b.length;
  const HAUT0 = 30, BAS0 = 52, PAS = 40;
  const y = nh ? HAUT0 + (nh - 1) * PAS + 40 : 24;
  const basAjd = BAS0 + nb * PAS;
  frise.style.setProperty("--y", y + "px");
  frise.style.setProperty("--h", y + basAjd + 22 + 26 + "px");

  const tige = (it) => (it.cote === "h" ? HAUT0 + it.rang * PAS : BAS0 + it.rang * PAS);
  const etiquette = (it) => {
    const t = tige(it);
    return [
      h("span", { class: "metro-tige", style: it.cote === "h" ? `bottom:0;height:${t}px` : `top:0;height:${t}px` }),
      h("span", { class: "metro-lab " + it.align, style: it.cote === "h" ? `bottom:${t + 2}px` : `top:${t + 2}px` }, h("b", {}, it.titre), h("small", {}, it.sous)),
    ];
  };
  for (const it of items.filter((x) => x.salon)) voie.append(h("div", { class: "metro-nom", style: `left:${it.x}%` }, ...etiquette(it)));
  for (const it of items.filter((x) => x.j)) voie.append(marqueur(it));

  // Aujourd'hui : point qui avance, trait pointillé jusqu'en bas.
  voie.append(h("div", { class: "metro-ajd", style: `left:${centre(d.aujourdhui)}%` },
    h("span", { class: "metro-tige", style: `height:${basAjd}px` }), h("span", { class: "metro-pt" }),
    h("span", { class: "metro-lab", style: `top:${basAjd + 2}px` }, "Aujourd'hui · " + fmtDate(d.aujourdhui))));
  frise.append(voie);

  // Semaines (lundis) sur l'axe du bas.
  const axe = h("div", { class: "metro-axe" });
  for (let i = 0; i < total; i++) {
    const jour = plusJours(debut, i);
    if (new Date(jour + "T00:00:00Z").getUTCDay() === 1) axe.append(h("span", { style: `left:${centre(jour)}%` }, fmtDate(jour)));
  }
  frise.append(axe);

  function poignee(j, cote) {
    const el = h("span", { class: "poignee poignee-" + cote, title: `${j.nom} : ${fmtDate(j.date)} (glisser pour déplacer)` });
    brancherGlisser(el, j, (date) => (j === fab0 ? placerBande(date, fab1.date) : placerBande(fab0.date, date)));
    return el;
  }

  function marqueur(it) {
    const j = it.j;
    const alerte = avertDe(j).length && !j.fait;
    const el = h("div", { class: "metro-jalon" + (j.fait ? " fait" : "") + (alerte ? " alerte" : "") + (etat.jalonChoisi === (j.id ?? j.type) ? " choisi" : ""), style: `left:${it.x}%` },
      ...etiquette(it), h("span", { class: "metro-pt", title: j.fait ? "fait" : alerte ? "à vérifier" : "" }));
    brancherGlisser(el, j, (date) => { el.style.left = centre(date) + "%"; el.querySelector("small").textContent = fmtDate(date); });
    return el;
  }

  // Glisser : la date suit la souris au jour près ; un simple clic ouvre le détail du jalon.
  function brancherGlisser(el, j, apercu) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX; let date = j.date, bouge = false;
      const peutGlisser = glisserPossible();
      if (peutGlisser) el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!peutGlisser) return;
        if (Math.abs(ev.clientX - x0) > 3) bouge = true;
        if (!bouge) return;
        date = dateDepuis(ev.clientX);
        apercu(date);
      };
      const up = () => {
        el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        if (!bouge) { etat.jalonChoisi = j.id ?? j.type; dessinerAccueil(); return; }
        if (date === j.date) return;
        tenter(async () => { await deplacerJalon(j, date); etat.jalonChoisi = j.id ?? j.type; await pageAccueil(); });
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
  }

  // Détail du jalon choisi.
  const choisi = d.jalons.find((j) => (j.id ?? j.type) === etat.jalonChoisi);
  let detail = null;
  if (choisi) {
    const prep = d.preparation.id;
    const champDate = h("input", { type: "date", value: choisi.date, "aria-label": "Date", onchange: (e) => tenter(async () => { if (e.target.value) { await deplacerJalon(choisi, e.target.value); await pageAccueil(); } }) });
    detail = h("div", { class: "detail-jalon" },
      h("strong", {}, choisi.nom), champDate,
      choisi.fait_auto ? h("span", { class: "note" }, "✓ fait (constaté par l'outil)")
        : h("label", { class: "ligne-editeur" }, h("input", { type: "checkbox", checked: choisi.fait, onchange: (e) => tenter(async () => {
            if (choisi.type === "perso") await api("/jalons/" + choisi.id, { method: "PATCH", body: { fait: e.target.checked } });
            else await api("/jalons/standard", { method: "PUT", body: { salon_id: prep, type: choisi.type, date: choisi.date, fait: e.target.checked } });
            await pageAccueil();
          }) }), "fait"),
      choisi.type !== "perso" && choisi.deplace ? h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        await api("/jalons/standard", { method: "PUT", body: { salon_id: prep, type: choisi.type, date: null } }); await pageAccueil();
      }) }, "Revenir à la date proposée") : null,
      choisi.type === "perso" ? h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        if (!confirm(`Supprimer « ${choisi.nom} » ?`)) return;
        await api("/jalons/" + choisi.id, { method: "DELETE" }); etat.jalonChoisi = null; await pageAccueil();
      }) }, "Supprimer") : null,
      lienJalon(choisi.type),
      h("button", { class: "btn-petit", onclick: () => { etat.jalonChoisi = null; dessinerAccueil(); } }, "Fermer"));
  }

  // Ajouter un jalon à la main.
  const nomNouveau = h("input", { placeholder: "ex. Imprimer les prints", "aria-label": "Nom du jalon" });
  const dateNouveau = h("input", { type: "date", value: plusJours(d.aujourdhui, 7), "aria-label": "Date du jalon" });
  const ajout = h("form", { class: "ligne-editeur", onsubmit: (e) => { e.preventDefault(); tenter(async () => {
    await api("/jalons", { method: "POST", body: { salon_id: d.preparation.id, nom: nomNouveau.value, date: dateNouveau.value } });
    flash("Jalon ajouté."); await pageAccueil();
  }); } }, nomNouveau, dateNouveau, h("button", { class: "btn-sec" }, "+ Ajouter un jalon"));

  const tuile = (titre, valeur, sous, lien) => h("a", { class: "tuile tuile-lien", href: lien }, h("span", { class: "note" }, titre), h("strong", {}, valeur), h("span", { class: "note", style: "font-size:13px" }, sous));
  const f = d.production, fo = d.fournitures;
  const tuiles = h("div", { class: "tuiles" },
    tuile("À produire", f.a_produire ? String(f.a_produire) : "rien", f.lignes ? `${f.faites} / ${f.lignes} fait${f.faites > 1 ? "s" : ""}` : "décidez dans Préparation", "#preparation"),
    tuile("Fournitures", fo.a_verifier ? `${fo.a_verifier} à vérifier` : fo.a_commander ? `${fo.a_commander} à commander` : "rien en attente", fo.total ? `${fo.total} pour cette préparation` : "—", "#preparation"),
    tuileSeuil(d.sous_seuil),
    tuile("Questions", String(d.questions), "noms de caisse, ventes impossibles…", "#questions"));

  const liste = h("ol", { class: "liste-jalons" }, [...d.jalons].sort((a, b) => a.date.localeCompare(b.date)).map((j) =>
    h("li", { class: (j.fait ? "fait" : "") + (avertDe(j).length && !j.fait ? " alerte" : "") },
      h("span", { class: "note" }, fmtDate(j.date)), " ", (j.fait ? "✓ " : "") + j.nom)));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" },
    h("section", { class: "carte" },
      h("div", { class: "tete-article" },
        h("div", {}, h("h2", { style: "padding:0" }, "On prépare : " + d.salons.map((s) => s.nom).join(" + ")),
          h("div", { class: "note" }, `Premier jour le ${fmtDateLongue(premier.date_debut)} · ${jAvant > 0 ? `dans ${jAvant} jour${jAvant > 1 ? "s" : ""}` : "c'est maintenant"}`)),
        h("span", { class: "note", style: "font-size:13px" }, glisserPossible() ? "Glissez les jalons pour les déplacer · clic = détail" : "Touchez un jalon pour le modifier")),
      h("div", { class: "frise-cadre" }, frise),
      detail,
      d.avertissements.length ? h("div", { class: "alerte-pleine", style: "margin:0 14px 14px" }, d.avertissements.map((a) => h("div", {}, a.texte))) : null,
      h("div", { style: "padding:0 14px 14px;display:flex;flex-direction:column;gap:10px" }, liste, ajout)),
    tuiles));
}

// Fournitures sous leur seuil d'alerte (réglage « Achat » de la fourniture), même hors préparation.
function tuileSeuil(liste) {
  if (!liste || !liste.length) return null;
  return h("a", { class: "tuile tuile-lien", href: "#stock" }, h("span", { class: "note" }, "Sous le seuil d'alerte"), h("strong", {}, `${liste.length} fourniture${liste.length > 1 ? "s" : ""}`),
    h("span", { class: "note", style: "font-size:13px" }, liste.map((x) => `${x.nom} (${x.stock})`).join(", ") + " : à vérifier"));
}

function lienJalon(type) {
  const liens = { objectifs: ["#preparation", "Ouvrir la préparation"], commandes: ["#preparation", "Ouvrir la préparation"],
    fabrication_debut: ["#preparation", "Ouvrir la préparation"], fabrication_fin: ["#preparation", "Ouvrir la préparation"],
    comptage: ["#stock/avant/" + etat.accueil.preparation.id, "Faire le comptage avant"], bilan: ["#bilan/" + etat.accueil.salons[0].id, "Ouvrir le bilan"] };
  const l = liens[type];
  return l ? h("a", { href: l[0], class: "btn-petit", style: "display:inline-flex;align-items:center;text-decoration:none" }, l[1]) : null;
}

// Nouvelle version en ligne alors que la page est restée ouverte : on propose de recharger.
let versionChargee = null;
async function verifierVersion() {
  try {
    const { version } = await api("/version");
    if (versionChargee === null) { versionChargee = version; return; }
    if (version !== versionChargee && !document.getElementById("nouvelle-version"))
      document.body.append(h("div", { id: "nouvelle-version", class: "nouvelle-version", role: "status" },
        "Une nouvelle version de l'outil est en ligne. ", (etat.comptage || comptageGarde()) ? "Votre comptage en cours est gardé. " : "",
        h("button", { class: "btn", onclick: () => location.reload() }, "Recharger")));
  } catch {}
}
verifierVersion();
setInterval(verifierVersion, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifierVersion(); });

window.addEventListener("hashchange", () => {
  verifierVersion();
  Object.assign(etat, { recetteEdit: null, travail: null, ingChoisi: null, palQ: "", menuLigne: null, jalonChoisi: null, achatAction: null, achatEdition: null, corrEdition: null, comptage: null, ligneEnCours: null, edition: null, editeur: null, fait: null, salonEdition: null, comptageAvant: null });
  afficher();
});
afficher();
