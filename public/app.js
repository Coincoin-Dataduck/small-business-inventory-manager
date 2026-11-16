// Interface ordinateur. Aucun framework : petites fonctions qui construisent le DOM.

const NIVEAUX = { a_vendre: "À vendre", fait_maison: "Fait maison", achete: "Acheté", recup: "Récup" };
const SUIVIS = {
  quantite: "Compté à la pièce",
  sans_quantite: "Sans quantité (ex. peinture)",
  generique: "Générique, sans stock (ex. « Tampon » de la caisse)",
};
const PAGES = [
  { id: "stock", label: "Stock" },
  { id: "atelier", label: "Atelier", bientot: true },
  { id: "achats", label: "À acheter", bientot: true },
  { id: "salons", label: "Salons", bientot: true },
  { id: "questions", label: "Questions", bientot: true },
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
const etat = { page: "stock", filtre: null, comptage: null, ligneEnCours: null, stock: [], familles: [], edition: null };

function pageCourante() {
  const id = location.hash.replace("#", "");
  return PAGES.some((p) => p.id === id && !p.bientot) ? id : "stock";
}

function dessinerMenu() {
  const nav = document.getElementById("nav");
  nav.replaceChildren(
    ...PAGES.map((p) =>
      h("button", {
        "aria-current": etat.page === p.id ? "page" : null,
        disabled: p.bientot,
        title: p.bientot ? "Pas encore construit" : null,
        onclick: () => { location.hash = p.id; },
      }, p.label, p.bientot ? h("span", { class: "bientot" }, "bientôt") : null),
    ),
  );
}

async function afficher() {
  etat.page = pageCourante();
  dessinerMenu();
  await tenter(async () => {
    if (etat.page === "stock") await pageStock();
    if (etat.page === "reglages") await pageReglages();
  });
}

function entete(titre, action) {
  document.getElementById("titre").textContent = titre;
  document.getElementById("action").replaceChildren(...(action ? [action] : []));
}

// ───────────── Stock ─────────────
async function pageStock() {
  etat.stock = await api("/stock");
  dessinerStock();
}

function piecesVisibles() {
  return etat.stock.filter((f) => etat.filtre === null || f.id === etat.filtre);
}

function dessinerStock() {
  const enComptage = etat.comptage !== null;
  entete("Stock", enComptage ? null : h("button", { class: "btn", onclick: demarrerComptage }, "Faire un comptage"));
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
    h("button", { class: "btn-sec", onclick: () => { etat.comptage = null; dessinerStock(); } }, "Annuler"),
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

async function enregistrerComptage(lignes) {
  if (lignes.some((l) => !Number.isInteger(l.compte) || l.compte < 0)) throw new Error("Les quantités comptées doivent être des nombres entiers, 0 ou plus.");
  const r = await api("/comptages", { method: "POST", body: { lignes } });
  flash(r.ecarts ? `Comptage enregistré : ${r.ecarts} chiffre(s) corrigé(s).` : "Comptage enregistré : tout était juste.");
  return r;
}

async function sauverComptage() {
  const lignes = lignesSaisies();
  if (!lignes.length) throw new Error("Aucune quantité saisie.");
  await enregistrerComptage(lignes);
  etat.comptage = null;
  await pageStock();
}

// ───────────── Réglages : familles et pièces ─────────────
async function pageReglages() {
  [etat.familles, etat.stock] = await Promise.all([api("/familles"), api("/stock")]);
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

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, familles, pieces));
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

window.addEventListener("hashchange", () => { etat.comptage = null; etat.ligneEnCours = null; etat.edition = null; afficher(); });
afficher();
