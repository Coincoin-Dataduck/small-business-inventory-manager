// Verrou Cloudflare Access : toute requête (pages et API) doit porter un jeton Access valide
// (signature vérifiée avec les clés publiques de l'équipe, audience et expiration contrôlées).
// Tant qu'Access n'est pas configuré (ACCESS_TEAM_DOMAIN / ACCESS_AUD), tout est refusé.
// En local uniquement : ACCES_LOCAL_SANS_CONTROLE=1 dans .dev.vars.
import type { Env } from "./outils";

type Jwk = JsonWebKey & { kid: string };
let cles: { domaine: string; keys: Jwk[]; lu: number } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function clesPubliques(domaine: string, forcer = false) {
  if (!forcer && cles && cles.domaine === domaine && Date.now() - cles.lu < 3_600_000) return cles.keys;
  const r = await fetch(`https://${domaine}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("Clés Access illisibles");
  cles = { domaine, keys: ((await r.json()) as { keys: Jwk[] }).keys, lu: Date.now() };
  return cles.keys;
}

export async function jetonValide(jeton: string, domaine: string, aud: string): Promise<boolean> {
  const [h, p, sig] = jeton.split(".");
  if (!h || !p || !sig) return false;
  const entete = JSON.parse(new TextDecoder().decode(b64url(h)));
  const charge = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (entete.alg !== "RS256") return false;
  let cle = (await clesPubliques(domaine)).find((k) => k.kid === entete.kid);
  if (!cle) cle = (await clesPubliques(domaine, true)).find((k) => k.kid === entete.kid);
  if (!cle) return false;
  const k = await crypto.subtle.importKey("jwk", cle, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return false;
  const auds = Array.isArray(charge.aud) ? charge.aud : [charge.aud];
  return auds.includes(aud) && charge.iss === `https://${domaine}` && typeof charge.exp === "number" && charge.exp * 1000 > Date.now();
}

/** null = accès autorisé ; sinon la réponse de refus. */
export async function controlerAcces(req: Request, env: Env): Promise<Response | null> {
  if (env.ACCES_LOCAL_SANS_CONTROLE === "1") return null;
  const api = new URL(req.url).pathname.startsWith("/api/");
  const refus = (message: string) => api
    ? Response.json({ erreur: message }, { status: 403 })
    : new Response(`<!doctype html><meta charset="utf-8"><title>Accès protégé</title><body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.5"><h1>Accès protégé</h1><p>${message}</p></body>`, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
    return refus("Cloudflare Access n'est pas encore activé sur cet outil : par sécurité, il reste fermé tant que ce n'est pas fait.");
  const cookie = req.headers.get("Cookie")?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const jeton = req.headers.get("Cf-Access-Jwt-Assertion") ?? cookie;
  if (!jeton) return refus("Connexion requise.");
  try {
    if (await jetonValide(jeton, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD)) return null;
  } catch {
    return refus("Vérification de la connexion impossible pour le moment. Réessayez.");
  }
  return refus("Connexion invalide ou expirée. Rechargez la page.");
}
