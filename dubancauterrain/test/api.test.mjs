// Tests des fonctions avec un faux store en mémoire : `npm test`
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_PASSWORD = "mot-de-passe-de-test";
process.env.SESSION_SECRET = "s".repeat(40);
process.env.ADMIN_LOGIN_KEY = "cle-secrete-de-test-123";
const KEY = "cle-secrete-de-test-123";

class MemStore {
  constructor() { this.m = new Map(); this.n = 0; }
  async get(k, o = {}) { const e = this.m.get(k); if (!e) return null; return o.type === "json" ? JSON.parse(e.v) : e.v; }
  async getWithMetadata(k, o = {}) { const e = this.m.get(k); if (!e) return null; return { data: o.type === "json" ? JSON.parse(e.v) : e.v, etag: e.etag, metadata: e.meta }; }
  async set(k, v, o = {}) {
    const cur = this.m.get(k);
    if (o.onlyIfNew && cur) return { modified: false };
    if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
    const etag = '"' + ++this.n + '"'; this.m.set(k, { v, etag, meta: o.metadata }); return { modified: true, etag };
  }
  async setJSON(k, v, o) { return this.set(k, JSON.stringify(v), o); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) { return { blobs: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}
beforeEach(() => { globalThis.__TEST_STORE = new MemStore(); });

const state = (await import("../netlify/functions/state.mjs")).default;
const auth = (await import("../netlify/functions/auth.mjs")).default;
const vote = (await import("../netlify/functions/vote.mjs")).default;
const media = (await import("../netlify/functions/media.mjs")).default;

const req = (path, { method = "GET", body, cookie, headers = {} } = {}) =>
  new Request("https://dubancauterrain.ch" + path, {
    method, body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body),
    headers: { "x-dbat": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
  });
const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];

async function login() {
  const r = await auth(req("/api/login", { method: "POST", body: { key: KEY, password: "mot-de-passe-de-test" } }));
  assert.equal(r.status, 200);
  return cookieOf(r);
}

test("état par défaut lisible par tous", async () => {
  const r = await state(req("/api/state"));
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.state.profile.handle, "dubancauterrain");
  assert.deepEqual(b.votes, { yes: 0, no: 0 });
});

test("sans le lien secret, la connexion n'existe pas", async () => {
  const nokey = await auth(req("/api/login", { method: "POST", body: { password: "mot-de-passe-de-test" } }));
  assert.equal(nokey.status, 404);
  const wrongkey = await auth(req("/api/login", { method: "POST", body: { key: "pas-la-bonne-cle-x", password: "mot-de-passe-de-test" } }));
  assert.equal(wrongkey.status, 404);
});

test("blocage après 8 mots de passe ratés", async () => {
  for (let i = 0; i < 8; i++) {
    const r = await auth(req("/api/login", { method: "POST", body: { key: KEY, password: "faux" } }));
    assert.equal(r.status, 401);
  }
  const locked = await auth(req("/api/login", { method: "POST", body: { key: KEY, password: "mot-de-passe-de-test" } }));
  assert.equal(locked.status, 429);
});

test("mauvais mot de passe refusé, bon accepté", async () => {
  const bad = await auth(req("/api/login", { method: "POST", body: { key: KEY, password: "nope" } }));
  assert.equal(bad.status, 401);
  const c = await login();
  const me = await (await auth(req("/api/me", { cookie: c }))).json();
  assert.equal(me.admin, true);
  const anon = await (await auth(req("/api/me"))).json();
  assert.equal(anon.admin, false);
});

test("un visiteur ne peut pas modifier l'état", async () => {
  const r = await state(req("/api/state", { method: "PUT", body: { state: { checks: { w1d0: true } } } }));
  assert.equal(r.status, 401);
});

test("l'admin publie, l'état est nettoyé, et un etag périmé est refusé", async () => {
  const c = await login();
  const r1 = await state(req("/api/state", { method: "PUT", cookie: c, body: { state: { checks: { w1d0: true, w99d0: true, "x": true }, journal: { 1: { note: "Top", video: "javascript:alert(1)", media: [{ id: "../etc" }] } } }, etag: null } }));
  const b1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.deepEqual(b1.state.checks, { w1d0: true });
  assert.equal(b1.state.journal[1].video, "");
  assert.deepEqual(b1.state.journal[1].media, []);
  const stale = await state(req("/api/state", { method: "PUT", cookie: c, body: { state: { checks: {} }, etag: '"0"' } }));
  assert.equal(stale.status, 409);
  const ok = await state(req("/api/state", { method: "PUT", cookie: c, body: { state: { checks: { w1d1: true } }, etag: b1.etag } }));
  assert.equal(ok.status, 200);
});

test("un vote par navigateur, et on peut changer d'avis", async () => {
  const r1 = await vote(req("/api/vote", { method: "POST", body: { v: "yes" } }));
  const c = cookieOf(r1);
  assert.match(c, /^vid=[a-f0-9]{32}$/);
  assert.deepEqual((await r1.json()).votes, { yes: 1, no: 0 });
  const r2 = await vote(req("/api/vote", { method: "POST", cookie: c, body: { v: "yes" } }));
  assert.deepEqual((await r2.json()).votes, { yes: 1, no: 0 });
  const r3 = await vote(req("/api/vote", { method: "POST", cookie: c, body: { v: "no" } }));
  assert.deepEqual((await r3.json()).votes, { yes: 0, no: 1 });
  const mine = await (await vote(req("/api/vote", { cookie: c }))).json();
  assert.equal(mine.mine, "no");
  const other = await vote(req("/api/vote", { method: "POST", body: { v: "yes" } }));
  assert.deepEqual((await other.json()).votes, { yes: 1, no: 1 });
  const bad = await vote(req("/api/vote", { method: "POST", body: { v: "maybe" } }));
  assert.equal(bad.status, 400);
});

test("vote fermé par l'admin", async () => {
  const c = await login();
  await state(req("/api/state", { method: "PUT", cookie: c, body: { state: { checks: {}, poll: { open: false } }, etag: null } }));
  const r = await vote(req("/api/vote", { method: "POST", body: { v: "yes" } }));
  assert.equal(r.status, 403);
});

test("médias : envoi réservé à l'admin, types filtrés, lecture publique", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const anon = await media(req("/api/media", { method: "POST", body: png, headers: { "content-type": "image/png" } }));
  assert.equal(anon.status, 401);
  const c = await login();
  const svg = await media(req("/api/media", { method: "POST", cookie: c, body: "<svg/>", headers: { "content-type": "image/svg+xml" } }));
  assert.equal(svg.status, 415);
  const up = await media(req("/api/media", { method: "POST", cookie: c, body: png, headers: { "content-type": "image/png" } }));
  const { id } = await up.json();
  assert.match(id, /^[a-f0-9]{32}$/);
  const get = await media(req("/media/" + id), { params: { id } });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/png");
  const missing = await media(req("/media/../state"), { params: { id: "../state" } });
  assert.equal(missing.status, 404);
});
