// Interface ordinateur. Aucun framework : petites fonctions qui construisent le DOM.

const NIVEAUX = { a_vendre: "À vendre", fait_maison: "Fourniture maison", achete: "Fourniture achetée", recup: "Récup" };
const SUIVIS = {
  quantite: "Compté à la pièce",
  sans_quantite: "Sans quantité (ex. peinture)",
};
const PAGES = [
  { id: "accueil", label: "Accueil" },
  { id: "stock", label: "Stock" },
  { id: "atelier", label: "Atelier" },
  { id: "achats", label: "À acheter" },
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
  for (const e of enfants.flat()) if (e !== null && e !== undefined && e !== false) el.append(e instanceof Node ? e : String(e));
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
  page: "stock", filtre: null, comptage: null, ligneEnCours: null, stock: [], familles: [], edition: null,
  etapes: [], editeur: null, fait: null, faites: [],
  questions: [], nbQuestions: null, import: null, correspondances: [], corrEdition: null,
  params: [], salons: null, salonEdition: null, objectifs: null, plan: null, comptageAvant: null,
};

// Adresses : #stock, #stock/avant/<salon>, #atelier, #salons, #objectifs/<préparation>, #reglages
function pageCourante() {
  const [id, ...params] = location.hash.replace("#", "").split("/");
  etat.params = params;
  if (id === "objectifs" && params[0]) return "objectifs";
  if (id === "bilan" && params[0]) return "bilan";
  return PAGES.some((p) => p.id === id && !p.bientot) ? id : "accueil";
}

function dessinerMenu() {
  const nav = document.getElementById("nav");
  nav.replaceChildren(
    ...PAGES.map((p) =>
      h("button", {
        "aria-current": etat.page === p.id || ((etat.page === "objectifs" || etat.page === "bilan") && p.id === "salons") ? "page" : null,
        disabled: p.bientot,
        title: p.bientot ? "Pas encore construit" : null,
        onclick: () => { location.hash = p.id; },
      }, p.label, p.bientot ? h("span", { class: "bientot" }, "bientôt") : null,
        p.id === "questions" && etat.nbQuestions ? h("span", { class: "pastille-nb" }, etat.nbQuestions) : null),
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
    if (etat.page === "atelier") await pageAtelier();
    if (etat.page === "salons") await pageSalons();
    if (etat.page === "questions") await pageQuestions();
    if (etat.page === "achats") await pageAchats();
    if (etat.page === "objectifs") await pageObjectifs(Number(etat.params[0]));
    if (etat.page === "bilan") await pageBilan(Number(etat.params[0]));
  });
}

function entete(titre, action) {
  document.getElementById("titre").textContent = titre;
  document.getElementById("action").replaceChildren(...(action ? [action] : []));
}

// ───────────── Stock ─────────────
async function pageStock() {
  etat.stock = await api("/stock");
  // Comptage avant une préparation : #stock/avant/<premier salon>
  if (etat.params[0] === "avant" && etat.params[1] && etat.comptage === null) {
    const salons = await api("/salons");
    const prep = salons.preparations.find((p) => p.id === Number(etat.params[1]));
    if (prep) {
      etat.comptageAvant = { salon_id: prep.id, nom: nomPreparation(prep, salons.salons) };
      etat.comptage = {};
    }
  }
  dessinerStock();
}

function piecesVisibles() {
  return etat.stock.filter((f) => etat.filtre === null || f.id === etat.filtre);
}

function dessinerStock() {
  const enComptage = etat.comptage !== null;
  entete(etat.comptageAvant ? "Comptage avant · " + etat.comptageAvant.nom : "Stock",
    enComptage ? null : h("button", { class: "btn", onclick: demarrerComptage }, "Faire un comptage"));
  const page = document.getElementById("page");

  if (!etat.stock.length) {
    page.replaceChildren(
      h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucune famille pour l'instant. Commencez par ",
        h("a", { href: "#reglages" }, "Réglages"), " pour créer les familles, les articles et les fournitures.")),
    );
    return;
  }

  const filtres = h("div", { class: "filtres" },
    [{ id: null, nom: "Toutes" }, ...etat.stock].map((f) =>
      h("button", {
        class: "pastille-filtre",
        "aria-pressed": String(etat.filtre === f.id),
        disabled: enComptage,
        onclick: () => { etat.filtre = f.id; dessinerStock(); },
      }, f.nom),
    ),
  );

  const legende = h("div", { class: "legende" },
    h("span", {}, h("span", { class: "badge badge-a_vendre" }, "À vendre"), " prêt pour le stand"),
    h("span", {}, h("span", { class: "badge badge-fait_maison" }, "Fourniture maison"), " préparée d'avance, en réserve"),
    h("span", {}, h("span", { class: "badge badge-achete" }, "Fourniture achetée"), " ou récup"),
  );

  const cartes = piecesVisibles().map((f) =>
    h("section", { class: "carte" },
      h("h2", {}, f.nom),
      f.pieces.length
        ? h("table", { class: "tbl tbl-stock" },
            h("colgroup", {}, h("col", { class: "c-badge" }), h("col", {}), h("col", { class: "c-qte" }), h("col", { class: "c-note" }), h("col", { class: "c-action" })),
            h("tbody", {}, lignesFamille(f.pieces)))
        : h("div", { class: "vide" }, "Rien dans cette famille pour l'instant."),
    ),
  );

  const barre = enComptage ? barreComptage() : null;
  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, filtres, legende, ...cartes, barre));
}

// Dans une famille : les articles à vendre d'abord, puis les fournitures (maison, achetées, récup).
function lignesFamille(pieces) {
  const vente = pieces.filter((p) => p.niveau === "a_vendre"), fournitures = pieces.filter((p) => p.niveau !== "a_vendre");
  if (!vente.length || !fournitures.length) return pieces.map(ligneStock);
  const titre = (t) => h("tr", { class: "groupe" }, h("td", { colspan: 5 }, t));
  return [titre("À vendre"), ...vente.map(ligneStock), titre("Fournitures"), ...fournitures.map(ligneStock)];
}

function noteStock(p) {
  const notes = [];
  if (p.fin_de_serie) notes.push("Fin de série");
  if (p.suivi === "sans_quantite") notes.push(p.presque_vide ? "Pot presque vide" : "Sans quantité");
  if (p.suivi === "generique") notes.push("Ventes comptées, pas de stock");
  if (p.suivi === "quantite" && p.stock < 0) notes.push("Négatif : à compter");
  return notes.join(" · ");
}

