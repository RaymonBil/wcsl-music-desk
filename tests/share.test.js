import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTeamPackage,
  validateTeamPackage,
  shareBytes,
  matchTracks,
  prepareTeamReplacement,
  unreferencedAudioIds,
  estimatedBackupBytes,
} from "../dist/share-core.js";
import { makePin, verifyPin } from "../dist/pin-core.js";
const id = (n) => n.toString(16).padStart(64, "0");
const track = (n, extra = {}) => ({
  id: id(n),
  filename: `Tema-${n}.mp3`,
  title: `Tema ${n}`,
  artist: "Artista",
  duration: 180,
  bpm: 96,
  genre: "Pop",
  secondaryGenres: ["Blues"],
  tags: ["WCS"],
  speed: 0.9,
  ...extra,
});
const packet = (
  tracks = [track(1)],
  lists = [{ id: "clase", name: "Mi clase", trackIds: [id(1)] }],
) => createTeamPackage(tracks, lists, 1, "2026-11-16T12:00:00Z");

test("publica solo datos permitidos, orden y versión; nunca audio ni notas privadas", () => {
  const value = packet([
    track(1, {
      blob: new Blob(["audio"]),
      audio: "base64",
      notes: "privado",
      favorite: true,
      rawBpm: 192,
    }),
  ]);
  assert.deepEqual(Object.keys(value.tracks[0]), [
    "id",
    "filename",
    "title",
    "artist",
    "duration",
    "bpm",
    "genre",
    "secondaryGenres",
    "tags",
    "speed",
  ]);
  assert.equal(value.format, "wcsl-share");
  assert.equal(value.version, 1);
  assert.equal(value.publicationVersion, 1);
  assert.ok(!JSON.stringify(value).includes("privado"));
  assert.deepEqual(value.playlists[0].trackIds, [id(1)]);
});
test("500 canciones y listas publicadas pesan menos de 1 MB", () => {
  const tracks = Array.from({ length: 500 }, (_, index) => track(index + 1));
  const value = packet(
    tracks,
    Array.from({ length: 8 }, (_, index) => ({
      id: `lista${index}`,
      name: `Clase ${index}`,
      description: "Orden publicado",
      trackIds: tracks.map((t) => t.id).reverse(),
    })),
  );
  assert.ok(shareBytes(value) < 1000000);
  assert.deepEqual(
    value.playlists[0].trackIds,
    tracks.map((t) => t.id).reverse(),
  );
});
test("valida esquema, fecha, tamaño, duplicados y referencias", () => {
  const good = packet();
  for (const value of [
    { ...good, version: 2 },
    { ...good, publishedAt: "no" },
    { ...good, publicationVersion: 0 },
    { ...good, tracks: [track(1), track(1)] },
    { ...good, playlists: [{ id: "x", name: "x", trackIds: [id(80)] }] },
    { ...good, extra: "x".repeat(1000000) },
  ])
    assert.throws(() => validateTeamPackage(value));
});
test("empareja por hash aunque cambie el archivo; fallback ±2s con nombre normalizado", () => {
  const published = [track(1), track(2), track(3)];
  const result = matchTracks(published, [
    track(1, { filename: "Renombrado.mp3", duration: 150 }),
    track(20, { filename: "TEMA-2.MP3", duration: 182 }),
    track(30, { filename: "Tema-3.mp3", duration: 182.01 }),
  ]);
  assert.deepEqual(
    result.matched.map((m) => m.method),
    ["hash", "filename-duration"],
  );
  assert.deepEqual(
    result.missing.map((t) => t.id),
    [id(3)],
  );
});
test("los hashes tienen prioridad global y no se adivinan coincidencias ambiguas", () => {
  const result = matchTracks(
    [track(9, { filename: "Tema-1.mp3" }), track(1)],
    [track(1)],
  );
  assert.deepEqual(
    result.matched.map((m) => m.publishedId),
    [id(1)],
  );
  assert.equal(
    matchTracks(
      [track(1)],
      [
        track(2, { filename: "Tema-1.mp3" }),
        track(3, { filename: "Tema-1.mp3" }),
      ],
    ).matched.length,
    0,
  );
  assert.equal(
    matchTracks(
      [track(1), track(2, { filename: "Tema-1.mp3" })],
      [track(3, { filename: "Tema-1.mp3" })],
    ).matched.length,
    0,
  );
  assert.equal(
    matchTracks(
      [track(1, { duration: null })],
      [track(3, { filename: "Tema-1.mp3" })],
    ).matched.length,
    0,
  );
});
test("una coincidencia previa por nombre conserva el ID publicado al actualizar", () => {
  assert.equal(
    matchTracks(
      [track(1, { filename: "cambio.mp3" })],
      [{ ...track(1), hash: id(2) }],
    ).matched[0].method,
    "hash",
  );
});
test("actualizar reemplaza las listas y metadatos sin fusionar y sin recalcular BPM", () => {
  const first = packet(
    [track(1), track(2)],
    [{ id: "one", name: "Primera", trackIds: [id(2), id(1)] }],
  );
  const replacement = prepareTeamReplacement(first, [track(1)]);
  assert.deepEqual(
    replacement.playlists.map((l) => l.id),
    ["one"],
  );
  assert.deepEqual(replacement.playlists[0].trackIds, [id(2), id(1)]);
  assert.equal(replacement.tracks[0].bpm, 96);
  assert.equal(replacement.tracks[0].speed, 0.9);
  assert.equal(replacement.tracks[0].bpmSource, "published");
  assert.deepEqual(
    replacement.missing.map((t) => t.filename),
    ["Tema-2.mp3"],
  );
  assert.deepEqual(
    prepareTeamReplacement(first, [track(1), track(2)]).missing,
    [],
  );
  assert.equal(first.tracks[0].bpm, 96);
});
test("liberar espacio solo afecta a audios fuera de las listas", () => {
  assert.deepEqual(
    unreferencedAudioIds([{ trackIds: [id(1)] }], [track(1), track(2)]),
    [id(2)],
  );
});
test("estima la expansión base64 de la copia completa", () => {
  assert.ok(
    estimatedBackupBytes([{ blob: new Blob([new Uint8Array(3000)]) }]) >= 4000,
  );
});
test("PIN: cuatro cifras, salt aleatorio y hash; rechazo de PIN erróneo", async () => {
  await assert.rejects(makePin("123"));
  const stored = await makePin("1234");
  assert.deepEqual(Object.keys(stored).sort(), ["hash", "salt"]);
  assert.notEqual((await makePin("1234")).hash, stored.hash);
  assert.equal(await verifyPin("1234", stored), true);
  assert.equal(await verifyPin("9999", stored), false);
  assert.equal(await verifyPin("", stored), false);
});
