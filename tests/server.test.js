import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FakeD1, FakeR2, createAccessIssuer } from "./helpers/cloudflare-shims.js";
import { handleApi, contentRange } from "../server/api.js";
import { clearKeyCache, verifyAccessToken } from "../server/auth.js";
import { ensureSchema, hashKey } from "../server/store.js";

const TEAM = "https://equipo-prueba.cloudflareaccess.com";
const AUD = "aud-prueba";
const ADMIN = "gestion@example.com";
const VIEWER = "reproductor@example.com";
const issuer = await createAccessIssuer(TEAM, AUD);
let env;

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const audioBytes = new TextEncoder().encode("ID3 audio de prueba ".repeat(50));
const audioId = sha(audioBytes);
const track = (id, extra = {}) => ({ id, title: "Tema", artist: "Artista", bpm: 96, speed: 0.9, ...extra });

async function call(path, { email = ADMIN, method = "GET", body, headers = {}, token } = {}) {
  const auth = token ?? (email ? await issuer.sign({ email }) : null);
  const request = new Request(`https://wcsl-music-desk.pages.dev/api/${path}`, {
    method,
    body,
    headers: { ...(auth ? { "Cf-Access-Jwt-Assertion": auth } : {}), ...headers },
  });
  return handleApi(request, env, { fetchKeys: issuer.fetchKeys });
}

beforeEach(async () => {
  clearKeyCache();
  env = { DB: new FakeD1(), AUDIO: new FakeR2(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  await ensureSchema(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO members (email, role) VALUES (?, 'admin')").bind(ADMIN),
    env.DB.prepare("INSERT INTO members (email, role) VALUES (?, 'viewer')").bind(VIEWER),
  ]);
});

test("sin token, con token falso o de otra app: 401", async () => {
  assert.equal((await call("me", { email: null })).status, 401);
  assert.equal((await call("me", { token: "a.b.c" })).status, 401);
  const other = await (await createAccessIssuer(TEAM, AUD)).sign({ email: ADMIN });
  assert.equal((await call("me", { token: other })).status, 401, "firma de otra clave");
  const wrongAud = await issuer.sign({ email: ADMIN, aud: ["otra-app"] });
  assert.equal((await call("me", { token: wrongAud })).status, 401);
  const expired = await issuer.sign({ email: ADMIN, exp: Math.floor(Date.now() / 1000) - 600 });
  assert.equal((await call("me", { token: expired })).status, 401);
});

test("correo válido pero no autorizado: 403", async () => {
  assert.equal((await call("me", { email: "intrusa@example.com" })).status, 403);
});

test("me devuelve correo y rol, sin distinguir mayúsculas", async () => {
  const res = await call("me", { email: "Gestion@Example.com" });
  assert.deepEqual(await res.json(), { email: ADMIN, role: "admin" });
  assert.equal((await (await call("me", { email: VIEWER })).json()).role, "viewer");
});

test("sin Access configurado no se abre nada fuera de localhost", async () => {
  env.ACCESS_AUD = "";
  env.DEV_EMAIL = ADMIN;
  assert.equal((await call("me")).status, 401);
});

test("gestión guarda canciones y listas; la biblioteca las devuelve en orden", async () => {
  const id2 = sha(new TextEncoder().encode("otro"));
  const res = await call("changes", {
    method: "POST",
    body: JSON.stringify({
      tracks: [track(audioId), track(id2, { title: "Segundo", blob: "no se guarda" })],
      playlists: [
        { id: "warmup", name: "Calentamiento", trackIds: [id2, audioId, id2, "basura"] },
        { id: "social", name: "Social", trackIds: [] },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const lib = await (await call("library", { email: VIEWER })).json();
  assert.equal(lib.revision, 1);
  assert.equal(lib.tracks.length, 2);
  assert.equal(lib.tracks[1].track.title, "Segundo");
  assert.equal(lib.tracks[1].track.blob, undefined);
  assert.equal(lib.tracks[0].hasAudio, false);
  assert.deepEqual(lib.playlists.map((l) => l.id), ["warmup", "social"]);
  assert.deepEqual(lib.playlists[0].trackIds, [id2, audioId], "sin duplicados ni ids inválidos");
});

test("la biblioteca responde 304 si no ha cambiado", async () => {
  const first = await call("library");
  const etag = first.headers.get("ETag");
  assert.equal((await call("library", { headers: { "If-None-Match": etag } })).status, 304);
});

test("reproducción no puede modificar nada", async () => {
  const change = await call("changes", {
    email: VIEWER,
    method: "POST",
    body: JSON.stringify({ tracks: [track(audioId)] }),
  });
  assert.equal(change.status, 403);
  const upload = await call(`audio/${audioId}`, {
    email: VIEWER,
    method: "PUT",
    body: audioBytes,
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audioBytes.length) },
  });
  assert.equal(upload.status, 403);
  assert.equal((await call(`audio/${audioId}`, { email: VIEWER, method: "DELETE" })).status, 403);
  assert.equal((await call("members", { email: VIEWER })).status, 403);
});

test("subida de audio: se comprueba el hash y se marca la canción", async () => {
  await call("changes", { method: "POST", body: JSON.stringify({ tracks: [track(audioId)] }) });
  const wrong = new TextEncoder().encode("otro contenido");
  const bad = await call(`audio/${audioId}`, {
    method: "PUT",
    body: wrong,
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(wrong.length) },
  });
  assert.equal(bad.status, 400);
  const ok = await call(`audio/${audioId}`, {
    method: "PUT",
    body: audioBytes,
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audioBytes.length) },
  });
  assert.equal(ok.status, 200);
  const lib = await (await call("library", { email: VIEWER })).json();
  assert.equal(lib.tracks[0].hasAudio, true);
  assert.equal(lib.tracks[0].size, audioBytes.length);
});

test("reproducción en streaming con rangos (para avanzar dentro del tema)", async () => {
  await call(`audio/${audioId}`, {
    method: "PUT",
    body: audioBytes,
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audioBytes.length) },
  });
  const full = await call(`audio/${audioId}`, { email: VIEWER });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(full.headers.get("Accept-Ranges"), "bytes");
  assert.equal(full.headers.get("Cache-Control"), "private, no-store", "no se guarda en el móvil");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), audioBytes);
  const part = await call(`audio/${audioId}`, { email: VIEWER, headers: { Range: "bytes=10-19" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("Content-Range"), `bytes 10-19/${audioBytes.length}`);
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  assert.equal((await call(`audio/${"0".repeat(64)}`, { email: VIEWER })).status, 404);
});