function ligneStock(p) {
  const comptable = p.suivi === "quantite";
  const qte = comptable ? p.stock : "—";
  let action = null;

  if (etat.comptage !== null && comptable) {
    const saisi = etat.comptage[p.id];
    const ecart = saisi === undefined || saisi === "" ? null : Number(saisi) - p.stock;
    const ecartEl = h("span", { class: "ecart" + (ecart > 0 ? " plus" : "") }, ecart ? signe(ecart) : "");
    action = h("div", { class: "actions-ligne" },
      h("label", { class: "sr", for: "c" + p.id }, "Compté pour " + p.nom),
      h("input", {
        id: "c" + p.id, class: "compte", type: "number", min: "0", step: "1", inputmode: "numeric",
        placeholder: String(p.stock), value: saisi ?? "",
        oninput: (e) => {
          etat.comptage[p.id] = e.target.value;
          const d = e.target.value === "" ? 0 : Number(e.target.value) - p.stock;
          ecartEl.textContent = d ? signe(d) : "";
          ecartEl.className = "ecart" + (d > 0 ? " plus" : "");
          majBarreComptage();
        },
      }),
      ecartEl,
    );
  } else if (etat.ligneEnCours === p.id) {
    const input = h("input", { id: "l" + p.id, class: "compte", type: "number", min: "0", step: "1", inputmode: "numeric", placeholder: String(p.stock) });
    const valider = () => tenter(async () => {
      if (input.value === "") return;
      await enregistrerComptage([{ piece_id: p.id, compte: Number(input.value) }]);
      etat.ligneEnCours = null;
      await pageStock();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") valider(); if (e.key === "Escape") { etat.ligneEnCours = null; dessinerStock(); } });
    action = h("div", { class: "actions-ligne" },
      h("label", { class: "sr", for: "l" + p.id }, "Combien de " + p.nom + " en avez-vous vraiment ?"),
      input,
      h("button", { class: "btn-petit", onclick: valider }, "OK"),
      h("button", { class: "btn-petit", onclick: () => { etat.ligneEnCours = null; dessinerStock(); } }, "Annuler"),
    );
    queueMicrotask(() => input.focus());
  } else if (comptable && etat.comptage === null) {
    action = h("div", { class: "actions-ligne" },
      h("button", { class: "btn-petit", onclick: () => { etat.ligneEnCours = p.id; dessinerStock(); } }, "Compter"));
  } else if (p.suivi === "sans_quantite" && etat.comptage === null) {
    action = h("div", { class: "actions-ligne" },
      h("button", {
        class: "btn-petit",
        onclick: () => tenter(async () => {
          await api("/pieces/" + p.id, { method: "PATCH", body: { presque_vide: !p.presque_vide } });
          await pageStock();
        }),
      }, p.presque_vide ? "Pot remplacé" : "Pot presque vide"));
  }

  return h("tr", {},
    h("td", { class: "col-badge" }, h("span", { class: "badge badge-" + p.niveau }, NIVEAUX[p.niveau])),
    h("td", { style: "font-weight:600" }, p.nom),
    h("td", { class: "num qte" + (comptable && p.stock < 0 ? " neg" : comptable && p.stock === 0 ? " zero" : "") }, qte),
    h("td", { class: "note" }, noteStock(p)),
    h("td", { class: "col-action" }, action),
  );
}

function lignesSaisies() {
  return Object.entries(etat.comptage || {})
    .filter(([, v]) => v !== "")
    .map(([id, v]) => ({ piece_id: Number(id), compte: Number(v) }));
}

function nbEcarts() {
  const stocks = new Map(etat.stock.flatMap((f) => f.pieces).map((p) => [p.id, p.stock]));
  return lignesSaisies().filter((l) => l.compte !== stocks.get(l.piece_id)).length;
}

function barreComptage() {
  return h("div", { class: "barre-comptage", id: "barre-comptage" },
    h("span", { id: "nb-ecarts" }, texteEcarts()),
    h("button", { class: "btn-sec", onclick: () => { etat.comptage = null; if (etat.comptageAvant) { etat.comptageAvant = null; location.hash = "salons"; } else dessinerStock(); } }, "Annuler"),
    h("button", { class: "btn", onclick: () => tenter(sauverComptage) }, "Enregistrer le comptage"),
  );
}

function texteEcarts() {
  const n = lignesSaisies().length, e = nbEcarts();
  return `${n} ligne(s) comptée(s) · ${e} écart(s) · les cases vides ne sont pas comptées`;
}

function majBarreComptage() {
  const el = document.getElementById("nb-ecarts");
  if (el) el.textContent = texteEcarts();
}

function demarrerComptage() {
  etat.comptage = {};
  etat.ligneEnCours = null;
  dessinerStock();
}

async function enregistrerComptage(lignes, avant = null) {
  if (lignes.some((l) => !Number.isInteger(l.compte) || l.compte < 0)) throw new Error("Les quantités comptées doivent être des nombres entiers, 0 ou plus.");
  const r = await api("/comptages", { method: "POST", body: avant ? { lignes, type: "avant", salon_id: avant.salon_id } : { lignes } });
  flash(r.ecarts ? `Comptage enregistré : ${r.ecarts} chiffre(s) corrigé(s).` : "Comptage enregistré : tout était juste.");
  return r;
}

async function sauverComptage() {
  const lignes = lignesSaisies();
  if (!lignes.length) throw new Error("Aucune quantité saisie.");
  await enregistrerComptage(lignes, etat.comptageAvant);
  etat.comptage = null;
  if (etat.comptageAvant) { etat.comptageAvant = null; location.hash = "salons"; return; }
  await pageStock();
}

// ───────────── Réglages : familles, articles et fournitures ─────────────
async function pageReglages() {
  [etat.familles, etat.stock, etat.etapes, etat.correspondances, etat.reglages] = await Promise.all([api("/familles"), api("/stock"), api("/etapes"), api("/correspondances"), api("/reglages")]);
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

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, sectionThermometre(), familles, pieces, ...sectionsRecettes(), sectionCorrespondances()));
}

// Article thermomètre : ses ventes mesurent le passage devant le stand (Tampon lot = × 4, Collection = × 20).
// Famille thermomètre : ses ventes mesurent le passage devant le stand (Tampon lot = × 4, Collection = × 20).
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
      p.niveau === "achete" ? h("button", { class: "btn-petit", disabled: !!etat.achatEdition, onclick: () => tenter(() => ouvrirReglageAchat(p)) }, "Achat") : null,
      h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        await api("/pieces/" + p.id, { method: "PATCH", body: { fin_de_serie: !p.fin_de_serie } });
        await pageReglages();
      }) }, p.fin_de_serie ? "Remettre en vente" : "Fin de série"))),
  );
}


// ───────────── Recettes (Réglages) ─────────────
const MODES = { par_matiere: "Par matière entière (une plaque, une feuille…)", a_la_piece: "À la pièce" };

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

function resumeEtape(e) {
  const util = e.utilise.length ? e.utilise.map((u) => `${u.quantite} ${u.nom}`).join(" + ") : "rien";
  const donne = e.donne.map((d) => d.au_choix
    ? `${d.quantite} part(s) au choix parmi ${d.choix.map((c) => `${c.nom}${c.poids > 1 ? ` (${c.poids} parts)` : ""}`).join(", ")}`
    : `${d.quantite} ${d.nom}`).join(" + ");
  return `${util} → ${donne}`;
}
function texteTemps(e) {
  if (e.temps_min === null || e.temps_min === undefined) return "temps non renseigné";
  return `${e.temps_min} min ${e.mode === "par_matiere" ? "par matière entière" : "par pièce"}`;
}

function nouvelEditeur(famille_id, e) {
  if (!e) return { id: null, famille_id, nom: "", mode: "a_la_piece", temps_min: "", ordre: 0, utilise: [], donne: [{ au_choix: false, piece_id: null, quantite: 1 }] };
  return {
    id: e.id, famille_id: e.famille_id, nom: e.nom, mode: e.mode, temps_min: e.temps_min ?? "", ordre: e.ordre,
    utilise: e.utilise.map((u) => ({ piece_id: u.piece_id, quantite: u.quantite })),
    donne: e.donne.map((d) => d.au_choix
      ? { au_choix: true, quantite: d.quantite, choix: d.choix.map((c) => ({ piece_id: c.piece_id, poids: c.poids })) }
      : { au_choix: false, piece_id: d.piece_id, quantite: d.quantite }),
  };
}

