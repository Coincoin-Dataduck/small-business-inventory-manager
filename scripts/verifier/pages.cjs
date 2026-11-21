// Ouvre chaque page dans un navigateur et échoue à la moindre erreur JavaScript ou réponse d'API en erreur.
// Lancé par scripts/verifier.sh ; argument : adresse du serveur local.
const { chromium } = require("playwright");
const base = process.argv[2];
const PAGES = ["accueil", "stock", "preparation", "salons", "questions", "reglages", "reglages/recettes", "recettes", "atelier"];

(async () => {
  const navigateur = await chromium.launch();
  const p = await navigateur.newPage({ viewport: { width: 1300, height: 900 } });
  const erreurs = [];
  let page = "";
  p.on("pageerror", (e) => erreurs.push(`[${page}] erreur JavaScript : ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(`[${page}] console : ${m.text()}`); });
  p.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) erreurs.push(`[${page}] API ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`); });
  const flash = async () => {
    const f = p.locator("#flash.erreur:not([hidden])");
    if (await f.count()) erreurs.push(`[${page}] message d'erreur affiché : ${await f.innerText()}`);
  };
  const attendre = () => p.waitForLoadState("networkidle").then(() => p.waitForTimeout(300));

  // Chaque page, ouverte directement puis depuis une autre (le passage Préparation → Accueil a déjà planté).
  for (const x of PAGES) { page = x; await p.goto(`${base}/#${x}`); await attendre(); await flash(); }
  for (const x of PAGES) { page = "via menu → " + x; await p.evaluate((h) => { location.hash = h; }, x); await attendre(); await flash(); }

  // Bilan du salon passé.
  page = "bilan";
  const salons = await (await p.request.get(`${base}/api/salons`)).json();
  const passe = (salons.salons ?? salons).find?.((s) => s.nom === "Salon passé test");
  if (!passe) erreurs.push("[bilan] salon passé de test introuvable dans /api/salons");
  else { await p.goto(`${base}/#bilan/${passe.id}`); await attendre(); await flash(); }

  // Préparation : quelques saisies (nombre à produire, vérification, checklist).
  page = "preparation (saisies)";
  await p.goto(`${base}/#preparation`); await attendre();
  // L'article de test n'a pas de conseil : sa ligne est repliée dans « N autres ».
  const bascule = p.locator("#pr-produire .pr-bascule").first();
  if (await bascule.count()) await bascule.click();
  const champ = p.locator("#pr-produire .pr-q[aria-label=\"À produire : Article test\"]");
  if (!(await champ.count())) erreurs.push("[preparation] aucun champ « à produire » : la préparation ne s'affiche pas");
  else { await champ.fill("4"); await champ.press("Tab"); await attendre(); await flash(); }
  const verif = p.locator("#pr-verifier .pr-q").first();
  if (!(await verif.count())) erreurs.push("[preparation] aucune fourniture à vérifier (attendu : Fourniture test)");
  else { await verif.fill("2"); await verif.press("Enter"); await attendre(); await flash(); }
  const fait = p.locator("#pr-checklist button", { hasText: "c'est fait" }).first();
  if (!(await fait.count())) erreurs.push("[preparation] aucune ligne « c'est fait »");
  else { await fait.click(); await attendre(); await flash(); }
  page = "accueil après préparation"; await p.evaluate(() => { location.hash = "accueil"; }); await attendre(); await flash();

  await navigateur.close();
  if (erreurs.length) { console.error("✘ Vérification des pages : " + erreurs.length + " problème(s)\n" + erreurs.join("\n")); process.exit(1); }
  console.log(`✔ Vérification des pages : ${PAGES.length} pages, bilan et saisies de préparation sans erreur.`);
})().catch((e) => { console.error("✘ " + e.message); process.exit(1); });
