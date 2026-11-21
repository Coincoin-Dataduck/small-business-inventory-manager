#!/usr/bin/env bash
# Vérification avant toute mise en ligne (npm run deploy la lance d'abord ; si elle échoue, rien n'est déployé).
# 1. types TypeScript et syntaxe de l'interface ; 2. base locale neuve (migrations + données fictives) ;
# 3. serveur local ; 4. chaque page ouverte dans un navigateur : aucune erreur JavaScript, aucune API en erreur.
set -euo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false
PORT=${PORT:-8799}
D=$(mktemp -d)
JOURNAL="$D/serveur.log"
nettoyer() { [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null; pkill -f "wrangler dev --port $PORT" 2>/dev/null || true; rm -rf "$D"; }
trap nettoyer EXIT

npx tsc --noEmit
node --check public/app.js
for f in migrations/*.sql; do
  npx wrangler d1 execute stock-hervine --local --persist-to "$D/etat" --file "$f" >/dev/null 2>&1 || { echo "✘ migration $f"; exit 1; }
done
npx wrangler d1 execute stock-hervine --local --persist-to "$D/etat" --file scripts/verifier/donnees.sql >/dev/null 2>&1 || { echo "✘ données de test"; exit 1; }

npx wrangler dev --port "$PORT" --persist-to "$D/etat" --var ACCES_LOCAL_SANS_CONTROLE:1 >"$JOURNAL" 2>&1 &
PID=$!
for _ in $(seq 1 60); do curl -s "http://localhost:$PORT/api/version" >/dev/null 2>&1 && break; sleep 1; done
curl -s "http://localhost:$PORT/api/version" >/dev/null || { echo "✘ le serveur local ne démarre pas"; tail -20 "$JOURNAL"; exit 1; }

node scripts/verifier/pages.cjs "http://localhost:$PORT" || { echo "--- journal du serveur ---"; grep -i "error\|✘" "$JOURNAL" | tail -20; exit 1; }