function sectionsRecettes() {
  return etat.familles.map((f) => {
    const etapes = etat.etapes.filter((e) => e.famille_id === f.id);
    const ed = etat.editeur && etat.editeur.famille_id === f.id ? etat.editeur : null;
    return h("section", { class: "carte" },
      h("h2", {}, "Recette · " + f.nom),
      etapes.length
        ? h("table", { class: "tbl" }, h("tbody", {}, etapes.map((e) => h("tr", {},
            h("td", { style: "font-weight:600;width:200px" }, e.nom),
            h("td", {}, resumeEtape(e), h("div", { class: "note", style: "font-size:13px" }, (e.mode === "par_matiere" ? "Par matière entière" : "À la pièce") + " · " + texteTemps(e))),
            h("td", { class: "col-action" }, h("div", { class: "actions-ligne" },
              h("button", { class: "btn-petit", disabled: !!etat.editeur, onclick: () => { etat.editeur = nouvelEditeur(f.id, e); dessinerReglages(); } }, "Modifier"),
              h("button", { class: "btn-petit", disabled: !!etat.editeur, onclick: () => tenter(async () => {
                if (!confirm(`Supprimer l'étape « ${e.nom} » ?`)) return;
                await api("/etapes/" + e.id, { method: "DELETE" });
                flash("Étape supprimée.");
                await pageReglages();
              }) }, "Supprimer")))))))
        : h("div", { class: "vide" }, "Aucune étape : comment fabrique-t-on les articles de cette famille ?"),
      ed ? editeurEtape(ed) : h("div", { class: "formulaire" },
        h("button", { class: "btn-sec", disabled: !!etat.editeur || !toutesPieces().length, onclick: () => { etat.editeur = nouvelEditeur(f.id); dessinerReglages(); } }, "Ajouter une étape")),
    );
  });
}

function editeurEtape(ed) {
  const redessiner = () => dessinerReglages();
  const ligneQte = (obj, cle, label, min = 1) => h("input", {
    type: "number", min: String(min), step: "1", class: "compte", "aria-label": label, value: String(obj[cle]),
    oninput: (e) => { obj[cle] = e.target.value; },
  });
  const retirer = (liste, i) => h("button", { type: "button", class: "btn-petit", onclick: () => { liste.splice(i, 1); redessiner(); } }, "Retirer");

  const utilise = h("div", { class: "bloc-editeur" },
    h("strong", {}, "Utilise"),
    ed.utilise.length ? null : h("div", { class: "note" }, "Rien (ex. une étape qui ne consomme aucune fourniture suivie)."),
    ed.utilise.map((u, i) => h("div", { class: "ligne-editeur" },
      selectPiece(u.piece_id, (v) => { u.piece_id = v; }, "Ce qu'elle utilise"), ligneQte(u, "quantite", "Quantité utilisée"), retirer(ed.utilise, i))),
    h("button", { type: "button", class: "btn-petit", onclick: () => { ed.utilise.push({ piece_id: null, quantite: 1 }); redessiner(); } }, "+ ce qu'elle utilise"),
  );

  const donne = h("div", { class: "bloc-editeur" },
    h("strong", {}, "Donne"),
    ed.donne.map((d, i) => d.au_choix
      ? h("div", { class: "choix-editeur" },
          h("div", { class: "ligne-editeur" },
            h("span", {}, "Au choix, capacité"), ligneQte(d, "quantite", "Capacité (parts)"), h("span", { class: "note" }, "part(s)"), retirer(ed.donne, i)),
          d.choix.map((c, j) => h("div", { class: "ligne-editeur" },
            selectPiece(c.piece_id, (v) => { c.piece_id = v; }, "Au choix"),
            ligneQte(c, "poids", "Parts prises"), h("span", { class: "note" }, "part(s)"), retirer(d.choix, j))),
          h("button", { type: "button", class: "btn-petit", onclick: () => { d.choix.push({ piece_id: null, poids: 1 }); redessiner(); } }, "+ une possibilité"))
      : h("div", { class: "ligne-editeur" },
          selectPiece(d.piece_id, (v) => { d.piece_id = v; }, "Ce qu'elle donne"), ligneQte(d, "quantite", "Quantité donnée"), retirer(ed.donne, i))),
    h("div", { class: "ligne-editeur" },
      h("button", { type: "button", class: "btn-petit", onclick: () => { ed.donne.push({ au_choix: false, piece_id: null, quantite: 1 }); redessiner(); } }, "+ ce qu'elle donne"),
      h("button", { type: "button", class: "btn-petit", onclick: () => { ed.donne.push({ au_choix: true, quantite: 4, choix: [{ piece_id: null, poids: 1 }, { piece_id: null, poids: 1 }] }); redessiner(); } }, "+ sortie au choix (ex. prints)")),
  );

  const nom = h("input", { id: "ed-nom", value: ed.nom, placeholder: "ex. Peindre et découper", oninput: (e) => { ed.nom = e.target.value; } });
  const mode = h("select", { id: "ed-mode", onchange: (e) => { ed.mode = e.target.value; redessiner(); } },
    Object.entries(MODES).map(([k, v]) => h("option", { value: k, selected: ed.mode === k }, v)));
  const temps = h("input", { id: "ed-temps", type: "number", min: "0", step: "any", value: String(ed.temps_min), style: "width:110px", oninput: (e) => { ed.temps_min = e.target.value; } });

  const enregistrer = () => tenter(async () => {
    const corps = {
      famille_id: ed.famille_id, nom: ed.nom, mode: ed.mode, temps_min: ed.temps_min === "" ? null : Number(ed.temps_min), ordre: ed.ordre,
      utilise: ed.utilise.map((u) => ({ piece_id: u.piece_id, quantite: Number(u.quantite) })),
      donne: ed.donne.map((d) => d.au_choix
        ? { au_choix: true, quantite: Number(d.quantite), choix: d.choix.map((c) => ({ piece_id: c.piece_id, poids: Number(c.poids) })) }
        : { piece_id: d.piece_id, quantite: Number(d.quantite) }),
    };
    if ([...corps.utilise, ...corps.donne.filter((d) => !d.au_choix), ...corps.donne.flatMap((d) => d.choix ?? [])].some((x) => !x.piece_id))
      throw new Error("Choisissez sur chaque ligne (ou retirez la ligne).");
    await api(ed.id ? "/etapes/" + ed.id : "/etapes", { method: ed.id ? "PUT" : "POST", body: corps });
    etat.editeur = null;
    flash(ed.id ? "Étape modifiée. Ce qui a déjà été fait reste tel quel dans l'historique." : "Étape ajoutée.");
    await pageReglages();
  });

  return h("div", { class: "editeur" },
    h("div", { class: "formulaire", style: "padding:0" },
      h("label", { for: "ed-nom" }, "Nom de l'étape", nom),
      h("label", { for: "ed-mode" }, "Se fait", mode),
      h("label", { for: "ed-temps" }, ed.mode === "par_matiere" ? "Temps par matière entière (min)" : "Temps par pièce (min)", temps)),
    h("p", { class: "note", style: "margin:0;font-size:13px" }, ed.mode === "par_matiere"
      ? "Quantités pour UNE matière entière (une plaque, une feuille). Le rendement indiqué est une valeur de départ : la quantité réellement obtenue se déclare à « C'est fait »."
      : "Quantités pour UNE unité faite."),
    utilise, donne,
    h("div", { class: "barre-comptage" },
      h("button", { class: "btn-sec", onclick: () => { etat.editeur = null; dessinerReglages(); } }, "Annuler"),
      h("button", { class: "btn", onclick: enregistrer }, "Enregistrer l'étape")),
  );
}

// ───────────── Atelier ─────────────
async function pageAtelier() {
  [etat.plan, etat.etapes, etat.stock, etat.faites] = await Promise.all([api("/atelier"), api("/etapes"), api("/stock"), api("/etapes-faites")]);
  dessinerAtelier();
}

function stockDe(id) {
  return toutesPieces().find((p) => p.id === id)?.stock ?? 0;
}

function ouvrirFait(cle, e, pre = {}) {
  etat.fait = { cle, etape_id: e.id, fois: String(pre.fois ?? 1), donne: { ...(pre.donne ?? {}) }, touche: new Set(), manque: null, comptages: {} };
  dessinerAtelier();
}

