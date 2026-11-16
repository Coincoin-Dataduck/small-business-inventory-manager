#!/usr/bin/env python3
"""Test de l'API SumUp pour l'outil de stock d'Hervine.

Lecture seule : ce script ne crée, ne modifie et ne rembourse rien.
Il répond à trois questions :
  1. Les ventes (caisse ET boutique en ligne) sortent-elles avec le détail des articles ?
  2. Les articles ont-ils un identifiant stable, ou seulement un nom ?
  3. Comment apparaissent remises et remboursements ?

Utilisation (aucune installation nécessaire, Python 3.8+) :
  macOS / Linux :  SUMUP_API_KEY="sup_sk_..." python3 test_sumup.py
  Windows (PowerShell) :  $env:SUMUP_API_KEY="sup_sk_..." ; python test_sumup.py

Il écrit un fichier sumup_test_resultat.json à côté de lui, à m'envoyer.
Ce fichier ne contient ni la clé, ni numéros de carte, ni noms ou e-mails de clients :
seulement la structure des données et les noms/prix des articles.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.sumup.com"
KEY = os.environ.get("SUMUP_API_KEY", "").strip()
if not KEY:
    sys.exit("Variable SUMUP_API_KEY absente. Voir l'en-tête du script.")

# Champs jamais recopiés, même s'ils existent
SENSITIVE = {"card", "last_4_digits", "card_type", "cardholder_name", "email", "phone",
             "customer", "customer_id", "auth_code", "verification_method", "lat", "lon",
             "location", "horizontal_accuracy", "payer", "billing_address", "shipping_address",
             "address", "name_on_card", "token", "personal_details"}


def get(path, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + KEY, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        return e.code, {"erreur": body}
    except Exception as e:  # réseau, etc.
        return 0, {"erreur": str(e)}


def clean(x):
    if isinstance(x, dict):
        return {k: ("<masqué>" if k in SENSITIVE else clean(v)) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x[:30]]
    return x


def shape(x, depth=0):
    """Structure seule : noms des champs et types."""
    if depth > 4:
        return "…"
    if isinstance(x, dict):
        return {k: ("<masqué>" if k in SENSITIVE else shape(v, depth + 1)) for k, v in x.items()}
    if isinstance(x, list):
        return [shape(x[0], depth + 1)] if x else []
    return type(x).__name__


out = {"etapes": []}

# 1) Profil marchand → merchant_code
st, me = get("/v0.1/me")
out["etapes"].append({"appel": "GET /v0.1/me", "statut": st})
merchant = None
if st == 200 and isinstance(me, dict):
    merchant = (me.get("merchant_profile") or {}).get("merchant_code")
out["merchant_code_trouve"] = bool(merchant)
if not merchant:
    out["me_structure"] = shape(me)
    json.dump(out, open("sumup_test_resultat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    sys.exit("Impossible de lire le profil marchand (statut %s). Envoie-moi sumup_test_resultat.json." % st)

# 2) Historique des transactions récentes (dont le salon des 14–15/11)
st, hist = get("/v2.1/merchants/%s/transactions/history" % merchant,
               {"limit": 100, "order": "descending", "oldest_time": "2026-11-01T00:00:00Z"})
out["etapes"].append({"appel": "GET /v2.1/merchants/{mc}/transactions/history", "statut": st})
items = (hist or {}).get("items", []) if isinstance(hist, dict) else []
out["historique_nb"] = len(items)
out["historique_structure_d_un_element"] = shape(items[0]) if items else None
out["historique_valeurs"] = sorted({(i.get("type"), i.get("status"), i.get("payment_type"), i.get("entry_mode"))
                                    for i in items if isinstance(i, dict)}, key=str)
out["historique_valeurs"] = [list(map(str, v)) for v in out["historique_valeurs"]]

# Choisir quelques transactions variées : différents types / moyens, plus d'éventuelles ventes en ligne
picked, seen = [], set()
for i in items:
    k = (i.get("type"), i.get("payment_type"), i.get("entry_mode"), i.get("status"))
    if k not in seen:
        seen.add(k)
        picked.append(i)
picked = (picked + [i for i in items if i not in picked])[:6]

out["details"] = []
for i in picked:
    tid, code = i.get("id"), i.get("transaction_code")
    d = {"type": i.get("type"), "status": i.get("status"), "payment_type": i.get("payment_type"),
         "entry_mode": i.get("entry_mode"), "montant": i.get("amount")}
    st1, full = get("/v2.1/merchants/%s/transactions" % merchant, {"id": tid} if tid else {"transaction_code": code})
    d["transaction_complete_statut"] = st1
    if st1 == 200 and isinstance(full, dict):
        d["transaction_complete_structure"] = shape(full)
        d["transaction_complete_produits"] = clean(full.get("products"))
        d["transaction_complete_evenements"] = clean(full.get("events") or full.get("transaction_events"))
    st2, rc = get("/v1.1/receipts/%s" % (code or tid), {"mid": merchant})
    d["recu_statut"] = st2
    if st2 == 200 and isinstance(rc, dict):
        tdata = rc.get("transaction_data") or {}
        d["recu_structure"] = shape(rc)
        d["recu_produits"] = clean(tdata.get("products"))
    out["details"].append(d)

# 3) Catalogue : les articles ont-ils un identifiant ? (endpoint non garanti, on essaie)
for path in ["/v0.1/me/products", "/v0.1/merchants/%s/products" % merchant, "/v0.1/merchants/%s/items" % merchant]:
    st, cat = get(path, {"limit": 5})
    out["etapes"].append({"appel": "GET " + path.replace(merchant, "{mc}"), "statut": st})
    if st == 200:
        out["catalogue_structure"] = shape(cat)
        out["catalogue_exemple"] = clean(cat if not isinstance(cat, dict) else cat.get("items", cat))
        break

json.dump(out, open("sumup_test_resultat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("Terminé : %d transactions lues, %d détaillées." % (len(items), len(out["details"])))
print("Envoie-moi le fichier sumup_test_resultat.json (il ne contient pas ta clé).")
