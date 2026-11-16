import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendToQueue,
  moveQueueItem,
  removeQueueItem,
  nextQueueIndex,
} from "../dist/queue-core.js";
test("añadir varios temas mantiene todos los anteriores y el orden del lote, sin mutar", () => {
  const original = ["a", "b", "c"];
  assert.deepEqual(appendToQueue(original, ["d", "b"]), [
    "a",
    "b",
    "c",
    "d",
    "b",
  ]);
  assert.deepEqual(original, ["a", "b", "c"]);
});
test("mover conserva la aparición actual incluso con hashes repetidos", () => {
  const queue = ["a", "b", "a", "c"];
  assert.deepEqual(moveQueueItem(queue, 2, 2, 0), {
    queue: ["a", "a", "b", "c"],
    cursor: 0,
  });
  assert.equal(moveQueueItem(queue, 2, 0, 3).cursor, 1);
  assert.equal(moveQueueItem(queue, 2, 3, 0).cursor, 3);
  assert.equal(moveQueueItem(queue, -1, 0, 1).cursor, -1);
  for (const [from, to] of [
    [-1, 2],
    [0, 4],
    [0, 0],
    [0.5, 2],
  ])
    assert.equal(moveQueueItem(queue, 2, from, to).queue, queue);
  assert.deepEqual(queue, ["a", "b", "a", "c"]);
});
test("quitar una aparición mantiene el cursor y protege el tema actual", () => {
  assert.deepEqual(removeQueueItem(["a", "b", "a"], 2, 0), {
    queue: ["b", "a"],
    cursor: 1,
  });
  assert.deepEqual(removeQueueItem(["a", "b"], 0, 0), {
    queue: ["a", "b"],
    cursor: 0,
  });
  assert.deepEqual(removeQueueItem(["a", "b"], -1, 1), {
    queue: ["a"],
    cursor: -1,
  });
});
test("avance por posición reproduce repeticiones y se detiene al final automático", () => {
  const queue = ["a", "b", "a"];
  assert.equal(nextQueueIndex(queue, 1, 1, true), 2);
  assert.equal(nextQueueIndex(queue, 2, 1, true), -1);
  assert.equal(nextQueueIndex(queue, 2, 1), 0);
  assert.equal(nextQueueIndex(queue, 0, -1), 2);
  assert.equal(nextQueueIndex(queue, -1, 1), 0);
  assert.equal(nextQueueIndex([], -1, 1), -1);
});