function dessinerAtelier() {
  entete("Atelier");
  const page = document.getElementById("page");
  const plan = etat.plan;
  const blocs = [];

  if (!plan || !plan.preparation) {
    blocs.push(h("div", { class: "carte" }, h("div", { class: "vide" },
      "Aucun salon à venir. Ajoutez le prochain salon dans ", h("a", { href: "#salons" }, "Salons"), " et fixez ses objectifs : l'Atelier dira quoi faire, dans l'ordre.")));
  } else {
    const premier = plan.salons[0];
    const j = joursEntre(new Date().toISOString().slice(0, 10), premier.date_debut);
    const nom = plan.salons.map((s) => s.nom).join(" + ");
    const temps = plan.travail_min ? "≈ " + dureeTexte(plan.travail_min) : "—";
    blocs.push(h("section", { class: "bandeau" },
      h("div", {}, h("span", { class: "note" }, "On prépare"), h("strong", {}, nom)),
      h("div", {}, h("span", { class: "note" }, "Tout prêt avant"), h("strong", {}, `le ${fmtDate(premier.date_debut)} · ${j > 0 ? `dans ${j} jour${j > 1 ? "s" : ""}` : "c'est maintenant"}`)),
      h("div", {}, h("span", { class: "note" }, "Travail restant"), h("strong", {}, temps),
        h("span", { class: "note", style: "font-size:12px" }, "en ne comptant que ce qu'il reste à faire" + (plan.etapes_sans_temps ? ` · ${plan.etapes_sans_temps} étape(s) sans temps renseigné` : "")))));

    if (plan.problemes.length) blocs.push(h("div", { class: "question" }, h("strong", {}, "À régler"), plan.problemes.map((p) => h("div", {}, p))));

    const aFaire = plan.articles.filter((a) => a.manque > 0);
    const prets = plan.articles.filter((a) => a.manque === 0);
    if (!plan.articles.length) {
      blocs.push(h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucun objectif pour cette préparation. ",
        h("a", { href: "#objectifs/" + plan.preparation.id }, "Fixer les objectifs"), ".")));
    } else {
      blocs.push(h("p", { class: "note", style: "margin:0" },
        "Pour chaque article, l'outil part de ce qui est déjà en fourniture maison et ne propose de refaire une étape que si la réserve ne suffit pas. Les étapes sont numérotées dans l'ordre où les faire."));
      blocs.push(...aFaire.map(carteArticle));
      if (prets.length) blocs.push(h("div", { class: "note" }, h("strong", {}, "Déjà prêt : "), prets.map((a) => `${a.nom} (${a.prets}/${a.a_avoir})`).join(", ")));
      if (plan.a_acheter.length) blocs.push(h("section", { class: "carte" }, h("h2", {}, "Il manque des fournitures"),
        h("table", { class: "tbl" }, h("tbody", {}, plan.a_acheter.map((x) => h("tr", {}, h("td", { style: "font-weight:600" }, x.nom), h("td", { class: "num qte" }, x.manque)))))));
    }
  }

  // Toutes les étapes : pour noter ce qui a été fait hors plan.
  const toutes = h("details", { class: "carte", open: !plan?.preparation || !etat.plan?.articles?.length ? true : null },
    h("summary", { class: "resume-details" }, "Toutes les étapes (pour noter un travail fait hors de cette liste)"),
    etat.etapes.length
      ? etat.stock.filter((f) => etat.etapes.some((e) => e.famille_id === f.id)).map((f) =>
          h("div", {}, h("h3", { class: "sous-titre" }, f.nom), h("div", { class: "liste-etapes" }, etat.etapes.filter((e) => e.famille_id === f.id).map((e) => carteEtape(e)))))
      : h("div", { class: "vide" }, "Aucune recette. Décrivez les étapes dans ", h("a", { href: "#reglages" }, "Réglages"), "."));
  blocs.push(toutes);

  if (etat.faites.length) blocs.push(h("section", { class: "carte" }, h("h2", {}, "Dernières saisies"),
    h("table", { class: "tbl" }, h("tbody", {}, etat.faites.map((x) => h("tr", {},
      h("td", {}, new Date(x.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })),
      h("td", { style: "font-weight:600" }, x.nom), h("td", { class: "num" }, "× " + x.fois),
      h("td", { class: "col-action" }, h("div", { class: "actions-ligne" }, h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        if (!confirm(`Annuler la saisie « ${x.nom} × ${x.fois} » ? Ce qui a été utilisé revient en stock, ce qui a été obtenu est retiré.`)) return;
        await api("/etapes-faites/" + x.id, { method: "DELETE" });
        flash("Saisie annulée.");
        await pageAtelier();
      }) }, "Annuler cette saisie")))))))));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, ...blocs));
}

function carteArticle(a) {
  const plan = etat.plan;
  const split = a.par_salon.filter((x) => x.retenu).map((x) => `${x.retenu} à ${plan.salons.find((s) => s.id === x.salon_id)?.nom}`).join(", ");
  const travaux = plan.travaux.filter((t) => t.sert.includes(a.piece_id));
  const reserve = travaux.flatMap((t) => t.donne.filter((g) => g.reserve > 0).map((g) => `${g.reserve} ${g.nom}`));
  return h("section", { class: "carte" },
    h("div", { class: "tete-article" },
      h("div", {}, h("h2", { style: "padding:0" }, a.nom), h("div", { class: "note" }, `objectif ${a.a_avoir}${split ? ` (${split} + marge)` : ""} · ${a.prets} prêt${a.prets > 1 ? "s" : ""}`)),
      h("div", { class: "manque" }, "il en manque ", h("strong", {}, a.manque))),
    reserve.length ? h("div", { class: "note", style: "padding:0 14px 6px" }, "Partira en réserve (fourniture maison) : " + reserve.join(", ")) : null,
    travaux.length
      ? h("div", { class: "liste-etapes" }, travaux.map((t) => etapePlan(t, a)))
      : h("div", { class: "vide" }, "Aucune étape ne fabrique cet article : décrivez-la dans Réglages."));
}

function etapePlan(t, a) {
  const e = etat.etapes.find((x) => x.id === t.etape_id);
  const cle = `${a.piece_id}:${t.etape_id}`;
  const enCours = etat.fait && etat.fait.cle === cle;
  const autres = t.sert.filter((id) => id !== a.piece_id).map((id) => etat.plan.articles.find((x) => x.piece_id === id)?.nom).filter(Boolean);
  const donne = t.donne.map((g) => `${g.quantite} ${g.nom}` + (g.reserve > 0 ? ` (dont ${g.reserve} en réserve)` : "")).join(", ")
    + (t.parts_libres ? ` · ${t.parts_libres} part(s) libre(s), au choix` : "");
  const entrees = t.entrees.map((x) => {
    if (x.sans_quantite) return h("li", { class: x.presque_vide ? "manque-txt" : "" }, x.presque_vide ? `⚠ ${x.nom} : pot presque vide` : `✓ ${x.nom}`);
    if (x.manque > 0) return h("li", { class: "manque-txt" }, `⚠ ${x.besoin} ${x.nom} : il en manque ${x.manque} → à acheter`);
    if (x.fait_avant > 0) return h("li", {}, `↑ ${x.besoin} ${x.nom}` + (x.en_stock ? ` (${x.en_stock} en stock + ${x.fait_avant} faits juste avant)` : " : faits juste avant"));
    return h("li", {}, `✓ ${x.besoin} ${x.nom} en stock`);
  });
  const pre = { fois: t.fois, donne: Object.fromEntries(e?.donne.some((d) => d.au_choix) ? t.donne.map((g) => [g.piece_id, String(g.quantite)]) : []) };
  return h("div", { class: "etape" },
    h("div", { class: "etape-tete" },
      h("div", {}, h("span", { class: "numero" }, t.numero), " ",
        h("strong", {}, `${e?.nom ?? "?"} × ${t.fois}`), h("span", { class: "note" }, e?.mode === "par_matiere" ? " (matières entières)" : ""),
        h("div", { class: "note", style: "font-size:13px" }, "donne " + donne + (autres.length ? ` · sert aussi à : ${autres.join(", ")}` : ""))),
      h("div", { class: "actions-ligne" },
        h("span", { class: "note" }, t.temps_min === null ? "temps ?" : dureeTexte(t.temps_min)),
        enCours || !e ? null : h("button", { class: "btn-sec", disabled: !!etat.fait, onclick: () => ouvrirFait(cle, e, pre) }, "C'est fait…"))),
    entrees.length ? h("ul", { class: "entrees" }, entrees) : null,
    enCours ? panneauFait(e) : null);
}

