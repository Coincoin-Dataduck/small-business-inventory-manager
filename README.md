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
