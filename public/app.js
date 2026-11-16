// Interface ordinateur. Aucun framework : petites fonctions qui construisent le DOM.

const NIVEAUX = { a_vendre: "À vendre", fait_maison: "Fait maison", achete: "Acheté", recup: "Récup" };
const SUIVIS = {
  quantite: "Compté à la pièce",
  sans_quantite: "Sans quantité (ex. peinture)",
  generique: "Générique, sans stock (ex. « Tampon » de la caisse)",
};
const PAGES = [
  { id: "stock", label: "Stock" },
  { id: "atelier", label: "Atelier" },
  { id: "achats", label: "À acheter", bientot: true },
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
  return PAGES.some((p) => p.id === id && !p.bientot) ? id : "stock";
}

function dessinerMenu() {
  const nav = document.getElementById("nav");
  nav.replaceChildren(
    ...PAGES.map((p) =>
      h("button", {
        "aria-current": etat.page === p.id || (etat.page === "objectifs" && p.id === "salons") ? "page" : null,
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
    if (etat.page === "stock") await pageStock();
    if (etat.page === "reglages") await pageReglages();
    if (etat.page === "atelier") await pageAtelier();
    if (etat.page === "salons") await pageSalons();
    if (etat.page === "questions") await pageQuestions();
    if (etat.page === "objectifs") await pageObjectifs(Number(etat.params[0]));
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
        h("a", { href: "#reglages" }, "Réglages"), " pour créer les familles et les pièces.")),
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
    h("span", {}, h("span", { class: "badge badge-fait_maison" }, "Fait maison"), " préparé d'avance, en réserve"),
    h("span", {}, h("span", { class: "badge badge-achete" }, "Acheté"), " fourniture"),
  );

  const cartes = piecesVisibles().map((f) =>
    h("section", { class: "carte" },
      h("h2", {}, f.nom),
      f.pieces.length
        ? h("table", { class: "tbl" }, h("tbody", {}, f.pieces.map(ligneStock)))
        : h("div", { class: "vide" }, "Aucune pièce dans cette famille."),
    ),
  );

  const barre = enComptage ? barreComptage() : null;
  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, filtres, legende, ...cartes, barre));
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
    const ecartEl = h("span", { class: "ecart" }, ecart ? signe(ecart) : "");
    action = h("div", { class: "actions-ligne" },
      h("label", { class: "sr", for: "c" + p.id }, "Compté pour " + p.nom),
      h("input", {
        id: "c" + p.id, class: "compte", type: "number", min: "0", step: "1", inputmode: "numeric",
        placeholder: String(p.stock), value: saisi ?? "",
        oninput: (e) => {
          etat.comptage[p.id] = e.target.value;
          const d = e.target.value === "" ? 0 : Number(e.target.value) - p.stock;
          ecartEl.textContent = d ? signe(d) : "";
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
    h("td", { class: "num qte" }, qte),
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
  return `${n} pièce(s) comptée(s) · ${e} écart(s) · les cases vides ne sont pas comptées`;
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

// ───────────── Réglages : familles et pièces ─────────────
async function pageReglages() {
  [etat.familles, etat.stock, etat.etapes, etat.correspondances] = await Promise.all([api("/familles"), api("/stock"), api("/etapes"), api("/correspondances")]);
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
          h("tr", {}, h("td", { style: "font-weight:600" }, f.nom), h("td", { class: "num" },
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
        flash("Pièce ajoutée. Son stock part de 0 : comptez-la depuis l'écran Stock.");
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
      h("h2", {}, "Pièces et articles"),
      toutes.length
        ? h("table", { class: "tbl" },
            h("thead", {}, h("tr", {}, ["Nom", "Famille", "Type", "Suivi", ""].map((t) => h("th", {}, t)))),
            h("tbody", {}, toutes.map(lignePieceReglage)))
        : h("div", { class: "vide" }, "Aucune pièce."),
      formPiece,
    );
  }

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, familles, pieces, ...sectionsRecettes(), sectionCorrespondances()));
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

function selectPiece(valeur, onchange, label) {
  return h("select", { "aria-label": label, onchange: (e) => onchange(Number(e.target.value)) },
    h("option", { value: "", selected: !valeur }, "— choisir —"),
    etat.stock.map((f) => h("optgroup", { label: f.nom },
      f.pieces.map((p) => h("option", { value: String(p.id), selected: p.id === valeur }, `${p.nom} (${NIVEAUX[p.niveau]})`)))),
  );
}

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
    ed.utilise.length ? null : h("div", { class: "note" }, "Rien (ex. une étape qui ne consomme aucune pièce suivie)."),
    ed.utilise.map((u, i) => h("div", { class: "ligne-editeur" },
      selectPiece(u.piece_id, (v) => { u.piece_id = v; }, "Pièce utilisée"), ligneQte(u, "quantite", "Quantité utilisée"), retirer(ed.utilise, i))),
    h("button", { type: "button", class: "btn-petit", onclick: () => { ed.utilise.push({ piece_id: null, quantite: 1 }); redessiner(); } }, "+ pièce utilisée"),
  );

  const donne = h("div", { class: "bloc-editeur" },
    h("strong", {}, "Donne"),
    ed.donne.map((d, i) => d.au_choix
      ? h("div", { class: "choix-editeur" },
          h("div", { class: "ligne-editeur" },
            h("span", {}, "Au choix, capacité"), ligneQte(d, "quantite", "Capacité (parts)"), h("span", { class: "note" }, "part(s)"), retirer(ed.donne, i)),
          d.choix.map((c, j) => h("div", { class: "ligne-editeur" },
            selectPiece(c.piece_id, (v) => { c.piece_id = v; }, "Pièce au choix"),
            ligneQte(c, "poids", "Parts prises"), h("span", { class: "note" }, "part(s)"), retirer(d.choix, j))),
          h("button", { type: "button", class: "btn-petit", onclick: () => { d.choix.push({ piece_id: null, poids: 1 }); redessiner(); } }, "+ pièce au choix"))
      : h("div", { class: "ligne-editeur" },
          selectPiece(d.piece_id, (v) => { d.piece_id = v; }, "Pièce donnée"), ligneQte(d, "quantite", "Quantité donnée"), retirer(ed.donne, i))),
    h("div", { class: "ligne-editeur" },
      h("button", { type: "button", class: "btn-petit", onclick: () => { ed.donne.push({ au_choix: false, piece_id: null, quantite: 1 }); redessiner(); } }, "+ pièce donnée"),
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
      throw new Error("Choisissez une pièce sur chaque ligne (ou retirez la ligne).");
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
      : "Quantités pour UNE pièce faite."),
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
        "Pour chaque article, l'outil part de ce qui est déjà fait maison et ne propose de refaire une étape que si la réserve ne suffit pas. Les étapes sont numérotées dans l'ordre où les faire."));
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
        if (!confirm(`Annuler la saisie « ${x.nom} × ${x.fois} » ? Les pièces utilisées reviennent en stock, les pièces obtenues sont retirées.`)) return;
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
    reserve.length ? h("div", { class: "note", style: "padding:0 14px 6px" }, "Partira en réserve (fait maison) : " + reserve.join(", ")) : null,
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
  etat.salons = await api("/salons");
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
      { label: "Bilan", fait: false, quand: "après le salon (avec l'import des ventes)" },
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
          h("thead", {}, h("tr", {}, ["Salon", "Type", "Jours", "Fréquentation", ""].map((t, i) => h("th", { class: i === 2 || i === 3 ? "num" : null }, t)))),
          h("tbody", {}, passes.map((s) => etat.salonEdition === s.id
            ? h("tr", {}, h("td", { colspan: "5" }, formulaireSalon(s)))
            : h("tr", {},
                h("td", {}, h("strong", {}, s.nom), h("div", { class: "note" }, datesSalon(s))),
                h("td", {}, s.type ?? ""), h("td", { class: "num" }, s.nb_jours),
                h("td", { class: "num" }, s.frequentation ? s.frequentation.toLocaleString("fr-FR") : "—"),
                h("td", {}, h("div", { class: "actions-ligne" }, h("button", { class: "btn-petit", disabled: !!etat.salonEdition, onclick: () => { etat.salonEdition = s.id; dessinerSalons(); } }, "Modifier")))))))
      : h("div", { class: "vide" }, "Aucun. Les salons passés servent aux recommandations : saisissez ceux de l'historique (dates, fréquentation)."),
    h("div", { class: "note", style: "padding:0 14px 14px;font-size:13px" }, "Ventes carte, tampons et bilan arriveront avec l'import SumUp."),
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

  const familles = [...new Set(d.articles.map((a) => a.famille))];
  const cartes = familles.map((f) => h("section", { class: "carte" },
    h("h2", {}, f),
    h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, h("th", {}, "Article"), h("th", { class: "num" }, "Prêts"),
        d.salons.map((s) => h("th", {}, s.nom)), h("th", { class: "num" }, `À avoir le ${fmtDate(premier.date_debut)}`))),
      h("tbody", {}, d.articles.filter((a) => a.famille === f).map((a) => h("tr", {},
        h("td", { style: "font-weight:600" }, a.nom),
        h("td", { class: "num" }, a.stock),
        a.par_salon.map((s) => h("td", {}, h("div", { class: "pas" },
          h("button", { class: "btn-petit", "aria-label": "Moins", disabled: !s.retenu, onclick: () => changer(a, s, Math.max(0, (s.retenu ?? 0) - 1)) }, "−"),
          h("input", { class: "compte", type: "number", min: "0", step: "1", value: s.retenu ?? "", placeholder: "—", "aria-label": `Objectif ${a.nom}`,
            onchange: (e) => changer(a, s, e.target.value === "" ? null : Number(e.target.value)) }),
          h("button", { class: "btn-petit", "aria-label": "Plus", onclick: () => changer(a, s, (s.retenu ?? 0) + 1) }, "+"),
          h("span", { class: "note", style: "font-size:12px" }, s.conseille === null ? "" : "conseillé " + s.conseille)))),
        h("td", { class: "num qte" }, a.a_avoir || "—")))))));

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" },
    h("p", { class: "note", style: "margin:0" },
      `Fixez combien vous voulez vendre de chaque article à chaque salon. « À avoir » = la somme + ${marge} % de marge${d.reglages.marge_unique ? ", appliquée une seule fois pour la préparation" : ""}. ` +
      "Les objectifs conseillés (calculés à partir des tampons et des salons passés) arriveront avec l'import des ventes SumUp ; en attendant, vous les fixez à la main."),
    d.articles.length ? cartes : h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucun article à vendre. Créez-les dans Réglages.")),
    h("div", { class: "barre-comptage" }, h("button", { class: "btn", onclick: () => { location.hash = "atelier"; } }, "Voir ce qu'il reste à faire")),
  ));
}

