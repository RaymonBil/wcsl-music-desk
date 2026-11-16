// Conexión de la app con la nube (Cloudflare): sesión, sincronización de la biblioteca,
// subida de audio en segundo plano y reproducción por streaming con precarga.
import { readStore, writeStores, getSetting, putSetting } from "./db-utils.js";
import {
  emptySnapshot,
  diffForPush,
  chunkChanges,
  countChanges,
  applyBatchToSnapshot,
  planPull,
  pendingUploads,
} from "./cloud-core.js";

const SNAPSHOT_KEY = "cloud-snapshot";
const PREFETCH_LIMIT = 2; // la actual y la siguiente, solo en memoria

async function readJson(response) {
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) throw new Error("Respuesta inesperada del servidor");
  return response.json();
}

/** ¿Hay nube y quién soy? ok | signed-out | forbidden | unavailable | offline */
export async function fetchSession() {
  try {
    const response = await fetch("/api/me", {
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.type === "opaqueredirect" || response.status === 401)
      return { status: "signed-out" };
    if (response.status === 403) return { status: "forbidden" };
    if (!response.ok) return { status: "unavailable" };
    const body = await readJson(response);
    if (!body?.role) return { status: "unavailable" };
    return { status: "ok", email: body.email, role: body.role };
  } catch (error) {
    // Sin red, o un alojamiento sin API (responde HTML): se trabaja en local.
    return { status: navigator.onLine === false ? "offline" : "unavailable" };
  }
}

export function createCloudSync({ getDb, role, onStatus = () => {}, onLibraryChanged, notify }) {
  const admin = role === "admin";
  let snapshot = emptySnapshot();
  let chain = Promise.resolve();
  let timer = null;
  let expiredNotified = false;
  let uploading = false;
  const prefetched = new Map(); // id -> { url, promise }

  const queue = (task) => {
    chain = chain.then(task, task).catch((error) => {
      console.warn("Sincronización", error);
    });
    return chain;
  };

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      redirect: "manual",
      cache: "no-store",
      ...options,
    });
    if (response.type === "opaqueredirect" || response.status === 401) {
      if (!expiredNotified) {
        expiredNotified = true;
        notify?.("Tu sesión ha caducado. Recarga la página para volver a entrar.");
      }
      onStatus("Sesión caducada · recarga la página");
      throw new Error("Sesión caducada");
    }
    return response;
  }

  async function loadSnapshot() {
    snapshot = (await getSetting(getDb(), SNAPSHOT_KEY)) || emptySnapshot();
  }
  async function saveSnapshot() {
    await putSetting(getDb(), SNAPSHOT_KEY, snapshot);
  }

  async function pull() {
    const db = getDb();
    const response = await request("/api/library", {
      headers: { "If-None-Match": `W/"rev-${snapshot.revision}"`, Accept: "application/json" },
    });
    if (response.status === 304) return false;
    if (!response.ok) throw new Error("No se ha podido leer la biblioteca de la nube");
    const remote = await readJson(response);
    const [tracks, playlists] = await Promise.all([readStore(db, "tracks"), readStore(db, "playlists")]);
    const plan = planPull(remote, tracks, playlists, snapshot, { replaceAll: !admin });
    const changed =
      plan.putTracks.length + plan.deleteTracks.length + plan.putPlaylists.length + plan.deletePlaylists.length > 0;
    await writeStores(db, ["tracks", "playlists", "audio", "settings"], (tx) => {
      for (const track of plan.putTracks) tx.objectStore("tracks").put(track);
      for (const id of plan.deleteTracks) {
        tx.objectStore("tracks").delete(id);
        tx.objectStore("audio").delete(id);
      }
      for (const list of plan.putPlaylists) tx.objectStore("playlists").put(list);
      for (const id of plan.deletePlaylists) tx.objectStore("playlists").delete(id);
      tx.objectStore("settings").put({ key: SNAPSHOT_KEY, value: plan.snapshot });
    });
    snapshot = plan.snapshot;
    return changed;
  }

  async function push() {
    if (!admin) return 0;
    const db = getDb();
    const [tracks, playlists] = await Promise.all([readStore(db, "tracks"), readStore(db, "playlists")]);
    const changes = diffForPush(tracks, playlists, snapshot);
    const total = countChanges(changes);
    if (!total) return 0;
    let done = 0;
    for (const batch of chunkChanges(changes)) {
      onStatus(`Guardando en la nube… ${done}/${total}`);
      const response = await request("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        const body = await readJson(response).catch(() => ({}));
        throw new Error(body.error || "La nube no ha aceptado los cambios");
      }
      const { revision } = await readJson(response);
      const expected = snapshot.revision + 1;
      snapshot = applyBatchToSnapshot(snapshot, batch);
      // Si otra sesión cambió algo entre medias, la próxima lectura traerá la biblioteca completa.
      snapshot.revision = revision === expected ? revision : -1;
      await saveSnapshot();
      done += countChanges(batch);
    }
    return total;
  }

  async function uploadAudio() {
    if (!admin || uploading) return;
    uploading = true;
    try {
      const db = getDb();
      const records = await readStore(db, "audio");
      const blobs = new Map(records.map((record) => [record.id, record.blob]));
      const pending = pendingUploads(blobs.keys(), snapshot);
      for (let i = 0; i < pending.length; i++) {
        const id = pending[i];
        const blob = blobs.get(id);
        if (!blob) continue;
        onStatus(`Subiendo música a la nube · ${i + 1} de ${pending.length}`);
        const response = await request(`/api/audio/${id}`, {
          method: "PUT",
          headers: { "Content-Type": blob.type || "audio/mpeg" },
          body: blob,
        });
        if (!response.ok) {
          const body = await readJson(response).catch(() => ({}));
          notify?.(`No se ha podido subir una canción: ${body.error || response.status}`);
          continue;
        }
        snapshot = { ...snapshot, audio: [...new Set([...(snapshot.audio || []), id])] };
        await saveSnapshot();
      }
    } finally {
      uploading = false;
    }
  }

  function describe() {
    const audio = new Set(snapshot.audio || []);
    const total = Object.keys(snapshot.tracks).length;
    const withAudio = Object.keys(snapshot.tracks).filter((id) => audio.has(id)).length;
    return admin
      ? `En la nube · ${withAudio} de ${total} canciones con audio`
      : `Biblioteca del equipo · ${withAudio} canciones`;
  }

  async function sync({ pullFirst = true } = {}) {
    return queue(async () => {
      try {
        let changed = false;
        if (pullFirst) changed = await pull();
        await push();
        if (changed) await onLibraryChanged?.();
        onStatus(describe());
        await uploadAudio();
        onStatus(describe());
      } catch (error) {
        if (error.message !== "Sesión caducada")
          onStatus(navigator.onLine === false ? "Sin conexión · los cambios se guardarán al volver" : "No se ha podido sincronizar · se reintentará");
      }
    });
  }

  function schedule() {
    if (!admin) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync({ pullFirst: false }), 1200);
  }

  function audioUrl(id) {
    return `/api/audio/${id}`;
  }

  function prefetch(id) {
    if (!id || prefetched.has(id) || !hasAudio(id)) return;
    const entry = { url: null, promise: null };
    entry.promise = fetch(audioUrl(id), { credentials: "same-origin" })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (blob) entry.url = URL.createObjectURL(blob);
        return blob;
      })
      .catch(() => null);
    prefetched.set(id, entry);
    while (prefetched.size > PREFETCH_LIMIT) {
      const [oldId, old] = prefetched.entries().next().value;
      if (old.url) URL.revokeObjectURL(old.url);
      prefetched.delete(oldId);
    }
  }

  function hasAudio(id) {
    return (snapshot.audio || []).includes(id);
  }

  /** Fuente para el reproductor: la copia precargada si ya está, si no, streaming. */
  function sourceFor(id) {
    const entry = prefetched.get(id);
    if (entry?.url) return entry.url;
    return hasAudio(id) ? audioUrl(id) : null;
  }

  async function fetchBlob(id) {
    const entry = prefetched.get(id);
    if (entry) {
      const blob = await entry.promise;
      if (blob) return blob;
    }
    if (!hasAudio(id)) return null;
    const response = await request(audioUrl(id));
    return response.ok ? response.blob() : null;
  }

  async function start() {
    await loadSnapshot();
    onStatus(describe());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sync();
    });
    window.addEventListener("online", () => sync());
    return sync();
  }

  return {
    role,
    start,
    sync,
    schedule,
    hasAudio,
    sourceFor,
    prefetch,
    fetchBlob,
    pendingCount: async () => {
      const records = await readStore(getDb(), "audio");
      return pendingUploads(records.map((r) => r.id), snapshot).length;
    },
  };
}
