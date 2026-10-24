import test from "node:test";
import assert from "node:assert/strict";
import { createSingleFlight } from "../src/lib/singleFlight.js";

test("singleFlight: a second run while one is active is skipped and does not execute", async () => {
  const flight = createSingleFlight();
  let release;
  let executions = 0;
  const first = flight.run(() => { executions++; return new Promise((r) => { release = r; }); });
  assert.equal(flight.running, true);

  const second = await flight.run(() => { executions++; });
  assert.deepEqual(second, { skipped: true });
  assert.equal(executions, 1);

  release("ok");
  assert.deepEqual(await first, { skipped: false, value: "ok" });
  assert.equal(flight.running, false);
});

test("singleFlight: the lock is released when the guarded function THROWS (the stuck-button bug)", async () => {
  const flight = createSingleFlight();
  await assert.rejects(() => flight.run(async () => { throw new Error("unexpected"); }), /unexpected/);
  assert.equal(flight.running, false, "guard must not stay set after an exception");

  const again = await flight.run(async () => "recovered");
  assert.deepEqual(again, { skipped: false, value: "recovered" });
});

test("singleFlight: also released after a synchronous throw and after normal completion", async () => {
  const flight = createSingleFlight();
  await assert.rejects(() => flight.run(() => { throw new Error("sync"); }), /sync/);
  assert.equal(flight.running, false);
  await flight.run(async () => {});
  assert.equal(flight.running, false);
});