// ───────────── Questions ─────────────
const ORDRE_QUESTIONS = { vente_impossible: 0, remboursement: 1, etape_depasse_stock: 2, nom_inconnu: 3, especes_a_saisir: 4 };

async function compterQuestions() {
  try { etat.nbQuestions = (await api("/questions")).length; } catch { etat.nbQuestions = null; }
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
    const k = q.detail.nom.trim().toLowerCase();
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

function carteGroupeNom(groupe) {
  const cle = "g:" + groupe[0].detail.nom.trim().toLowerCase();
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
        h("div", { class: "note" }, groupe.length > 1 ? "Variantes vues à la caisse : la réponse s'applique à celles qui sont cochées." : "Option vue à la caisse :"),
        groupe.map((q) => h("label", { class: "ligne-editeur" },
          groupe.length > 1 ? h("input", { type: "checkbox", checked: b.choisies.has(q.id), onchange: (e) => { e.target.checked ? b.choisies.add(q.id) : b.choisies.delete(q.id); } }) : null,
          h("span", {}, h("strong", {}, q.detail.description || "(sans option)"),
            h("span", { class: "note" }, ` · ${q.detail.quantite} vendu(s) ${periode(q.detail)}${q.detail.prix ? ` · ${q.detail.prix} €` : ""}`)))))
    : null;
  return h("section", { class: "carte" + (toutesSel ? " selectionnee" : "") },
    h("div", { class: "tete-article" },
      h("h2", { style: "padding:0" }, `SumUp vend « ${groupe[0].detail.nom} »`),
      h("label", { class: "ligne-editeur note" }, h("input", { type: "checkbox", checked: toutesSel, onchange: (e) => {
        ids.forEach((id) => (e.target.checked ? etat.selection.add(id) : etat.selection.delete(id)));
        dessinerQuestions();
      } }), "sélectionner")),
    h("div", { class: "editeur", style: "border-top:0;padding-top:0" },
      groupe.length === 1 && !groupe[0].detail.description
        ? h("div", { class: "note" }, `${vendus} vendu(s) ${periode(groupe[0].detail)}${groupe[0].detail.prix ? ` · ${groupe[0].detail.prix} €` : ""}.`) : null,
      variantes,
      h("div", {}, "Quel article est-ce ? Une vente retirera ces pièces du stock :"),
      lignesPieces(b.lignes, "Pièce retirée du stock"),
      h("label", { class: "ligne-editeur" }, "Compte pour",
        h("input", { type: "number", min: "0", step: "1", class: "compte", value: b.tampons, oninput: (e) => { b.tampons = e.target.value; } }),
        h("span", { class: "note" }, "tampon(s) dans le contrôle des tampons (0 si ce n'est pas un tampon ; lot = 4, collection = 20)")),
      h("div", { class: "note", style: "font-size:13px" }, "Article absent de la liste ? Créez-le d'abord dans ", h("a", { href: "#reglages" }, "Réglages"), "."),
      h("div", { class: "barre-comptage" },
        h("button", { class: "btn-sec", onclick: () => repondre({ ne_pas_suivre: true }, (r) => `${r.noms} nom(s) marqué(s) « Ne pas suivre ».`) }, "Ne pas suivre"),
        h("button", { class: "btn", onclick: () => {
          if (b.lignes.some((l) => !l.piece_id)) return flash("Choisissez une pièce sur chaque ligne.", true);
          repondre({ pieces: b.lignes.map((l) => ({ piece_id: l.piece_id, quantite: Number(l.quantite) })), equivalent_tampons: Number(b.tampons || 0) },
            (r) => `Enregistré pour ${r.noms} nom(s). ${r.ventes_appliquees} vente(s) retirée(s) du stock ; les ventes antérieures au début du suivi d'une pièce ne servent qu'aux statistiques.`);
        } }, "Enregistrer"))));
}

