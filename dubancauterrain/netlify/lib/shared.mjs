// Outils partagés par les fonctions : stockage, session admin, réponses JSON, validation.
import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual, randomBytes, createHash } from "node:crypto";

// Un seul store pour tout le site. Les tests injectent un faux store via globalThis.__TEST_STORE.
export function store() {
  if (globalThis.__TEST_STORE) return globalThis.__TEST_STORE;
  return getStore({ name: "dubancauterrain", consistency: "strong" });
}

export const env = (k) => process.env[k] || "";

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}
export const fail = (status, error) => json({ error }, { status });

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

// --- Session admin : "expiration.signature" signé avec SESSION_SECRET ---
const SESSION_DAYS = 30;
function sign(payload) {
  const secret = env("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET manquant ou trop court (32 caractères minimum)");
  return createHmac("sha256", secret).update(payload).digest("hex");
}
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
export function makeSession() {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return { value: `${exp}.${sign(exp)}`, maxAge: SESSION_DAYS * 86400 };
}
export function isAdmin(req) {
  const tok = cookies(req).adm;
  if (!tok) return false;
  const [exp, sig] = tok.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  try { return same(sig, sign(exp)); } catch { return false; }
}
export function checkPassword(pw) {
  const expected = env("ADMIN_PASSWORD");
  if (expected.length < 10) return false; // refuse un mot de passe absent ou trop faible
  const h = (s) => createHash("sha256").update(String(s)).digest();
  return timingSafeEqual(h(pw), h(expected));
}
// Clé du lien de connexion secret : sans elle, l'espace admin "n'existe pas" (404).
export function checkLoginKey(k) {
  const expected = env("ADMIN_LOGIN_KEY");
  if (expected.length < 16) return false; // connexion désactivée tant que la clé n'est pas configurée
  const h = (x) => createHash("sha256").update(String(x || "")).digest();
  return timingSafeEqual(h(k), h(expected));
}
// Blocage : après 8 mots de passe ratés en 15 minutes, plus aucun essai pendant 15 minutes.
const LOCK_MAX = 8, LOCK_MS = 15 * 60 * 1000;
export async function loginLocked(s) {
  const f = await s.get("auth/fails", { type: "json" });
  return !!(f && f.count >= LOCK_MAX && Date.now() - f.since < LOCK_MS);
}
export async function recordFail(s) {
  const f = await s.get("auth/fails", { type: "json" });
  const fresh = !f || Date.now() - f.since >= LOCK_MS;
  await s.setJSON("auth/fails", fresh ? { count: 1, since: Date.now() } : { count: f.count + 1, since: f.since });
}
export const clearFails = (s) => s.delete("auth/fails");

// Les écritures admin exigent cet en-tête en plus du cookie SameSite=Strict.
export const sameOrigin = (req) => req.headers.get("x-dbat") === "1";

export async function countVotes(s) {
  const [yes, no] = await Promise.all([s.list({ prefix: "votes/yes/" }), s.list({ prefix: "votes/no/" })]);
  return { yes: yes.blobs.length, no: no.blobs.length };
}

export const newId = () => randomBytes(16).toString("hex");
export const MEDIA_ID = /^[a-f0-9]{32}$/;

// --- Validation de l'état publié ---
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
export function cleanState(input) {
  const s = input && typeof input === "object" ? input : {};
  const checks = {};
  for (const [k, v] of Object.entries(s.checks || {})) if (/^w(1[0-3]|[1-9])d[0-6]$/.test(k) && v === true) checks[k] = true;
  const journal = {};
  for (const [w, j] of Object.entries(s.journal || {})) {
    if (!/^(1[0-3]|[1-9])$/.test(w) || !j || typeof j !== "object") continue;
    const media = (Array.isArray(j.media) ? j.media : [])
      .filter((m) => m && MEDIA_ID.test(m.id))
      .slice(0, 12)
      .map((m) => ({ id: m.id, kind: m.kind === "video" ? "video" : "image" }));
    const video = /^https:\/\/(www\.|vm\.)?tiktok\.com\//.test(str(j.video, 300)) ? str(j.video, 300) : "";
    const entry = { note: str(j.note, 1200), weight: str(j.weight, 8), video, media };
    if (entry.note || entry.weight || entry.video || media.length) journal[w] = entry;
  }
  const p = s.profile || {};
  const profile = {
    name: str(p.name, 40) || "Valentin",
    handle: str(p.handle, 30).replace(/^@/, "").replace(/[^\w.]/g, ""),
    bio: str(p.bio, 400),
    goalWeight: str(p.goalWeight, 8) || null,
  };
  const poll = s.poll && typeof s.poll === "object" ? { open: s.poll.open !== false } : { open: true };
  return { checks, journal, profile, poll };
}
export const DEFAULT_STATE = cleanState({
  profile: {
    name: "Valentin",
    handle: "dubancauterrain",
    bio: "Ailier, peu de temps de jeu au premier tour. Cet hiver je m'entraîne chaque jour pendant 13 semaines pour gagner ma place au deuxième tour.",
  },
});
