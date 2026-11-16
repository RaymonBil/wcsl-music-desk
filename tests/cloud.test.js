import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stableStringify,
  emptySnapshot,
  diffForPush,
  chunkChanges,
  countChanges,
  applyBatchToSnapshot,
  planPull,
  pendingUploads,
} from "../dist/cloud-core.js";

const id = (n) => String(n).padStart(64, "a");
const t = (n, extra = {}) => ({ id: id(n), title: `Tema ${n}`, bpm: 90 + n, ...extra });
const l = (name, ids, extra = {}) => ({ id: name, name, trackIds: ids, ...extra });

test("stableStringify ignora orden de claves, audio y campos calculados", () => {
  assert.equal(
    stableStringify({ b: 1, a: [1, { y: 2, x: 1 }], blob: "x", ready: true, _tmp: 1 }),
    '{"a":[1,{"x":1,"y":2}],"b":1}',
  );
});

test("primera sincronización: sube todo lo local", () => {
  const changes = diffForPush([t(1), t(2)], [l("warmup", [id(1)])], emptySnapshot());
  assert.equal(changes.tracks.length, 2);
  assert.equal(changes.playlists.length, 1);
  assert.equal(changes.tracks[0].blob, undefined);
});

test("después de sincronizar no hay cambios; luego solo lo editado y lo borrado", () => {
  const tracks = [t(1), t(2)];
  const lists = [l("warmup", [id(1)]), l("social", [])];
  let snapshot = emptySnapshot();
  for (const batch of chunkChanges(diffForPush(tracks, lists, snapshot)))
    snapshot = applyBatchToSnapshot(snapshot, batch);
  assert.equal(countChanges(diffForPush(tracks, lists, snapshot)), 0);
  const edited = diffForPush([t(1, { speed: 0.9 })], [l("warmup", [id(1)])], snapshot);
  assert.deepEqual(edited.tracks.map((x) => x.id), [id(1)]);
  assert.deepEqual(edited.deleteTracks, [id(2)]);
  assert.deepEqual(edited.deletePlaylists, ["social"]);
  assert.equal(edited.playlists.length, 0);
});

test("los lotes respetan el máximo y suben canciones antes que listas", () => {
  const tracks = Array.from({ length: 50 }, (_, i) => t(i));
  const batches = chunkChanges(diffForPush(tracks, [l("a", [id(1)])], emptySnapshot()), 35);
  assert.equal(batches.length, 2);
  assert.ok(batches.every((b) => countChanges(b) <= 35));
  assert.equal(batches[0].playlists.length, 0);
  assert.equal(batches[1].playlists.length, 1);
});

const remoteOf = (tracks, playlists, audio = [], revision = 5) => ({
  revision,
  tracks: tracks.map((track) => ({ track, hasAudio: audio.includes(track.id) })),
  playlists,
});

test("reproducción: la nube reemplaza todo lo local", () => {
  const plan = planPull(
    remoteOf([t(1)], [l("warmup", [id(1)])], [id(1)]),
    [t(1, { title: "viejo" }), t(9)],
    [l("vieja", [])],
    emptySnapshot(),
    { replaceAll: true },
  );
  assert.deepEqual(plan.putTracks.map((x) => x.title), ["Tema 1"]);
  assert.deepEqual(plan.deleteTracks, [id(9)]);
  assert.deepEqual(plan.deletePlaylists, ["vieja"]);
  assert.deepEqual(plan.snapshot.audio, [id(1)]);
});

test("gestión en un dispositivo nuevo: las listas de la nube sustituyen a las iniciales vacías", () => {
  const plan = planPull(
    remoteOf([t(1)], [l("warmup", [id(1)])]),
    [],
    [l("warmup", [])],
    emptySnapshot(),
  );
  assert.deepEqual(plan.putPlaylists[0].trackIds, [id(1)]);
  assert.equal(plan.putTracks.length, 1);
});

test("gestión: no se pisan cambios locales sin subir ni se resucitan borrados locales", () => {
  const synced = emptySnapshot();
  synced.tracks[id(1)] = stableStringify(t(1));
  synced.tracks[id(2)] = stableStringify(t(2));
  synced.playlists.warmup = stableStringify(l("warmup", [id(1)]));
  const plan = planPull(
    remoteOf([t(1), t(2, { bpm: 120 })], [l("warmup", [id(1), id(2)])]),
    [t(1, { speed: 0.95 })], // tema 1 editado aquí, tema 2 borrado aquí
    [l("warmup", [id(1)])],
    synced,
  );
  assert.equal(plan.putTracks.length, 0, "ni se pisa el editado ni vuelve el borrado");
  assert.deepEqual(plan.putPlaylists[0].trackIds, [id(1), id(2)], "la lista sin cambios locales se actualiza");
});

test("gestión: lo borrado en la nube se borra aquí si no tenía cambios", () => {
  const synced = emptySnapshot();
  synced.tracks[id(1)] = stableStringify(t(1));
  synced.tracks[id(2)] = stableStringify(t(2));
  const plan = planPull(remoteOf([t(1)], []), [t(1), t(2)], [], synced);
  assert.deepEqual(plan.deleteTracks, [id(2)]);
  assert.equal(plan.snapshot.tracks[id(2)], undefined);
});

test("subidas pendientes: audio local de canciones ya registradas y sin audio en la nube", () => {
  const snapshot = emptySnapshot();
  snapshot.tracks[id(1)] = "{}";
  snapshot.tracks[id(2)] = "{}";
  snapshot.audio = [id(2)];
  assert.deepEqual(pendingUploads([id(1), id(2), id(3)], snapshot), [id(1)]);
});
