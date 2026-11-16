import { normalizeSpeed } from "./library-core.js";

export const MAX_SHARE_BYTES = 999999;
export const isHash = (id) =>
  typeof id === "string" && /^[a-f0-9]{64}$/.test(id);
const text = (value, limit) =>
  typeof value === "string" ? value.slice(0, limit) : "";
const names = (value) =>
  Array.isArray(value)
    ? value
        .slice(0, 30)
        .map((item) => text(item, 100))
        .filter(Boolean)
    : [];
const duration = (value) =>
  Number.isFinite(value) && value >= 0 ? value : null;
const bpm = (value) =>
  Number.isFinite(value) && value >= 20 && value <= 400 ? value : null;

export function publishedTrack(track) {
  if (!isHash(track?.id))
    throw new Error("Una canción tiene un identificador de audio no válido.");
  return {
    id: track.id,
    filename: text(track.filename, 255),
    title: text(track.title, 200),
    artist: text(track.artist, 200),
    duration: duration(track.duration),
    bpm: bpm(track.bpm),
    genre: text(track.genre, 100),
    secondaryGenres: names(track.secondaryGenres),
    tags: names(track.tags),
    speed: normalizeSpeed(track.speed),
  };
}

export function shareBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createTeamPackage(
  tracks,
  playlists,
  publicationVersion,
  publishedAt = new Date().toISOString(),
) {
  return validateTeamPackage({
    format: "wcsl-share",
    version: 1,
    publicationVersion,
    publishedAt,
    tracks: tracks.map(publishedTrack),
    playlists: playlists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description || "",
      trackIds: [...list.trackIds],
    })),
  });
}

export function validateTeamPackage(input) {
  if (
    !input ||
    input.format !== "wcsl-share" ||
    input.version !== 1 ||
    !Array.isArray(input.tracks) ||
    !Array.isArray(input.playlists)
  )
    throw new Error("No es un paquete wcsl-share v1.");
  if (shareBytes(input) > MAX_SHARE_BYTES)
    throw new Error(
      "El paquete supera 1 MB. Reduce las etiquetas o el tamaño de la publicación.",
    );
  if (
    !Number.isSafeInteger(input.publicationVersion) ||
    input.publicationVersion < 1 ||
    !Number.isFinite(Date.parse(input.publishedAt))
  )
    throw new Error("La fecha o la versión publicada no son válidas.");
  const tracks = input.tracks.map(publishedTrack);
  const ids = new Set(tracks.map((track) => track.id));
  if (ids.size !== tracks.length)
    throw new Error("El paquete contiene canciones duplicadas.");
  const listIds = new Set();
  const playlists = input.playlists.map((list) => {
    if (
      typeof list?.id !== "string" ||
      !list.id ||
      list.id.length > 100 ||
      listIds.has(list.id) ||
      typeof list.name !== "string" ||
      !list.name.trim() ||
      !Array.isArray(list.trackIds)
    )
      throw new Error("El paquete contiene una lista no válida o duplicada.");
    listIds.add(list.id);
    if (list.trackIds.some((id) => !ids.has(id)))
      throw new Error(
        "Una lista apunta a una canción sin datos en el paquete.",
      );
    if (new Set(list.trackIds).size !== list.trackIds.length)
      throw new Error("Una lista contiene canciones repetidas.");
    return {
      id: list.id,
      name: text(list.name, 100),
      description: text(list.description, 1000),
      trackIds: [...list.trackIds],
    };
  });
  return {
    format: "wcsl-share",
    version: 1,
    publicationVersion: input.publicationVersion,
    publishedAt: new Date(input.publishedAt).toISOString(),
    tracks,
    playlists,
  };
}

export function normalizedFilename(filename) {
  return String(filename || "")
    .split(/[\\/]/)
    .pop()
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();
}

// Reservar todos los hashes exactos antes de considerar coincidencias aproximadas.
export function matchTracks(published, available) {
  const matches = new Map();
  const used = new Set();
  for (const track of published) {
    const exact = available.find(
      (item) => item.id === track.id || item.hash === track.id,
    );
    if (exact && !used.has(exact.id)) {
      matches.set(track.id, {
        publishedId: track.id,
        localId: exact.id,
        method: "hash",
      });
      used.add(exact.id);
    }
  }
  for (const track of published) {
    if (
      matches.has(track.id) ||
      !normalizedFilename(track.filename) ||
      !Number.isFinite(track.duration)
    )
      continue;
    const candidates = available.filter(
      (item) =>
        !used.has(item.id) &&
        normalizedFilename(item.filename) ===
          normalizedFilename(track.filename) &&
        Number.isFinite(item.duration) &&
        Math.abs(item.duration - track.duration) <= 2,
    );
    if (
      candidates.length === 1 &&
      published.filter(
        (other) =>
          !matches.has(other.id) &&
          normalizedFilename(other.filename) ===
            normalizedFilename(candidates[0].filename) &&
          Number.isFinite(other.duration) &&
          Math.abs(other.duration - candidates[0].duration) <= 2,
      ).length === 1
    ) {
      matches.set(track.id, {
        publishedId: track.id,
        localId: candidates[0].id,
        method: "filename-duration",
      });
      used.add(candidates[0].id);
    }
  }
  return {
    matched: [...matches.values()],
    missing: published.filter((track) => !matches.has(track.id)),
  };
}

export function prepareTeamReplacement(input, availableAudio) {
  const packet = validateTeamPackage(input);
  const matching = matchTracks(packet.tracks, availableAudio);
  return {
    ...matching,
    packet,
    tracks: packet.tracks.map((track) => ({
      ...track,
      bpmSource: "published",
      rawBpm: track.bpm,
      favorite: false,
      notes: "",
    })),
    playlists: packet.playlists.map((list, index) => ({
      ...list,
      order: index,
      created: index + 1,
    })),
    unusedAudioIds: availableAudio
      .filter(
        (audio) =>
          !packet.playlists.some((list) => list.trackIds.includes(audio.id)),
      )
      .map((audio) => audio.id),
  };
}

export function unreferencedAudioIds(playlists, audio) {
  const referenced = new Set(playlists.flatMap((list) => list.trackIds));
  return audio
    .filter((item) => !referenced.has(item.id))
    .map((item) => item.id);
}

export function estimatedBackupBytes(
  audioRecords,
  tracks = [],
  playlists = [],
) {
  return (
    audioRecords.reduce(
      (total, item) => total + 4 * Math.ceil((item.blob?.size || 0) / 3) + 64,
      0,
    ) +
    shareBytes({ tracks, playlists }) +
    1024
  );
}