function carteEtape(e) {
  const cle = "toutes:" + e.id;
  const utilise = e.utilise.map((u) => u.suivi === "quantite"
    ? h("li", {}, `${u.quantite} ${u.nom}`, h("span", { class: "note" }, ` · en stock : ${stockDe(u.piece_id)}`))
    : h("li", {}, `${u.nom}`, h("span", { class: "note" }, " · sans quantité")));
  const enCours = etat.fait && etat.fait.cle === cle;
  return h("div", { class: "etape" },
    h("div", { class: "etape-tete" },
      h("div", {}, h("strong", {}, e.nom), h("div", { class: "note", style: "font-size:13px" }, (e.mode === "par_matiere" ? "Par matière entière" : "À la pièce") + " · " + texteTemps(e))),
      enCours ? null : h("button", { class: "btn-sec", disabled: !!etat.fait, onclick: () => ouvrirFait(cle, e) }, "C'est fait…")),
    h("div", { class: "etape-corps" },
      h("div", {}, h("div", { class: "note" }, "Utilise"), utilise.length ? h("ul", {}, utilise) : h("div", {}, "rien")),
      h("div", {}, h("div", { class: "note" }, "Donne"), h("ul", {}, e.donne.map((d) => d.au_choix
        ? h("li", {}, `${d.quantite} part(s) au choix : ${d.choix.map((c) => c.nom).join(", ")}`)
        : h("li", {}, `${d.quantite} ${d.nom}`, h("span", { class: "note" }, ` · en stock : ${stockDe(d.piece_id)}`)))))),
    enCours ? panneauFait(e) : null,
  );
}

function prevuSimple(e, d, fois) { return d.quantite * (Number(fois) || 0); }

