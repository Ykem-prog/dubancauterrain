// GET  /api/state  → état public du site + décompte des votes (mis en cache 20 s sur le CDN)
// PUT  /api/state  → admin : remplace l'état, refusé si quelqu'un a écrit entre-temps
import { store, json, fail, isAdmin, sameOrigin, cleanState, countVotes, DEFAULT_STATE } from "../lib/shared.mjs";

export default async (req) => {
  const s = store();
  if (req.method === "GET") {
    const found = await s.getWithMetadata("state", { type: "json" });
    const votes = await countVotes(s);
    const admin = isAdmin(req);
    return json(
      { state: found ? found.data : DEFAULT_STATE, etag: found ? found.etag : null, votes },
      // les visiteurs reçoivent une copie CDN récente ; l'admin lit toujours la version exacte
      { headers: admin ? {} : { "cache-control": "public, max-age=0, must-revalidate", "netlify-cdn-cache-control": "public, s-maxage=20, stale-while-revalidate=60" } }
    );
  }
  if (req.method === "PUT") {
    if (!isAdmin(req) || !sameOrigin(req)) return fail(401, "Connexion admin requise");
    const raw = await req.text();
    if (raw.length > 200_000) return fail(413, "Données trop volumineuses");
    let body;
    try { body = JSON.parse(raw); } catch { return fail(400, "JSON invalide"); }
    const next = cleanState(body.state);
    const opts = body.etag ? { onlyIfMatch: body.etag } : { onlyIfNew: true };
    const res = await s.setJSON("state", next, opts);
    if (!res.modified) return fail(409, "Le site a été modifié ailleurs : recharge la page");
    return json({ ok: true, etag: res.etag, state: next });
  }
  return fail(405, "Méthode non autorisée");
};

export const config = { path: "/api/state" };