function lignesPieces(etatLignes, label) {
  return h("div", { class: "bloc-editeur" },
    etatLignes.map((l, i) => h("div", { class: "ligne-editeur" },
      selectPiece(l.piece_id, (v) => { l.piece_id = v; }, label),
      h("span", { class: "note" }, "×"),
      h("input", { type: "number", min: "1", step: "1", class: "compte", value: String(l.quantite), "aria-label": "Quantité", oninput: (e) => { l.quantite = e.target.value; } }),
      etatLignes.length > 1 ? h("button", { type: "button", class: "btn-petit", onclick: () => { etatLignes.splice(i, 1); dessinerQuestions(); } }, "Retirer") : null)),
    h("button", { type: "button", class: "btn-petit", onclick: () => { etatLignes.push({ piece_id: null, quantite: 1 }); dessinerQuestions(); } }, "+ une autre pièce"));
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
        lignesPieces(b.lignes, "Pièce retirée du stock"),
        h("label", { class: "ligne-editeur" }, "Compte pour",
          h("input", { type: "number", min: "0", step: "1", class: "compte", value: b.tampons, oninput: (e) => { b.tampons = e.target.value; } }),
          h("span", { class: "note" }, "tampon(s) dans le contrôle des tampons (0 si ce n'est pas un tampon ; lot = 4, collection = 20)")),
        h("div", { class: "note", style: "font-size:13px" }, "Article absent de la liste ? Créez-le d'abord dans ", h("a", { href: "#reglages" }, "Réglages"), "."),
        h("div", { class: "barre-comptage" },
          h("button", { class: "btn-sec", onclick: () => repondre({ ne_pas_suivre: true }, () => "Noté : ce nom ne sera pas suivi.") }, "Ne pas suivre"),
          h("button", { class: "btn", onclick: () => {
            if (b.lignes.some((l) => !l.piece_id)) return flash("Choisissez une pièce sur chaque ligne.", true);
            repondre({ pieces: b.lignes.map((l) => ({ piece_id: l.piece_id, quantite: Number(l.quantite) })), equivalent_tampons: Number(b.tampons || 0) },
              (r) => `Enregistré. ${r.ventes_appliquees} vente(s) récente(s) retirée(s) du stock (les ventes antérieures au début du suivi d'une pièce ne comptent que pour les statistiques).`);
          } }, "Enregistrer"))));
  }

  if (q.type === "remboursement") {
    const b = brouillons.get(q.id) ?? brouillons.set(q.id, { lignes: [{ piece_id: null, quantite: 1 }] }).get(q.id);
    const quand = d.date ? new Date(d.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
    return h("section", { class: "carte" },
      h("h2", {}, `Remboursement de ${d.montant ?? "?"} € ${quand ? "(" + quand + ")" : ""}`),
      h("div", { class: "editeur", style: "border-top:0" },
        h("div", { class: "note" }, "L'article est-il revenu en stock ?" + (d.type ? ` (opération SumUp : ${d.type})` : "")),
        lignesPieces(b.lignes, "Pièce revenue en stock"),
        h("div", { class: "barre-comptage" },
          h("button", { class: "btn-sec", onclick: () => repondre({ rien: true }, () => "Noté.") }, "Rien n'est revenu"),
          h("button", { class: "btn", onclick: () => {
            if (b.lignes.some((l) => !l.piece_id)) return flash("Choisissez une pièce sur chaque ligne.", true);
            repondre({ pieces: b.lignes.map((l) => ({ piece_id: l.piece_id, quantite: Number(l.quantite) })) }, () => "Remis en stock.");
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
      h("thead", {}, h("tr", {}, ["Nom à la caisse", "Retire du stock", "Tampons", "Vendus", ""].map((t, i) => h("th", { class: i >= 2 && i <= 3 ? "num" : null }, t)))),
      h("tbody", {}, liste.map((c) => ed && ed.cle === c.cle
        ? h("tr", {}, h("td", { colspan: "5" }, h("div", { class: "editeur", style: "border-top:0" },
            h("strong", {}, c.nom_affiche),
            lignesPiecesReglages(ed.lignes),
            h("label", { class: "ligne-editeur" }, "Compte pour",
              h("input", { type: "number", min: "0", step: "1", class: "compte", value: ed.tampons, oninput: (e) => { ed.tampons = e.target.value; } }), "tampon(s)"),
            h("div", { class: "barre-comptage" },
              h("button", { class: "btn-sec", onclick: () => { etat.corrEdition = null; dessinerReglages(); } }, "Annuler"),
              h("button", { class: "btn-sec", onclick: () => sauverCorrespondance({ cle: c.cle, ne_pas_suivre: true }) }, "Ne pas suivre"),
              h("button", { class: "btn", onclick: () => {
                if (ed.lignes.some((l) => !l.piece_id)) return flash("Choisissez une pièce sur chaque ligne.", true);
                sauverCorrespondance({ cle: c.cle, pieces: ed.lignes.map((l) => ({ piece_id: l.piece_id, quantite: Number(l.quantite) })), equivalent_tampons: Number(ed.tampons || 0) });
              } }, "Enregistrer")))))
        : h("tr", {},
            h("td", { style: "font-weight:600" }, c.nom_affiche),
            h("td", {}, c.ne_pas_suivre ? h("span", { class: "note" }, "non suivi") : c.pieces.map((p) => `${p.quantite > 1 ? p.quantite + " × " : ""}${p.nom}`).join(" + ")),
            h("td", { class: "num" }, c.equivalent_tampons || ""),
            h("td", { class: "num" }, c.vendus),
            h("td", {}, h("div", { class: "actions-ligne" }, h("button", { class: "btn-petit", disabled: !!ed, onclick: () => {
              etat.corrEdition = { cle: c.cle, tampons: String(c.equivalent_tampons), lignes: c.pieces.length ? c.pieces.map((p) => ({ piece_id: p.piece_id, quantite: p.quantite })) : [{ piece_id: null, quantite: 1 }] };
              dessinerReglages();
            } }, "Modifier"))))))));
}

function lignesPiecesReglages(lignes) {
  return h("div", { class: "bloc-editeur" },
    lignes.map((l, i) => h("div", { class: "ligne-editeur" },
      selectPiece(l.piece_id, (v) => { l.piece_id = v; }, "Pièce"), h("span", { class: "note" }, "×"),
      h("input", { type: "number", min: "1", step: "1", class: "compte", value: String(l.quantite), oninput: (e) => { l.quantite = e.target.value; } }),
      lignes.length > 1 ? h("button", { type: "button", class: "btn-petit", onclick: () => { lignes.splice(i, 1); dessinerReglages(); } }, "Retirer") : null)),
    h("button", { type: "button", class: "btn-petit", onclick: () => { lignes.push({ piece_id: null, quantite: 1 }); dessinerReglages(); } }, "+ une autre pièce"));
}

function sauverCorrespondance(corps) {
  tenter(async () => {
    const r = await api("/correspondances", { method: "PUT", body: corps });
    etat.corrEdition = null;
    flash(`Enregistré : ${r.ventes_appliquees} vente(s) réappliquée(s) au stock.`);
    await pageReglages();
  });
}

window.addEventListener("hashchange", () => {
  Object.assign(etat, { corrEdition: null, comptage: null, ligneEnCours: null, edition: null, editeur: null, fait: null, salonEdition: null, comptageAvant: null });
  afficher();
});
afficher();