function panneauFait(e) {
  const f = etat.fait;
  const majs = []; // mises à jour sur place quand le nombre change (pas de redessin : il ferait perdre un clic)
  const fois = () => Number(f.fois) || 0;
  const sorties = [];
  for (const d of e.donne) {
    if (!d.au_choix) {
      if (e.mode === "par_matiere") {
        const input = h("input", { type: "number", min: "0", step: "1", class: "compte",
          oninput: (ev) => { f.donne[d.piece_id] = ev.target.value; f.touche.add(d.piece_id); } });
        const prevu = h("span", { class: "note" });
        majs.push(() => {
          prevu.textContent = `prévu : ${prevuSimple(e, d, fois())}`;
          if (!f.touche.has(d.piece_id)) { f.donne[d.piece_id] = String(prevuSimple(e, d, fois())); input.value = f.donne[d.piece_id]; }
        });
        if (f.touche.has(d.piece_id)) input.value = f.donne[d.piece_id];
        sorties.push(h("label", { class: "ligne-editeur" }, h("span", { style: "min-width:220px" }, `${d.nom} obtenus`), input, prevu));
      } else {
        const t = h("div", {});
        majs.push(() => { t.textContent = `${prevuSimple(e, d, fois())} ${d.nom}`; });
        sorties.push(t);
      }
    } else {
      const parts = h("span", { class: "note" });
      const majParts = () => {
        const capacite = d.quantite * fois();
        const u = d.choix.reduce((t, c) => t + (Number(f.donne[c.piece_id]) || 0) * c.poids, 0);
        parts.textContent = `${u} part(s) sur ${capacite}`;
        parts.style.color = u > capacite ? "var(--alerte)" : "";
      };
      majs.push(majParts);
      sorties.push(h("div", { class: "choix-editeur" },
        h("div", {}, "Qu'est-ce qui est sorti ? ", parts),
        d.choix.map((c) => h("label", { class: "ligne-editeur" }, h("span", { style: "min-width:220px" }, c.nom + (c.poids > 1 ? ` (${c.poids} parts)` : "")),
          h("input", { type: "number", min: "0", step: "1", class: "compte", value: f.donne[c.piece_id] ?? "", placeholder: "0",
            oninput: (ev) => { f.donne[c.piece_id] = ev.target.value; majParts(); } })))));
    }
  }
  const toutMettreAJour = () => majs.forEach((m) => m());
  toutMettreAJour();

  const questions = f.manque ? h("div", { class: "question" },
    h("strong", {}, "Une question avant d'enregistrer"),
    f.manque.map((m) => h("label", { class: "ligne-editeur" },
      h("span", {}, `Selon l'outil il ne restait que ${m.stock} ${m.nom} (il en faut ${m.besoin}). Combien en aviez-vous vraiment ?`),
      h("input", { type: "number", min: "0", step: "1", class: "compte", value: f.comptages[m.piece_id] ?? "",
        oninput: (ev) => { f.comptages[m.piece_id] = ev.target.value; } })))) : null;

  const valider = () => tenter(async () => {
    const fois = Number(f.fois);
    if (!Number.isInteger(fois) || fois < 1) throw new Error("Indiquez un nombre entier, 1 ou plus.");
    const donne = Object.entries(f.donne).filter(([, v]) => v !== "" && v !== undefined).map(([pid, v]) => ({ piece_id: Number(pid), quantite: Number(v) }));
    const comptages = Object.entries(f.comptages).filter(([, v]) => v !== "").map(([pid, v]) => ({ piece_id: Number(pid), compte: Number(v) }));
    const r = await fetch("/api/etapes/" + e.id + "/faite", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fois, donne: e.mode === "par_matiere" || e.donne.some((d) => d.au_choix) ? donne : undefined, comptages }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 && data.manque) {
      const avant = f.manque;
      f.manque = data.manque;
      dessinerAtelier();
      if (avant && comptages.length) flash("Même avec ces chiffres, il n'y en a pas assez pour cette quantité. Vérifiez le nombre de fois ou le comptage.", true);
      return;
    }
    if (!r.ok) throw new Error(data.erreur || "Le serveur n'a pas répondu correctement.");
    etat.fait = null;
    flash("C'est noté : " + data.sorties.map((s) => `+${s.quantite} ${nomPiece(s.piece_id)}`).join(", ") + ".");
    await pageAtelier();
  });

  return h("div", { class: "panneau-fait" },
    h("label", { class: "ligne-editeur" },
      h("span", { style: "min-width:220px;font-weight:600" }, e.mode === "par_matiere" ? "Combien de matières entières (plaques, feuilles) ?" : "Combien en avez-vous fait ?"),
      h("input", { type: "number", min: "1", step: "1", class: "compte", value: f.fois, oninput: (ev) => { f.fois = ev.target.value; toutMettreAJour(); } })),
    sorties, questions,
    h("div", { class: "barre-comptage" },
      h("button", { class: "btn-sec", onclick: () => { etat.fait = null; dessinerAtelier(); } }, "Annuler"),
      h("button", { class: "btn", onclick: valider }, "Enregistrer")),
  );
}

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
      { label: "Objectifs", fait: prep.nb_objectifs > 0, quand: prep.nb_objectifs ? `${prep.nb_objectifs} fixé(s)` : "à fixer" },
      { label: "Comptage avant", fait: !!prep.comptage_avant, quand: prep.comptage_avant ? "fait le " + fmtDate(prep.comptage_avant.slice(0, 10)) : "juste avant de charger le stand" },
      { label: "Bilan", fait: false, quand: "après le salon : espèces à recopier, « mal exposé » à cocher" },
    ];
    preparation = h("section", { class: "carte" },
      h("h2", {}, "Préparation en cours : " + nomPreparation(prep, d.salons)),
      h("div", { class: "note", style: "padding:0 14px" }, `Tout prêt avant le ${fmtDateLongue(premier.date_debut)} · ${j > 0 ? `dans ${j} jour${j > 1 ? "s" : ""}` : "c'est maintenant"}`),
      h("ol", { class: "phases" }, phases.map((ph) => h("li", { class: ph.fait ? "fait" : "" }, h("strong", {}, (ph.fait ? "✓ " : "") + ph.label), h("span", { class: "note" }, ph.quand)))),
      h("div", { class: "formulaire" },
        h("button", { class: "btn", onclick: () => { location.hash = "objectifs/" + prep.id; } }, "Fixer les objectifs"),
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

// ───────────── Objectifs ─────────────
async function pageObjectifs(prepId) {
  etat.objectifs = await api(`/preparations/${prepId}/objectifs`);
  dessinerObjectifs();
}

function dessinerObjectifs() {
  const d = etat.objectifs;
  const nom = d.salons.map((s) => s.nom).join(" + ");
  entete("Objectifs · " + nom, h("button", { class: "btn-sec", onclick: () => { location.hash = "salons"; } }, "← Salons"));
  const page = document.getElementById("page");
  const marge = Math.round(d.reglages.marge * 100);
  const premier = d.salons[0];

  const changer = (a, s, valeur) => tenter(async () => {
    await api("/objectifs", { method: "PUT", body: { salon_id: s.salon_id, piece_id: a.id, retenu: valeur } });
    s.retenu = valeur === null ? null : Number(valeur);
    const retenus = a.par_salon.filter((x) => x.retenu !== null).map((x) => x.retenu);
    a.a_avoir = !retenus.length ? 0 : d.reglages.marge_unique
      ? Math.ceil(retenus.reduce((x, y) => x + y, 0) * (1 + d.reglages.marge) - 1e-9)
      : retenus.reduce((t, r) => t + Math.ceil(r * (1 + d.reglages.marge) - 1e-9), 0);
    dessinerObjectifs();
  });

  const tamponsPrevus = h("section", { class: "carte" },
    h("h2", {}, "1. Combien de tampons pour chaque salon ?"),
    h("p", { class: "note", style: "margin:0;padding:0 14px 8px" }, "Les tampons servent de thermomètre : leur présentoir est impossible à manquer, donc leurs ventes reflètent le passage réel devant le stand. On les prévoit à partir du salon passé le plus comparable."),
    h("table", { class: "tbl" }, h("tbody", {}, d.salons.map((s) => {
      const tp = d.tampons_prevus.find((x) => x.salon_id === s.id);
      return h("tr", {},
        h("td", { style: "font-weight:600" }, s.nom),
        h("td", { class: "note" }, tp.calcul),
        h("td", { class: "num", style: "width:220px" }, h("div", { class: "pas", style: "justify-content:flex-end" },
          h("input", { class: "compte", type: "number", min: "0", step: "1", value: tp.manuel ? String(tp.tampons) : "", placeholder: tp.tampons === null ? "?" : String(tp.tampons), "aria-label": "Tampons prévus pour " + s.nom,
            onchange: (e) => tenter(async () => {
              await api("/salons/" + s.id, { method: "PATCH", body: { tampons_prevus: e.target.value === "" ? null : Number(e.target.value) } });
              await pageObjectifs(d.preparation.id);
            }) }),
          h("span", { class: "note", style: "font-size:12px" }, tp.manuel ? "(vide = calcul)" : "tampons"))));
    }))));
  const conseilles = d.articles.flatMap((a) => a.par_salon.filter((s) => s.conseille !== null).map((s) => ({ salon_id: s.salon_id, piece_id: a.id, retenu: s.conseille })));
  const prendre = conseilles.length ? h("button", { class: "btn-sec", onclick: () => tenter(async () => {
    if (!confirm(`Remplacer les objectifs par les ${conseilles.length} valeurs conseillées ? Les articles sans conseil gardent leur objectif.`)) return;
    await api("/objectifs/lot", { method: "PUT", body: { lignes: conseilles } });
    flash("Objectifs conseillés repris : ajustez avec − / + si besoin.");
    await pageObjectifs(d.preparation.id);
  }) }, "Prendre les objectifs conseillés") : null;

  const familles = [...new Set(d.articles.map((a) => a.famille))];
  const cartes = familles.map((f) => h("section", { class: "carte" },
    h("h2", {}, f),
    h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, h("th", {}, "Article"), h("th", { class: "num" }, "Prêts"),
        d.salons.map((s) => h("th", {}, s.nom)), h("th", { class: "num" }, `À avoir le ${fmtDate(premier.date_debut)}`))),
      h("tbody", {}, d.articles.filter((a) => a.famille === f).map((a) => h("tr", {},
        h("td", {}, h("strong", {}, a.nom), a.par_salon[0]?.calcul ? h("div", { class: "note", style: "font-size:12px;max-width:340px" }, a.par_salon[0].calcul) : null),
        h("td", { class: "num" }, a.stock),
        a.par_salon.map((s) => h("td", {}, h("div", { class: "pas" },
          h("button", { class: "btn-petit", "aria-label": "Moins", disabled: !s.retenu, onclick: () => changer(a, s, Math.max(0, (s.retenu ?? 0) - 1)) }, "−"),
          h("input", { class: "compte", type: "number", min: "0", step: "1", value: s.retenu ?? "", placeholder: "—", "aria-label": `Objectif ${a.nom}`,
            onchange: (e) => changer(a, s, e.target.value === "" ? null : Number(e.target.value)) }),
          h("button", { class: "btn-petit", "aria-label": "Plus", onclick: () => changer(a, s, (s.retenu ?? 0) + 1) }, "+"),
          h("span", { class: "note", style: "font-size:12px", title: s.calcul ?? "" }, s.conseille === null ? "" : "conseillé " + s.conseille)))),
        h("td", { class: "num qte" }, a.a_avoir || "—")))))));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" },
    h("p", { class: "note", style: "margin:0" },
      `Fixez combien vous voulez vendre de chaque article à chaque salon. « À avoir » = la somme + ${marge} % de marge${d.reglages.marge_unique ? ", appliquée une seule fois pour la préparation" : ""}. ` +
      "Conseillé = tampons prévus × ventes pour 100 tampons au meilleur salon passé × part du modèle. L'outil conseille, vous fixez."),
    h("div", { class: "note", style: "font-size:13px" }, "Confiance : " + d.confiance + "."),
    tamponsPrevus,
    h("h2", { style: "margin:0;font-size:18px" }, "2. Les articles, à partir des tampons"),
    prendre,
    d.articles.length ? cartes : h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucun article à vendre. Créez-les dans Réglages.")),
    h("div", { class: "barre-comptage" }, h("button", { class: "btn", onclick: () => { location.hash = "atelier"; } }, "Voir ce qu'il reste à faire")),
  ));
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
  etat.bilan = await api(`/salons/${id}/bilan`);
  // Une case par nom de caisse et nombre de couleurs (encreurs) ; la couleur elle-même ne compte pas.
  const groupes = new Map();
  for (const c of etat.bilan.caisse) {
    const [base, option] = c.nom_affiche.split(" · ");
    const n = nbCouleurs(option);
    const nom = base + texteCouleurs(n);
    const g = groupes.get(nom) ?? groupes.set(nom, { nom, cle: c.cle, tampons: c.tampons, especes: 0 }).get(nom);
    g.especes += c.especes;
  }
  etat.bilan.groupes = [...groupes.values()];
  etat.bilanEspeces = { montant: etat.bilan.especes_montant ?? "", q: Object.fromEntries(etat.bilan.groupes.filter((g) => g.especes).map((g) => [g.cle, String(g.especes)])), filtre: "" };
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
    tuile("Espèces", d.especes_montant === null ? "à saisir" : euros(d.especes_montant), "absent de SumUp, à recopier ci-dessous"),
    tuile("Tampons (thermomètre)", String(d.tampons.total), d.tampons.pour_1000 === null ? "fréquentation inconnue" : `${String(d.tampons.pour_1000).replace(".", ",")} pour 1 000 visiteurs` + (d.tampons.especes ? ` · dont ${d.tampons.especes} en espèces` : "")),
    tuile("Fréquentation", d.salon.frequentation ? "~" + d.salon.frequentation.toLocaleString("fr-FR") : "?", [d.salon.type, `${d.salon.nb_jours} jour(s)`].filter(Boolean).join(" · ")));

  const alertes = [];
  if (aRelier) alertes.push(h("div", { class: "question" }, h("strong", {}, `${euros(aRelier)} de ventes avec des noms pas encore reliés`),
    h("div", {}, "Ils ne comptent ni dans les articles ni dans les tampons. ", h("a", { href: "#questions" }, "Les relier dans Questions"), ".")));
  if (autres) alertes.push(h("div", { class: "note" }, `${euros(autres)} de ventes « non suivies » (ex. articles de Lucile) écartées du bilan.`));

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

  const filtre = e.filtre.trim().toLowerCase();
  const lignesCaisse = d.groupes.filter((c) => !filtre || c.nom.toLowerCase().includes(filtre) || e.q[c.cle]);
  const especes = h("section", { class: "carte" }, h("h2", {}, "Espèces (table manuscrite)"),
    h("div", { class: "formulaire" },
      h("label", { for: "esp-montant" }, "Total des espèces (€)", h("input", { id: "esp-montant", type: "number", min: "0", step: "0.01", value: String(e.montant), style: "width:140px", oninput: (ev) => { e.montant = ev.target.value; } })),
      h("label", { for: "esp-filtre" }, "Chercher un nom de caisse", h("input", { id: "esp-filtre", value: e.filtre, placeholder: "ex. tampon", oninput: (ev) => { e.filtre = ev.target.value; dessinerBilan(); const el = document.getElementById("esp-filtre"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }))),
    h("table", { class: "tbl" }, h("tbody", {}, lignesCaisse.map((c) => h("tr", {},
      h("td", {}, c.nom, c.tampons ? h("span", { class: "note" }, ` · ${c.tampons} tampon(s)`) : null),
      h("td", { class: "num", style: "width:120px" }, h("input", { class: "compte", type: "number", min: "0", step: "1", value: e.q[c.cle] ?? "", placeholder: "0", "aria-label": "Vendus en espèces : " + c.nom,
        oninput: (ev) => { e.q[c.cle] = ev.target.value; } })))))),
    h("div", { class: "barre-comptage", style: "padding:14px" },
      h("span", { class: "note" }, "Les quantités en espèces retirent les articles du stock, comme les ventes carte."),
      h("button", { class: "btn", onclick: () => tenter(async () => {
        const lignes = Object.entries(e.q).filter(([, v]) => v !== "" && Number(v) > 0).map(([cle, v]) => ({ cle, quantite: Number(v) }));
        if (lignes.some((l) => !Number.isInteger(l.quantite))) throw new Error("Les quantités doivent être des nombres entiers.");
        const r = await api(`/salons/${d.salon.id}/especes`, { method: "PUT", body: { montant: e.montant === "" ? null : Number(e.montant), lignes } });
        flash(`Espèces enregistrées (${lignes.length} ligne(s), ${r.appliquees} retrait(s) de stock).`);
        await pageBilan(d.salon.id);
      }) }, "Enregistrer les espèces")));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, tuiles, ...alertes, articles, especes));
}

