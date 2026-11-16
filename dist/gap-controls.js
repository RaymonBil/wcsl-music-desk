import { normalizeGapSeconds } from "./library-core.js";

export function createGapController(
  onTick,
  clock = {
    now: () => Date.now(),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (timer) => clearTimeout(timer),
  },
) {
  let timer = null;
  let token = 0;
  let active = false;
  function cancel() {
    token++;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    active = false;
    onTick(null);
  }
  function schedule(callback, seconds) {
    cancel();
    const delay = normalizeGapSeconds(seconds);
    if (!delay) {
      callback();
      return;
    }
    active = true;
    const currentToken = token;
    const deadline = clock.now() + delay * 1000;
    const tick = () => {
      if (currentToken !== token) return;
      const remaining = Math.max(0, Math.ceil((deadline - clock.now()) / 1000));
      if (!remaining) {
        active = false;
        timer = null;
        onTick(null);
        callback();
        return;
      }
      onTick(remaining);
      timer = clock.setTimeout(tick, Math.min(250, deadline - clock.now()));
    };
    tick();
  }
  return {
    schedule,
    cancel,
    get waiting() {
      return active;
    },
  };
}
