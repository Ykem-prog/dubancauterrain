// POST /api/login  {key, password} → pose le cookie admin (30 jours)
//   key = la clé du lien secret (ADMIN_LOGIN_KEY). Sans la bonne clé, réponse 404 comme si la route n'existait pas.
// POST /api/logout             → efface le cookie
// GET  /api/me                 → {admin: true|false}
import { store, json, fail, isAdmin, checkPassword, checkLoginKey, loginLocked, recordFail, clearFails, makeSession, setCookie, sameOrigin } from "../lib/shared.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/api/me" && req.method === "GET") return json({ admin: isAdmin(req) });
  if (req.method !== "POST" || !sameOrigin(req)) return fail(405, "Méthode non autorisée");

  if (path === "/api/logout") return json({ ok: true }, { headers: { "set-cookie": setCookie("adm", "", 0) } });

  if (path === "/api/login") {
    let body = {};
    try { body = await req.json(); } catch {}
    if (!checkLoginKey(body.key)) { await pause(400); return fail(404, "Introuvable"); }
    const s = store();
    if (await loginLocked(s)) return fail(429, "Trop d'essais : réessaie dans 15 minutes");
    if (!checkPassword(body.password || "")) {
      await recordFail(s);
      await pause(800); // freine les essais en série
      return fail(401, "Mot de passe incorrect");
    }
    await clearFails(s);
    const sess = makeSession();
    return json({ ok: true }, { headers: { "set-cookie": setCookie("adm", sess.value, sess.maxAge) } });
  }
  return fail(404, "Introuvable");
};

export const config = { path: ["/api/login", "/api/logout", "/api/me"] };
