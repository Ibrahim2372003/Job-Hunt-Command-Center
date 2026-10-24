/**
 * A re-entrancy guard whose lock is ALWAYS released, even if the guarded
 * function throws or rejects. The panels previously set/cleared boolean refs
 * with plain statements around an `await`, so any exception in between left
 * the guard stuck and the button dead until reload.
 *
 *   const { skipped, value } = await flight.run(async () => { ... });
 *
 * While a run is active, further `run()` calls resolve immediately with
 * `{ skipped: true }` and do not execute their function.
 */
export function createSingleFlight() {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run(fn) {
      if (running) return { skipped: true };
      running = true;
      try {
        return { skipped: false, value: await fn() };
      } finally {
        running = false;
      }
    },
  };
}
