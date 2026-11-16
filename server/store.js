// Acceso a D1: miembros, canciones, listas y número de revisión de la biblioteca.

export const TRACK_ID = /^[a-f0-9]{64}$/;
export const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const ROLES = new Set(["admin", "viewer"]);
const MAX_DOCUMENT_BYTES = 64 * 1024;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS members (
     email TEXT PRIMARY KEY,
     role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
     name TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS tracks (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     has_audio INTEGER NOT NULL DEFAULT 0,
     size INTEGER,
     mime TEXT,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS playlists (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     position INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('revision', 0)`,
];

const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  ready.add(db);
}

export async function getRole(db, email) {
  const row = await db
    .prepare("SELECT role FROM members WHERE email = ?")
    .bind(String(email).toLowerCase())
    .first();
  return row && ROLES.has(row.role) ? row.role : null;
}

export async function getRevision(db) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'revision'").first();
  return row ? Number(row.value) : 0;
}

const bump = (db) =>
  db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'revision'");

/** Respuesta de la biblioteca construida sin volver a parsear cada documento. */
export async function readLibraryJson(db) {
  const [tracks, playlists, revision] = await db.batch([
    db.prepare("SELECT data, has_audio, size FROM tracks ORDER BY rowid"),
    db.prepare("SELECT data FROM playlists ORDER BY position, rowid"),
    db.prepare("SELECT value FROM meta WHERE key = 'revision'"),
  ]);
  const rev = Number(revision.results[0]?.value || 0);
  const trackItems = tracks.results.map(
    (row) =>
      `{"track":${row.data},"hasAudio":${row.has_audio ? "true" : "false"},"size":${
        Number.isFinite(row.size) ? row.size : "null"
      }}`,
  );
  const listItems = playlists.results.map((row) => row.data);
  return {
    revision: rev,
    body: `{"revision":${rev},"tracks":[${trackItems.join(",")}],"playlists":[${listItems.join(",")}]}`,
  };
}

function encodeDocument(value) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES)
    throw new RangeError("Documento demasiado grande");
  return text;
}

export function sanitizeTrackDocument(input) {
  if (!input || typeof input !== "object") throw new TypeError("Canción no válida");
  const id = String(input.id || "");
  if (!TRACK_ID.test(id)) throw new TypeError("Identificador de canción no válido");
  const { blob, ...rest } = input;
  return { ...rest, id };
}

export function sanitizePlaylistDocument(input) {
  if (!input || typeof input !== "object") throw new TypeError("Lista no válida");
  const id = String(input.id || "");
  if (!PLAYLIST_ID.test(id)) throw new TypeError("Identificador de lista no válido");
  const trackIds = Array.isArray(input.trackIds)
    ? [...new Set(input.trackIds.map(String).filter((t) => TRACK_ID.test(t)))]
    : [];
  return {
    ...input,
    id,
    name: String(input.name || "Lista sin nombre").slice(0, 200),
    description: String(input.description || "").slice(0, 2000),
    trackIds,
  };
}

/**
 * Aplica un lote de cambios (como máximo 40 operaciones) en una única transacción D1.
 * changes = { tracks: [], playlists: [], deleteTracks: [], deletePlaylists: [], order: [] }
 */
export function buildChangeStatements(db, changes, email, now = Date.now()) {
  const statements = [];
  for (const raw of changes.tracks || []) {
    const doc = sanitizeTrackDocument(raw);
    statements.push(
      db
        .prepare(
          `INSERT INTO tracks (id, data, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        )
        .bind(doc.id, encodeDocument(doc), now, email),
    );
  }
  for (const raw of changes.playlists || []) {
    const doc = sanitizePlaylistDocument(raw);
    statements.push(
      db
        .prepare(
          `INSERT INTO playlists (id, data, position, updated_at, updated_by)
           VALUES (?1, ?2, COALESCE((SELECT MAX(position) + 1 FROM playlists), 0), ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        )
        .bind(doc.id, encodeDocument(doc), now, email),
    );
  }
  for (const id of changes.deleteTracks || []) {
    if (!TRACK_ID.test(id)) throw new TypeError("Identificador de canción no válido");
    statements.push(db.prepare("DELETE FROM tracks WHERE id = ?").bind(id));
  }
  for (const id of changes.deletePlaylists || []) {
    if (!PLAYLIST_ID.test(id)) throw new TypeError("Identificador de lista no válido");
    statements.push(db.prepare("DELETE FROM playlists WHERE id = ?").bind(id));
  }
  if (Array.isArray(changes.order)) {
    changes.order.forEach((id, position) => {
      if (!PLAYLIST_ID.test(id)) throw new TypeError("Identificador de lista no válido");
      statements.push(
        db.prepare("UPDATE playlists SET position = ? WHERE id = ?").bind(position, id),
      );
    });
  }
  if (statements.length > 40) throw new RangeError("Demasiados cambios en un lote (máximo 40)");
  if (statements.length) statements.push(bump(db));
  return statements;
}

export async function markAudio(db, id, size, mime, email, now = Date.now()) {
  const results = await db.batch([
    db
      .prepare(
        "UPDATE tracks SET has_audio = 1, size = ?, mime = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      )
      .bind(size, mime, now, email, id),
    bump(db),
  ]);
  return results[0].meta?.changes ?? 0;
}

export async function unmarkAudio(db, id) {
  await db.batch([
    db.prepare("UPDATE tracks SET has_audio = 0, size = NULL WHERE id = ?").bind(id),
    bump(db),
  ]);
}

export async function listMembers(db) {
  const { results } = await db
    .prepare("SELECT email, role, name FROM members ORDER BY role, email")
    .all();
  return results;
}
