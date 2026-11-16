# Stock Hervine

Outil de gestion de stock pour la boutique de créatrice d'Hervine (salons + SumUp).
Conception : `docs/`. Consignes pour Claude Code : `CLAUDE.md`.

## Démarrage dans Claude Code sur le web
Environnement cloud personnel :
- Accès réseau **Custom** : domaines par défaut + `api.sumup.com`, `api.cloudflare.com`
- Clés : enregistrées comme **secrets réseau** de l'environnement (hôte `api.sumup.com`, en-tête `Authorization`, préfixe `Bearer` ; idem plus tard pour `api.cloudflare.com`). Le réseau de la session ajoute la clé aux appels : aucune variable ne la contient.
- Variable simple (non secrète) à prévoir pour le déploiement : `CLOUDFLARE_ACCOUNT_ID`

Test SumUp : `SUMUP_API_KEY=proxy-injected python3 scripts/test_sumup.py` (valeur bidon, remplacée par la vraie clé au passage).

## Lancer en local
```bash
npm install
npm run db:local   # crée la base locale (migrations/)
npm run dev        # http://localhost:8787
```
Structure : `src/index.ts` (API du Worker), `public/` (pages), `migrations/` (base D1, voir `docs/donnees.md`).

## En ligne
- Adresse : https://stock-hervine.clef-fontaine.workers.dev (fermée tant que Cloudflare Access n'est pas activé).
- Base D1 `stock-hervine` (Europe de l'Ouest). Import SumUp toutes les 15 minutes (cron).
- Secret du Worker à saisir dans le tableau de bord Cloudflare : `SUMUP_API_KEY`.
- Variables `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD` dans `wrangler.jsonc` une fois Access activé.
- Déployer depuis une session cloud : `CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler deploy`.
- En local, sans Access : `ACCES_LOCAL_SANS_CONTROLE=1` dans `.dev.vars` (jamais en ligne).
