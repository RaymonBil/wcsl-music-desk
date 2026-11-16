import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGapSeconds } from "../dist/library-core.js";
import { createGapController } from "../dist/gap-controls.js";
function fakeClock() {
  let now = 0,
    serial = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++serial;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}
test("segundos entre canciones: rango 0–60 y enteros", () => {
  for (const [value, expected] of [
    [-1, 0],
    [3.5, 4],
    [99, 60],
    [0, 0],
    [NaN, 0],
    [undefined, 0],
  ])
    assert.equal(normalizeGapSeconds(value), expected);
});
test("espera exactamente el intervalo y se puede cancelar sin reproducción tardía", () => {
  const clock = fakeClock(),
    ticks = [];
  let calls = 0;
  const gap = createGapController((value) => ticks.push(value), clock);
  gap.schedule(() => calls++, 3);
  assert.equal(gap.waiting, true);
  clock.advance(2999);
  assert.equal(calls, 0);
  clock.advance(1);
  assert.equal(calls, 1);
  assert.equal(gap.waiting, false);
  gap.schedule(() => calls++, 5);
  clock.advance(1000);
  gap.cancel();
  clock.advance(10000);
  assert.equal(calls, 1);
  gap.schedule(() => calls++, 0);
  assert.equal(calls, 2);
  assert.ok(ticks.includes(3));
});
