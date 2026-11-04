// POST /api/media      → admin : envoie une photo ou une courte vidéo, renvoie {id}
// GET  /media/:id      → sert le fichier (mis en cache longtemps, il ne change jamais)
import { store, json, fail, isAdmin, sameOrigin, newId, MEDIA_ID } from "../lib/shared.mjs";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"]);
// Les fonctions Netlify acceptent environ 6 Mo par requête : on garde une marge.
const MAX = 4.5 * 1024 * 1024;

export default async (req, context) => {
  const s = store();
  if (req.method === "GET") {
    const id = context?.params?.id || new URL(req.url).pathname.split("/").pop();
    if (!MEDIA_ID.test(id)) return fail(404, "Introuvable");
    const found = await s.getWithMetadata(`media/${id}`, { type: "arrayBuffer" });
    if (!found) return fail(404, "Introuvable");
    return new Response(found.data, {
      headers: {
        "content-type": found.metadata?.type || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  }
  if (req.method === "POST") {
    if (!isAdmin(req) || !sameOrigin(req)) return fail(401, "Connexion admin requise");
    const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(type)) return fail(415, "Format non accepté : JPEG, PNG, WebP, GIF, MP4 ou MOV");
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return fail(400, "Fichier vide");
    if (buf.byteLength > MAX) return fail(413, "Fichier trop lourd (4,5 Mo max)");
    const id = newId();
    await s.set(`media/${id}`, buf, { metadata: { type, size: buf.byteLength, at: Date.now() } });
    return json({ ok: true, id, kind: type.startsWith("video/") ? "video" : "image" });
  }
  return fail(405, "Méthode non autorisée");
};

export const config = { path: ["/api/media", "/media/:id"] };
