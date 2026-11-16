// Lógica pura de sincronización con la nube (sin red ni IndexedDB): se prueba con node:test.

export const MAX_CHANGES_PER_REQUEST = 35;
const TRANSIENT = new Set(["blob", "ready"]);

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined && !TRANSIENT.has(key) && !key.startsWith("_"))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Documento tal como se guarda en la nube: sin audio ni campos calculados. */
export function cloudDocument(item) {
  return JSON.parse(stableStringify(item));
}

export function emptySnapshot() {
  return { revision: -1, tracks: {}, playlists: {}, audio: [] };
}

function indexBy(list) {
  const map = new Map();
  for (const item of list || []) if (item?.id) map.set(item.id, item);
  return map;
}

/** Cambios locales pendientes de subir respecto a la última sincronización. */
export function diffForPush(localTracks, localPlaylists, snapshot) {
  const changes = { tracks: [], playlists: [], deleteTracks: [], deletePlaylists: [] };
  const tracks = indexBy(localTracks);
  const playlists = indexBy(localPlaylists);
  for (const [id, track] of tracks)
    if (snapshot.tracks[id] !== stableStringify(track)) changes.tracks.push(cloudDocument(track));
  for (const [id, list] of playlists)
    if (snapshot.playlists[id] !== stableStringify(list))
      changes.playlists.push(cloudDocument(list));
  for (const id of Object.keys(snapshot.tracks)) if (!tracks.has(id)) changes.deleteTracks.push(id);
  for (const id of Object.keys(snapshot.playlists))
    if (!playlists.has(id)) changes.deletePlaylists.push(id);
  return changes;
}

export function countChanges(changes) {
  return (
    changes.tracks.length +
    changes.playlists.length +
    changes.deleteTracks.length +
    changes.deletePlaylists.length
  );
}

/**
 * Divide los cambios en lotes que caben en una petición. Las canciones van antes que las listas
 * para que una lista nunca apunte a una canción que el servidor aún no conoce.
 */
export function chunkChanges(changes, size = MAX_CHANGES_PER_REQUEST) {
  const ops = [
    ...changes.tracks.map((value) => ["tracks", value]),
    ...changes.playlists.map((value) => ["playlists", value]),
    ...changes.deletePlaylists.map((value) => ["deletePlaylists", value]),
    ...changes.deleteTracks.map((value) => ["deleteTracks", value]),
  ];
  const batches = [];
  for (let i = 0; i < ops.length; i += size) {
    const batch = { tracks: [], playlists: [], deleteTracks: [], deletePlaylists: [] };
    for (const [kind, value] of ops.slice(i, i + size)) batch[kind].push(value);
    batches.push(batch);
  }
  return batches;
}

/** Marca un lote como sincronizado en la instantánea (después de que el servidor lo acepte). */
export function applyBatchToSnapshot(snapshot, batch) {
  const next = {
    ...snapshot,
    tracks: { ...snapshot.tracks },
    playlists: { ...snapshot.playlists },
  };
  for (const track of batch.tracks) next.tracks[track.id] = stableStringify(track);
  for (const list of batch.playlists) next.playlists[list.id] = stableStringify(list);
  for (const id of batch.deleteTracks) delete next.tracks[id];
  for (const id of batch.deletePlaylists) delete next.playlists[id];
  return next;
}

function planCollection(remoteItems, localItems, snapshotMap, replaceAll) {
  const remote = indexBy(remoteItems);
  const local = indexBy(localItems);
  const put = [];
  const remove = [];
  const snapshot = { ...snapshotMap };
  for (const [id, item] of remote) {
    const remoteJson = stableStringify(item);
    const localItem = local.get(id);
    const localJson = localItem ? stableStringify(localItem) : undefined;
    const known = snapshotMap[id];
    if (localJson === remoteJson) {
      snapshot[id] = remoteJson;
    } else if (replaceAll || known === undefined || localJson === known) {
      // Sin cambios locales pendientes (o primera sincronización en este dispositivo): gana la nube.
      if (localJson === undefined && known !== undefined && !replaceAll) continue; // borrado local pendiente
      put.push(item);
      snapshot[id] = remoteJson;
    }
    // Si hay cambios locales sin subir, se conservan y se subirán después.
  }
  for (const [id, item] of local) {
    if (remote.has(id)) continue;
    const known = snapshotMap[id];
    if (replaceAll) remove.push(id);
    else if (known !== undefined && stableStringify(item) === known) {
      // Se borró en la nube y aquí no había cambios: se borra también aquí.
      remove.push(id);
      delete snapshot[id];
    }
  }
  for (const id of Object.keys(snapshotMap))
    if (!remote.has(id) && !local.has(id)) delete snapshot[id];
  return { put, remove, snapshot };
}

/**
 * Qué hay que escribir en este dispositivo al recibir la biblioteca de la nube.
 * Reproducción: la nube reemplaza todo. Gestión: la nube gana salvo cambios locales sin subir.
 */
export function planPull(remote, localTracks, localPlaylists, snapshot, { replaceAll = false } = {}) {
  const remoteTracks = (remote.tracks || []).map((entry) => entry.track);
  const tracks = planCollection(remoteTracks, localTracks, snapshot.tracks, replaceAll);
  const playlists = planCollection(remote.playlists, localPlaylists, snapshot.playlists, replaceAll);
  return {
    putTracks: tracks.put,
    deleteTracks: tracks.remove,
    putPlaylists: playlists.put,
    deletePlaylists: playlists.remove,
    snapshot: {
      revision: remote.revision,
      tracks: tracks.snapshot,
      playlists: playlists.snapshot,
      audio: (remote.tracks || []).filter((entry) => entry.hasAudio).map((entry) => entry.track.id),
    },
  };
}

/** Canciones con audio en este dispositivo que todavía no están en la nube. */
export function pendingUploads(localAudioIds, snapshot) {
  const inCloud = new Set(snapshot.audio || []);
  return [...localAudioIds].filter((id) => snapshot.tracks[id] !== undefined && !inCloud.has(id));
}
