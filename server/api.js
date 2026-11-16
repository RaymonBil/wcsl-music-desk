// API de WCSL Music Desk: /api/me, /api/library, /api/changes, /api/audio/:id, /api/members.
// Cloudflare Access protege el sitio; aquí se vuelve a comprobar el token y el rol en cada petición.

import { readAccessToken, verifyAccessToken } from "./auth.js";
import {
  TRACK_ID,
  ensureSchema,
  getRole,
  getRevision,
  readLibraryJson,
  buildChangeStatements,
  markAudio,
  unmarkAudio,
  listMembers,
} from "./store.js";

const MAX_AUDIO_BYTES = 95 * 1024 * 1024; // límite de cuerpo del plan gratuito: 100 MB
const AUDIO_TYPES = /^audio\/[a-z0-9.+-]+$/i;

export function json(data, status = 200, headers = {}) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

const fail = (status, message) => json({ error: message }, status);

function isLocal(request) {
  const { hostname } = new URL(request.url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function identify(request, env, options = {}) {
  // Solo en desarrollo local y sin Access configurado se admite un correo de prueba.
  if (!env.ACCESS_AUD && env.DEV_EMAIL && isLocal(request))
    return { email: String(env.DEV_EMAIL).toLowerCase() };
  return verifyAccessToken(readAccessToken(request), {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    ...options,
  });
}

/** Calcula Content-Range a partir del rango que devuelve R2. */
export function contentRange(range, size) {
  if (!range) return null;
  let offset, length;
  if ("suffix" in range && range.suffix !== undefined) {
    length = Math.min(range.suffix, size);
    offset = size - length;
  } else {
    offset = range.offset ?? 0;
    length = range.length ?? size - offset;
  }
  if (offset === 0 && length === size) return null;
  return { offset, length, header: `bytes ${offset}-${offset + length - 1}/${size}` };
}

async function serveAudio(request, env, id) {
  const key = `audio/${id}`;
  if (request.method === "HEAD") {
    const head = await env.AUDIO.head(key);
    if (!head) return fail(404, "Audio no disponible");
    const headers = new Headers();
    head.writeHttpMetadata(headers);
    headers.set("Content-Length", String(head.size));
    headers.set("Accept-Ranges", "bytes");
    headers.set("ETag", head.httpEtag);
    return new Response(null, { status: 200, headers });
  }
  const object = await env.AUDIO.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return fail(404, "Audio no disponible");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  // El audio se identifica por su hash: nunca cambia, puede guardarse en caché del navegador.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
  const partial = request.headers.has("Range") ? contentRange(object.range, object.size) : null;
  if (partial) {
    headers.set("Content-Range", partial.header);
    headers.set("Content-Length", String(partial.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function uploadAudio(request, env, id, email) {
  const length = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(length) || length <= 0) return fail(411, "Falta el tamaño del archivo");
  if (length > MAX_AUDIO_BYTES) return fail(413, "Archivo demasiado grande (máximo 95 MB)");
  const type = request.headers.get("Content-Type") || "application/octet-stream";
  const contentType = AUDIO_TYPES.test(type) ? type : "audio/mpeg";
  try {
    // R2 comprueba el SHA-256 en el servidor: el archivo debe coincidir con su identificador.
    await env.AUDIO.put(`audio/${id}`, request.body, {
      httpMetadata: { contentType },
      sha256: id,
    });
  } catch (error) {
    return fail(400, "El archivo no coincide con su identificador o no se pudo guardar");
  }
  const updated = await markAudio(env.DB, id, length, contentType, email);
  return json({ ok: true, id, size: length, linked: updated > 0 });
}

export async function handleApi(request, env, options = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  if (!env.DB || !env.AUDIO) return fail(503, "Almacenamiento no configurado");
  let user;
  try {
    user = await identify(request, env, options);
  } catch (error) {
    return fail(401, "Inicia sesión para continuar");
  }
  await ensureSchema(env.DB);
  const role = await getRole(env.DB, user.email);
  if (!role) return fail(403, "Tu cuenta no tiene acceso a esta biblioteca");
  const admin = role === "admin";
  const needAdmin = () => fail(403, "Solo la gestión puede modificar la biblioteca");

  if (path === "me" && method === "GET") return json({ email: user.email, role });

  if (path === "library" && method === "GET") {
    const { revision, body } = await readLibraryJson(env.DB);
    const etag = `W/"rev-${revision}"`;
    if (request.headers.get("If-None-Match") === etag)
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
    return json(body, 200, { ETag: etag, "Cache-Control": "no-cache" });
  }

  if (path === "changes" && method === "POST") {
    if (!admin) return needAdmin();
    let changes;
    try {
      changes = await request.json();
    } catch {
      return fail(400, "Datos no válidos");
    }
    let statements;
    try {
      statements = buildChangeStatements(env.DB, changes, user.email);
    } catch (error) {
      return fail(400, error.message);
    }
    if (statements.length) await env.DB.batch(statements);
    return json({ ok: true, revision: await getRevision(env.DB) });
  }

  const audioMatch = path.match(/^audio\/([a-f0-9]{64})$/);
  if (audioMatch) {
    const id = audioMatch[1];
    if (method === "GET" || method === "HEAD") return serveAudio(request, env, id);
    if (method === "PUT") return admin ? uploadAudio(request, env, id, user.email) : needAdmin();
    if (method === "DELETE") {
      if (!admin) return needAdmin();
      await env.AUDIO.delete(`audio/${id}`);
      await unmarkAudio(env.DB, id);
      return json({ ok: true });
    }
    return fail(405, "Método no permitido");
  }

  if (path === "members" && method === "GET") {
    if (!admin) return needAdmin();
    return json({ members: await listMembers(env.DB) });
  }

  return fail(404, "Ruta no encontrada");
}

export { TRACK_ID };
