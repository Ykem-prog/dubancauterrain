// GET  /api/vote        → {mine: "yes"|"no"|null}
// POST /api/vote {v}    → enregistre ou change le vote de ce navigateur
// Un vote par navigateur (cookie "vid"). Ce n'est pas infaillible, mais ça suffit pour un sondage de compte TikTok.
import { store, json, fail, cookies, setCookie, newId, countVotes } from "../lib/shared.mjs";

const VID = /^[a-f0-9]{32}$/;
const YEAR = 365 * 86400;

async function mine(s, vid) {
  if (!vid) return null;
  if (await s.get(`votes/yes/${vid}`)) return "yes";
  if (await s.get(`votes/no/${vid}`)) return "no";
  return null;
}

export default async (req) => {
  const s = store();
  const c = cookies(req);
  const vid = VID.test(c.vid || "") ? c.vid : null;

  if (req.method === "GET") return json({ mine: await mine(s, vid) });

  if (req.method === "POST") {
    if (req.headers.get("x-dbat") !== "1") return fail(400, "Requête invalide");
    const state = await s.get("state", { type: "json" });
    if (state && state.poll && state.poll.open === false) return fail(403, "Le vote est fermé");
    let v = "";
    try { v = (await req.json()).v; } catch {}
    if (v !== "yes" && v !== "no") return fail(400, "Vote invalide");
    const id = vid || newId();
    const other = v === "yes" ? "no" : "yes";
    await s.delete(`votes/${other}/${id}`);
    await s.set(`votes/${v}/${id}`, String(Date.now()));
    const headers = vid ? {} : { "set-cookie": setCookie("vid", id, YEAR).replace("SameSite=Strict", "SameSite=Lax") };
    return json({ ok: true, mine: v, votes: await countVotes(s) }, { headers });
  }
  return fail(405, "Méthode non autorisée");
};

export const config = { path: "/api/vote" };