test("Content-Range con sufijo y rango abierto", () => {
  assert.equal(contentRange({ suffix: 100 }, 1000).header, "bytes 900-999/1000");
  assert.equal(contentRange({ offset: 500 }, 1000).header, "bytes 500-999/1000");
  assert.equal(contentRange({ offset: 0, length: 1000 }, 1000), null);
});

test("lotes demasiado grandes o con identificadores inválidos se rechazan enteros", async () => {
  const many = Array.from({ length: 41 }, (_, i) => track(sha(new TextEncoder().encode(String(i)))));
  assert.equal(
    (await call("changes", { method: "POST", body: JSON.stringify({ tracks: many }) })).status,
    400,
  );
  assert.equal(
    (await call("changes", { method: "POST", body: JSON.stringify({ tracks: [track("abc")] }) })).status,
    400,
  );
  const lib = await (await call("library")).json();
  assert.equal(lib.tracks.length, 0);
  assert.equal(lib.revision, 0);
});

test("borrar canciones, listas y reordenar listas", async () => {
  const id2 = sha(new TextEncoder().encode("dos"));
  await call("changes", {
    method: "POST",
    body: JSON.stringify({
      tracks: [track(audioId), track(id2)],
      playlists: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    }),
  });
  await call("changes", {
    method: "POST",
    body: JSON.stringify({ deleteTracks: [id2], deletePlaylists: ["b"], order: ["c", "a"] }),
  });
  const lib = await (await call("library")).json();
  assert.deepEqual(lib.tracks.map((t) => t.track.id), [audioId]);
  assert.equal(env.AUDIO.objects.has(`audio/${id2}`), false);
  assert.deepEqual(lib.playlists.map((l) => l.id), ["c", "a"]);
});

test("se aceptan varias aplicaciones de Access (producción y vistas previas)", async () => {
  env.ACCESS_AUD = `otra-aud, ${AUD}`;
  assert.equal((await call("me")).status, 200);
  env.ACCESS_AUD = "otra-aud";
  assert.equal((await call("me")).status, 401);
});

test("verifyAccessToken exige emisor del equipo", async () => {
  const token = await issuer.sign({ email: ADMIN, iss: "https://otro.cloudflareaccess.com" });
  await assert.rejects(
    verifyAccessToken(token, { teamDomain: TEAM, audience: AUD, fetchKeys: issuer.fetchKeys }),
  );
});

const ADMIN_KEY = "clave-gestion-de-prueba-0123456789abcdef";
const VIEWER_KEY = "clave-reproduccion-de-prueba-0123456789ab";
async function addKeys() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO access_keys (key_hash, role, label) VALUES (?, 'admin', 'Ray')").bind(await hashKey(ADMIN_KEY)),
    env.DB.prepare("INSERT INTO access_keys (key_hash, role, label) VALUES (?, 'viewer', 'María Jesús')").bind(await hashKey(VIEWER_KEY)),
  ]);
}
const withKey = (key) => ({ email: null, headers: { Cookie: `otra=1; wcsl_key=${encodeURIComponent(key)}` } });

test("enlace personal: /api/enter guarda la cookie un año y vuelve a la app", async () => {
  await addKeys();
  const res = await call(`enter?k=${encodeURIComponent(ADMIN_KEY)}`, { email: null });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/");
  const cookie = res.headers.get("Set-Cookie");
  assert.match(cookie, /^wcsl_key=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=31536000/);
});

test("enlace no válido: 403 y sin cookie", async () => {
  await addKeys();
  const res = await call("enter?k=clave-inventada-que-no-existe-000000", { email: null });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal((await call("me", withKey("clave-inventada-que-no-existe-000000"))).status, 401);
});

test("con la cookie se entra sin código y se respeta el rol de la clave", async () => {
  await addKeys();
  assert.deepEqual(await (await call("me", withKey(ADMIN_KEY))).json(), { email: "Ray", role: "admin" });
  const viewer = await (await call("me", withKey(VIEWER_KEY))).json();
  assert.equal(viewer.role, "viewer");
  assert.equal((await call("library", withKey(VIEWER_KEY))).status, 200);
  const write = await call("changes", { ...withKey(VIEWER_KEY), method: "POST", body: JSON.stringify({ tracks: [track(audioId)] }) });
  assert.equal(write.status, 403);
  const ok = await call("changes", { ...withKey(ADMIN_KEY), method: "POST", body: JSON.stringify({ tracks: [track(audioId)] }) });
  assert.equal(ok.status, 200);
});

test("una clave anulada deja de funcionar al momento", async () => {
  await addKeys();
  await env.DB.prepare("DELETE FROM access_keys WHERE label = 'María Jesús'").run();
  assert.equal((await call("me", withKey(VIEWER_KEY))).status, 401);
});

test("salir borra la cookie", async () => {
  const res = await call("salir", { email: null });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("Set-Cookie"), /Max-Age=0/);
});
