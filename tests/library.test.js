import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLAYLISTS,
  addToPlaylist,
  removeFromPlaylist,
  moveInPlaylist,
  correctReportedDoubleTempo,
  parseFilename,
  applyFilenameOrder,
  cleanTrack,
  sanitizePlaylist,
} from "../dist/library-core.js";
test("eight editable seed playlists have stable unique IDs and are empty", () => {
  assert.equal(DEFAULT_PLAYLISTS.length, 8);
  assert.equal(new Set(DEFAULT_PLAYLISTS.map((l) => l.id)).size, 8);
  assert.ok(DEFAULT_PLAYLISTS.every((l) => l.trackIds.length === 0));
});
test("membership deduplicates, preserves order and supports removal and moving", () => {
  const l = { id: "one", name: "Clase", trackIds: ["a", "b"] };
  const added = addToPlaylist(l, ["b", "c", "a", "d"]);
  assert.deepEqual(added.trackIds, ["a", "b", "c", "d"]);
  assert.deepEqual(l.trackIds, ["a", "b"]);
  assert.deepEqual(moveInPlaylist(added, "c", -1).trackIds, [
    "a",
    "c",
    "b",
    "d",
  ]);
  assert.deepEqual(removeFromPlaylist(added, ["b", "d"]).trackIds, ["a", "c"]);
  assert.equal(moveInPlaylist(l, "a", -1), l);
  assert.equal(moveInPlaylist(l, "absent", 1), l);
});
for (const bpm of [140, 169.1, 187.5, 220])
  test(`pulso doble automático ${bpm} → ÷2`, () => {
    const t = { id: "x", title: "Tema", bpm, bpmSource: "auto", favorite: true, tags: ["WCS"] };
    const fixed = correctReportedDoubleTempo(t);
    assert.equal(fixed.bpm, Math.round((bpm / 2) * 10) / 10);
    assert.equal(fixed.rawBpm, bpm);
    assert.equal(fixed.favorite, true);
    assert.equal(correctReportedDoubleTempo(fixed), fixed, "solo una vez");
    assert.equal(t.bpm, bpm, "no muta el original");
  });
test("nunca se tocan BPM manuales, normales o sin analizar", () => {
  for (const t of [
    { title: "Cool", bpm: 190, bpmSource: "manual" },
    { title: "Grow Up", bpm: 95, bpmSource: "auto" },
    { title: "Rápida", bpm: 132, bpmSource: "auto" },
    { title: "Sin BPM", bpm: null, bpmSource: "none" },
  ])
    assert.equal(correctReportedDoubleTempo(t), t);
});
test("nombre de archivo: Título - Artista (y quita copias (1))", () => {
  assert.deepEqual(parseFilename("Cool - Jonas Brothers.mp3"), { title: "Cool", artist: "Jonas Brothers" });
  assert.deepEqual(parseFilename("Shackles - Steven Rodriguez (1).mp3"), { title: "Shackles", artist: "Steven Rodriguez" });
  assert.deepEqual(parseFilename("Te Amo Album Version (1).mp3"), { title: "Te Amo Album Version", artist: "" });
  assert.deepEqual(parseFilename("Jonas Brothers - Cool.mp3", "artist-title"), { title: "Cool", artist: "Jonas Brothers" });
});
test("corrige título/artista importados al revés, pero respeta ediciones manuales", () => {
  const wrong = { title: "Jonas Brothers", artist: "Cool", filename: "Cool - Jonas Brothers.mp3" };
  assert.deepEqual(
    { ...applyFilenameOrder(wrong) },
    { ...wrong, title: "Cool", artist: "Jonas Brothers" },
  );
  const fixed = applyFilenameOrder(wrong);
  assert.equal(applyFilenameOrder(fixed), fixed, "idempotente");
  const edited = { title: "Cool (versión clase)", artist: "Jonas Brothers", filename: "Cool - Jonas Brothers.mp3" };
  assert.equal(applyFilenameOrder(edited), edited);
  assert.equal(applyFilenameOrder(fixed, "artist-title").title, "Jonas Brothers", "se puede volver al otro formato");
});
test("legacy metadata survives normalization", () => {
  const old = {
    id: "x",
    title: "Song",
    genre: "Blues",
    bpm: 100,
    favorite: true,
    tags: ["old"],
    notes: "keep",
  };
  const t = cleanTrack(old);
  assert.deepEqual(t.secondaryGenres, []);
  for (const key of Object.keys(old)) assert.deepEqual(t[key], old[key]);
});
test("restore validates playlist membership and removes duplicates", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(
    sanitizePlaylist({
      id: "x",
      name: "Warmup",
      description: "Keep",
      trackIds: [hash, hash, "invalid"],
    }).trackIds,
    [hash],
  );
  assert.equal(sanitizePlaylist({ name: "Broken" }), null);
});
