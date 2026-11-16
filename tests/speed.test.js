import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSpeed,
  shiftSpeed,
  effectiveBpm,
  speedDescription,
  migrateTrackV3,
  cleanTrack,
  supportsBackupVersion,
} from "../dist/library-core.js";
import { applyPlaybackSpeed } from "../dist/playback.js";
test("velocidad limitada a 80–120 % con precisión de 1 %", () => {
  for (const [input, expected] of [
    [0.1, 1],
    [1.9, 1],
    [0.904, 0.9],
    [1.196, 1.2],
    [0.8, 0.8],
    [1.2, 1.2],
  ])
    assert.equal(normalizeSpeed(input), expected);
  for (const input of [null, undefined, NaN, Infinity, "0.9", {}, false])
    assert.equal(normalizeSpeed(input), 1);
});
test("atajos de cinco puntos sin acumulación de error ni salida del rango", () => {
  let speed = 1;
  for (let i = 0; i < 8; i++) speed = shiftSpeed(speed, -5);
  assert.equal(speed, 0.8);
  for (let i = 0; i < 8; i++) speed = shiftSpeed(speed, 5);
  assert.equal(speed, 1.2);
  assert.equal(shiftSpeed(0.91, 5), 0.96);
});
test("BPM efectivo redondeado sin modificar el original", () => {
  assert.equal(effectiveBpm(96, 0.9), 86);
  assert.equal(effectiveBpm(96, 1.2), 115);
  assert.equal(speedDescription(96, 0.9), "96 → 86 BPM · 90 %");
  for (const bpm of [null, undefined, 0, -1, NaN, "96"]) {
    assert.equal(effectiveBpm(bpm, 0.9), null);
    assert.equal(speedDescription(bpm, 0.9), "90 %");
  }
});
test("migración pura conserva ID, BPM, extras y referencias del audio", () => {
  const blob = new Blob(["test"]);
  const track = {
    id: "a".repeat(64),
    bpm: 190,
    rawBpm: 190,
    bpmSource: "auto",
    tags: ["WCS"],
    notes: "conservar",
    favorite: true,
    blob,
    extra: { arbitrary: true },
  };
  const upgraded = migrateTrackV3(track);
  assert.equal(upgraded.speed, 1);
  assert.deepEqual(
    Object.keys(upgraded)
      .filter((k) => k !== "speed")
      .sort(),
    Object.keys(track).sort(),
  );
  for (const key of Object.keys(track)) assert.equal(upgraded[key], track[key]);
  assert.ok(!("speed" in track));
  assert.deepEqual(migrateTrackV3(upgraded), upgraded);
  assert.equal(migrateTrackV3({ ...track, speed: 0.9 }).speed, 0.9);
});
test("copias v1/v2 y metadatos ausentes adoptan 100 %, v3 conserva la preferencia", () => {
  assert.equal(cleanTrack({ id: "old", bpm: 96 }).speed, 1);
  assert.equal(cleanTrack({ id: "new", bpm: 96, speed: 0.9 }).speed, 0.9);
  for (const version of [1, 2, 3]) assert.ok(supportsBackupVersion(version));
  for (const version of [0, 4, null, "3"])
    assert.equal(supportsBackupVersion(version), false);
});
test("aplicar velocidad configura todas las variantes de conservación del tono", () => {
  const audio = {};
  assert.equal(applyPlaybackSpeed(audio, 0.9), 0.9);
  assert.deepEqual(audio, {
    preservesPitch: true,
    mozPreservesPitch: true,
    webkitPreservesPitch: true,
    defaultPlaybackRate: 0.9,
    playbackRate: 0.9,
  });
  applyPlaybackSpeed(audio, undefined);
  assert.equal(audio.playbackRate, 1);
  assert.equal(audio.preservesPitch, true);
});