// ───────────── À acheter ─────────────
async function pageAchats() {
  etat.achats = await api("/achats");
  dessinerAchats();
}

function texteLots(l) {
  if (l.tout_le_disponible) return "tout le disponible";
  if (l.sans_quantite) return "1 pot";
  return l.lots ? `${l.a_commander} (${l.lots.nombre} lot${l.lots.nombre > 1 ? "s" : ""} de ${l.lots.taille})` : String(l.a_commander);
}

function dessinerAchats() {
  const d = etat.achats;
  entete("À acheter");
  const page = document.getElementById("page");
  const act = etat.achatAction;
  const blocs = [];
  blocs.push(h("p", { class: "note", style: "margin:0" }, d.preparation
    ? `Pour la préparation en cours (${d.salons.map((s) => s.nom).join(" + ")}, premier jour le ${fmtDate(d.salons[0].date_debut)}), d'après les étapes de l'Atelier. « À commander avant » = premier jour − délai du fournisseur.`
    : "Aucune préparation en cours : seuls les pots presque vides et les quantités fixées à la main apparaissent."));
  if (d.alertes.length) blocs.push(h("div", { class: "question" }, h("strong", {}, "Récup"), d.alertes.map((a) => h("div", {}, a))));

  const ligne = (l) => {
    const ouvert = act && act.piece_id === l.piece_id ? act : null;
    let panneau = null;
    if (ouvert?.type === "commande") {
      const q = h("input", { class: "compte", type: "number", min: "1", step: "1", value: l.tout_le_disponible || l.sans_quantite ? "" : String(l.a_commander), placeholder: "quantité", "aria-label": "Quantité commandée" });
      const lot = h("input", { class: "compte", type: "number", min: "1", step: "1", value: l.lots ? String(l.lots.taille) : "", placeholder: "lot ?", "aria-label": "Taille du lot" });
      panneau = h("div", { class: "ligne-editeur" }, "Commandé :", q, h("span", { class: "note" }, "par lots de"), lot,
        h("button", { class: "btn", onclick: () => tenter(async () => {
          if (!l.sans_quantite && q.value === "") throw new Error("Indiquez la quantité commandée (ce que vous avez pu prendre).");
          await api("/commandes", { method: "POST", body: { piece_id: l.piece_id, quantite: l.sans_quantite ? 1 : Number(q.value), taille_lot: lot.value === "" ? null : Number(lot.value) } });
          etat.achatAction = null; flash("Noté comme commandé."); await pageAchats();
        }) }, "Valider"),
        h("button", { class: "btn-sec", onclick: () => { etat.achatAction = null; dessinerAchats(); } }, "Annuler"));
    } else if (ouvert?.type === "compter") {
      const q = h("input", { class: "compte", type: "number", min: "0", step: "1", "aria-label": "Combien en avez-vous ?" });
      panneau = h("div", { class: "ligne-editeur" }, `Combien de ${l.nom} avez-vous vraiment ?`, q,
        h("button", { class: "btn", onclick: () => tenter(async () => {
          if (q.value === "") throw new Error("Indiquez un nombre.");
          await enregistrerComptage([{ piece_id: l.piece_id, compte: Number(q.value) }]);
          etat.achatAction = null; await pageAchats();
        }) }, "Valider"),
        h("button", { class: "btn-sec", onclick: () => { etat.achatAction = null; dessinerAchats(); } }, "Annuler"));
    } else if (ouvert?.type === "modifier") {
      const q = h("input", { class: "compte", type: "number", min: "1", step: "1", value: l.ajuste && !l.sans_quantite ? String(l.a_commander) : "", placeholder: "calcul", "aria-label": "Quantité" });
      const dt = h("input", { type: "date", value: l.avant_le ?? "", "aria-label": "À commander avant le", style: "min-height:36px;border:1px solid var(--bord-fort);border-radius:8px;padding:0 8px" });
      panneau = h("div", { class: "ligne-editeur" }, "Quantité", q, "à commander avant le", dt,
        h("button", { class: "btn", onclick: () => tenter(async () => {
          await api("/achats/ajustement", { method: "PUT", body: { piece_id: l.piece_id, quantite: q.value === "" ? null : Number(q.value), avant_le: dt.value || null } });
          etat.achatAction = null; await pageAchats();
        }) }, "Enregistrer"),
        l.ajuste ? h("button", { class: "btn-sec", onclick: () => tenter(async () => {
          await api("/achats/ajustement", { method: "PUT", body: { piece_id: l.piece_id, quantite: null, avant_le: null } });
          etat.achatAction = null; await pageAchats();
        }) }, "Revenir au calcul") : null,
        h("button", { class: "btn-sec", onclick: () => { etat.achatAction = null; dessinerAchats(); } }, "Annuler"));
    }
    const ouvrir = (type) => () => { etat.achatAction = { piece_id: l.piece_id, type }; dessinerAchats(); };
    return [
      h("tr", {},
        h("td", {}, h("strong", {}, l.nom), h("div", { class: "note", style: "font-size:12px" }, l.famille)),
        h("td", { class: "note" }, l.calcul + (l.ajuste ? " · modifié à la main" : "")),
        h("td", { class: "num qte" }, texteLots(l)),
        h("td", { class: l.en_retard ? "manque-txt" : "" }, l.avant_le ? (l.en_retard ? "⚠ " : "") + fmtDate(l.avant_le) : h("span", { class: "note" }, l.delai_inconnu ? "délai inconnu" : "—")),
        h("td", {}, h("div", { class: "actions-ligne" },
          h("button", { class: "btn-petit", disabled: !!act, onclick: ouvrir("commande") }, "Commandé"),
          l.sans_quantite ? null : h("button", { class: "btn-petit", disabled: !!act, onclick: ouvrir("compter") }, "J'en ai déjà"),
          h("button", { class: "btn-petit", disabled: !!act, onclick: ouvrir("modifier") }, "Modifier")))),
      panneau ? h("tr", {}, h("td", { colspan: "5", style: "background:#FBF8F2" }, panneau)) : null,
    ];
  };

  blocs.push(h("section", { class: "carte" }, h("h2", {}, "À commander"),
    d.lignes.length ? h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Fourniture", "Calcul", "À commander", "Avant le", ""].map((t, i) => h("th", { class: i === 2 ? "num" : null }, t)))),
      h("tbody", {}, d.lignes.flatMap(ligne))) : h("div", { class: "vide" }, "Rien à commander pour l'instant.")));

  blocs.push(h("section", { class: "carte" }, h("h2", {}, "Commandé, en attente"),
    d.commandes.length ? h("table", { class: "tbl" }, h("tbody", {}, d.commandes.flatMap((cmd) => {
      const ouvert = act && act.commande_id === cmd.id;
      const q = h("input", { class: "compte", type: "number", min: "0", step: "1", value: String(cmd.quantite), "aria-label": "Quantité reçue" });
      const lot = h("input", { class: "compte", type: "number", min: "1", step: "1", value: cmd.taille_lot ?? "", placeholder: "lot ?", "aria-label": "Taille du lot reçu" });
      return [
        h("tr", {},
          h("td", { style: "font-weight:600" }, cmd.nom),
          h("td", { class: "num" }, cmd.suivi === "quantite" ? cmd.quantite + (cmd.taille_lot ? ` (lots de ${cmd.taille_lot})` : "") : "1 pot"),
          h("td", { class: "note" }, "commandé le " + fmtDate(cmd.commande_le.slice(0, 10))),
          h("td", {}, h("div", { class: "actions-ligne" },
            h("button", { class: "btn-petit", disabled: !!act, onclick: () => { etat.achatAction = { commande_id: cmd.id }; dessinerAchats(); } }, "Reçu…"),
            h("button", { class: "btn-petit", disabled: !!act, onclick: () => tenter(async () => {
              if (!confirm(`Annuler la commande de ${cmd.nom} ?`)) return;
              await api("/commandes/" + cmd.id, { method: "DELETE" }); await pageAchats();
            }) }, "Annuler")))),
        ouvert ? h("tr", {}, h("td", { colspan: "4", style: "background:#FBF8F2" }, h("div", { class: "ligne-editeur" },
          cmd.suivi === "quantite" ? ["Reçu :", q, h("span", { class: "note" }, "taille du lot"), lot] : "Pot reçu.",
          h("button", { class: "btn", onclick: () => tenter(async () => {
            await api(`/commandes/${cmd.id}/recu`, { method: "POST", body: cmd.suivi === "quantite" ? { quantite: Number(q.value), taille_lot: lot.value === "" ? null : Number(lot.value) } : {} });
            etat.achatAction = null; flash("Reçu : entré en stock."); await pageAchats();
          }) }, "Valider"),
          h("button", { class: "btn-sec", onclick: () => { etat.achatAction = null; dessinerAchats(); } }, "Annuler")))) : null,
      ];
    }))) : h("div", { class: "vide" }, "Aucune commande en attente.")));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, ...blocs));
}

