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
const etat = {
  page: "stock", filtre: null, comptage: null, ligneEnCours: null, stock: [], familles: [], edition: null,
  etapes: [], editeur: null, fait: null, faites: [],
};

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
    if (etat.page === "atelier") await pageAtelier();
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
  [etat.familles, etat.stock, etat.etapes] = await Promise.all([api("/familles"), api("/stock"), api("/etapes")]);
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

  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, familles, pieces, ...sectionsRecettes()));
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
  [etat.etapes, etat.stock, etat.faites] = await Promise.all([api("/etapes"), api("/stock"), api("/etapes-faites")]);
  dessinerAtelier();
}

function stockDe(id) {
  return toutesPieces().find((p) => p.id === id)?.stock ?? 0;
}

function dessinerAtelier() {
  entete("Atelier");
  const page = document.getElementById("page");
  const intro = h("div", { class: "note" },
    "Toutes les étapes, famille par famille. Les étapes à faire en priorité pour le prochain salon apparaîtront ici quand les salons et objectifs seront en place.");
  if (!etat.etapes.length) {
    page.replaceChildren(intro, h("div", { class: "carte" }, h("div", { class: "vide" }, "Aucune recette. Décrivez les étapes dans ", h("a", { href: "#reglages" }, "Réglages"), ".")));
    return;
  }
  const cartes = etat.stock.filter((f) => etat.etapes.some((e) => e.famille_id === f.id)).map((f) =>
    h("section", { class: "carte" }, h("h2", {}, f.nom),
      h("div", { class: "liste-etapes" }, etat.etapes.filter((e) => e.famille_id === f.id).map(carteEtape))));
  const historique = etat.faites.length ? h("section", { class: "carte" }, h("h2", {}, "Dernières saisies"),
    h("table", { class: "tbl" }, h("tbody", {}, etat.faites.map((x) => h("tr", {},
      h("td", {}, new Date(x.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })),
      h("td", { style: "font-weight:600" }, x.nom), h("td", { class: "num" }, "× " + x.fois),
      h("td", { class: "col-action" }, h("div", { class: "actions-ligne" }, h("button", { class: "btn-petit", onclick: () => tenter(async () => {
        if (!confirm(`Annuler la saisie « ${x.nom} × ${x.fois} » ? Les pièces utilisées reviennent en stock, les pièces obtenues sont retirées.`)) return;
        await api("/etapes-faites/" + x.id, { method: "DELETE" });
        flash("Saisie annulée.");
        await pageAtelier();
      }) }, "Annuler cette saisie")))))))) : null;
  page.replaceChildren(h("div", { style: "display:flex;flex-direction:column;gap:18px" }, intro, ...cartes, historique));
}

function carteEtape(e) {
  const utilise = e.utilise.map((u) => u.suivi === "quantite"
    ? h("li", {}, `${u.quantite} ${u.nom}`, h("span", { class: "note" }, ` · en stock : ${stockDe(u.piece_id)}`))
    : h("li", {}, `${u.nom}`, h("span", { class: "note" }, " · sans quantité")));
  const enCours = etat.fait && etat.fait.etape_id === e.id;
  return h("div", { class: "etape" },
    h("div", { class: "etape-tete" },
      h("div", {}, h("strong", {}, e.nom), h("div", { class: "note", style: "font-size:13px" }, (e.mode === "par_matiere" ? "Par matière entière" : "À la pièce") + " · " + texteTemps(e))),
      enCours ? null : h("button", { class: "btn-sec", disabled: !!etat.fait, onclick: () => { etat.fait = { etape_id: e.id, fois: "1", donne: {}, touche: new Set(), manque: null, comptages: {} }; dessinerAtelier(); } }, "C'est fait…")),
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

window.addEventListener("hashchange", () => {
  Object.assign(etat, { comptage: null, ligneEnCours: null, edition: null, editeur: null, fait: null });
  afficher();
});
afficher();
