import { test } from "node:test";
import assert from "node:assert/strict";
import { moveToIndex, playlistStats } from "../dist/library-core.js";
test("mover a índice conserva orden, no muta y respeta límites", () => {
  const list = { id: "x", trackIds: ["a", "b", "c", "d"] };
  assert.deepEqual(moveToIndex(list, "a", 2).trackIds, ["b", "c", "a", "d"]);
  assert.deepEqual(moveToIndex(list, "d", -20).trackIds, ["d", "a", "b", "c"]);
  assert.deepEqual(moveToIndex(list, "a", 80).trackIds, ["b", "c", "d", "a"]);
  assert.deepEqual(list.trackIds, ["a", "b", "c", "d"]);
  for (const args of [
    ["absent", 1],
    ["a", 0],
    ["a", NaN],
    ["a", 1.2],
  ])
    assert.equal(moveToIndex(list, ...args), list);
});
test("resumen cuenta pendientes y usa duración y BPM originales", () => {
  assert.deepEqual(
    playlistStats({ trackIds: ["a", "b", "missing"] }, [
      { id: "a", bpm: 96, duration: 120, speed: 0.9 },
      { id: "b", bpm: 110, duration: 150 },
    ]),
    { count: 3, duration: 270, minBpm: 96, maxBpm: 110 },
  );
  assert.equal(playlistStats({ trackIds: [] }, []).minBpm, null);
});