// Réglages d'achat d'une fourniture (délai, mode, lots).
async function ouvrirReglageAchat(p) {
  const r = await api(`/pieces/${p.id}/achat`);
  etat.achatEdition = { id: p.id, delai: r.delai_jours ?? "", mode: r.mode_achat ?? "quantite", lots: r.lots.join(", ") };
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
    h("button", { class: "btn", onclick: () => tenter(async () => {
      const lots = e.lots.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (lots.some((t) => !Number.isInteger(t) || t < 1)) throw new Error("Tailles de lot : des nombres entiers séparés par des virgules.");
      await api(`/pieces/${p.id}/achat`, { method: "PUT", body: { delai_jours: e.delai === "" ? null : Number(e.delai), mode_achat: e.mode, lots } });
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
      "Aucun salon à venir. Ajoutez le prochain dans ", h("a", { href: "#salons" }, "Salons"), " : le rétro-planning apparaîtra ici.")));
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
    texteFab.textContent = `Fabrication · ${n} jour${n > 1 ? "s" : ""}` + (d.fabrication.travail_min ? ` · ≈ ${dureeTexte(d.fabrication.travail_min)} de travail` : "");
  };
  placerBande(fab0.date, fab1.date);
  for (const [j, cote] of [[fab0, "g"], [fab1, "d"]]) bande.append(poignee(j, cote));
  voie.append(bande);

  // Étiquettes : jalons (hors fabrication) et noms de salons. Placement au-dessus/en dessous, par rangées.
  const largeurPx = Math.max(680, (document.getElementById("page").clientWidth || 900) - 140);
  const items = [
    ...d.jalons.filter((j) => !j.type.startsWith("fabrication")).map((j) => ({ j, x: centre(j.date), titre: j.nom, sous: fmtDate(j.date) })),
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
  const f = d.fabrication;
  const tuiles = h("div", { class: "tuiles" },
    tuile("Atelier", f.articles_manquants ? `${f.articles_manquants} article(s)` : "rien à faire", f.etapes ? `${f.etapes} étape(s) · ≈ ${dureeTexte(f.travail_min)}` : "tout est prêt", "#atelier"),
    tuile("À acheter", d.achats ? `${d.achats} ligne(s)` : "rien", "commandes de la préparation", "#achats"),
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

function lienJalon(type) {
  const liens = { objectifs: ["#objectifs/" + etat.accueil.preparation.id, "Ouvrir les objectifs"], commandes: ["#achats", "Ouvrir À acheter"],
    fabrication_debut: ["#atelier", "Ouvrir l'Atelier"], fabrication_fin: ["#atelier", "Ouvrir l'Atelier"],
    comptage: ["#stock/avant/" + etat.accueil.preparation.id, "Faire le comptage avant"], bilan: ["#bilan/" + etat.accueil.salons[0].id, "Ouvrir le bilan"] };
  const l = liens[type];
  return l ? h("a", { href: l[0], class: "btn-petit", style: "display:inline-flex;align-items:center;text-decoration:none" }, l[1]) : null;
}

window.addEventListener("hashchange", () => {
  Object.assign(etat, { jalonChoisi: null, achatAction: null, achatEdition: null, corrEdition: null, comptage: null, ligneEnCours: null, edition: null, editeur: null, fait: null, salonEdition: null, comptageAvant: null });
  afficher();
});
afficher();
