import test from "node:test";
import assert from "node:assert/strict";
import { interpretReportStatusResponse, interpretReportRequestResponse, nextActionBeforeRetry, pollReportStatus, reportFilename, MAX_POLL_ATTEMPTS } from "../src/lib/reports.js";

test("status: only a server-confirmed 'done' is done", () => {
  assert.equal(interpretReportStatusResponse({ ok: true, status: 200, data: { status: "done", reportId: "r", url: "/x" } }).kind, "done");
  assert.equal(interpretReportStatusResponse({ ok: true, status: 200, data: { status: "pending" } }).kind, "pending");
  // Anything else — unknown status, wrong shape — must NOT read as done.
  for (const data of [{ status: "ready" }, { status: "DONE" }, {}, null, { url: "/x" }]) {
    assert.notEqual(interpretReportStatusResponse({ ok: true, status: 200, data }).kind, "done");
  }
  assert.notEqual(interpretReportStatusResponse({ ok: false, status: 500, data: { status: "done" } }).kind, "done", "a non-2xx never counts as done");
});

test("status: failed carries the backend's safe message, with a fallback", () => {
  const r = interpretReportStatusResponse({ ok: true, status: 200, data: { status: "failed", error: "Report generation failed. Please try requesting the report again." } });
  assert.equal(r.kind, "failed");
  assert.match(r.message, /try requesting/);
  assert.match(interpretReportStatusResponse({ ok: true, status: 200, data: { status: "failed", error: null } }).message, /try again/);
});

test("status: 404 'no report requested' is 'none'; other 404/401/5xx/network are distinguished", () => {
  assert.equal(interpretReportStatusResponse({ ok: false, status: 404, data: { error: "not_found", message: "No report has been requested for this application yet." } }).kind, "none");
  const appGone = interpretReportStatusResponse({ ok: false, status: 404, data: { error: "not_found", message: 'No application with id "x".' } });
  assert.equal(appGone.kind, "error");
  assert.equal(interpretReportStatusResponse({ ok: false, status: 401, data: {} }).kind, "unauthorized");
  assert.equal(interpretReportStatusResponse({ ok: false, status: 500, data: { message: "Could not look up the application." } }).transient, true);
  assert.equal(interpretReportStatusResponse({ ok: false, status: 0, data: { message: "Could not reach the server." } }).transient, true);
  assert.equal(interpretReportStatusResponse({ ok: false, status: 403, data: {} }).transient, false);
});

test("request: 202 pending, 200 done, 400 needs_tailoring, 401, errors", () => {
  assert.equal(interpretReportRequestResponse({ ok: true, status: 202, data: { status: "pending", reportId: "r" } }).kind, "pending");
  assert.equal(interpretReportRequestResponse({ ok: true, status: 200, data: { status: "done", reportId: "r" } }).kind, "done");
  const nt = interpretReportRequestResponse({ ok: false, status: 400, data: { error: "no_tailored_resume", message: "This application has no tailored resume yet. Tailor a resume first, then request a report." } });
  assert.equal(nt.kind, "needs_tailoring");
  assert.match(nt.message, /Tailor a resume first/);
  assert.equal(interpretReportRequestResponse({ ok: false, status: 401, data: {} }).kind, "unauthorized");
  assert.equal(interpretReportRequestResponse({ ok: false, status: 500, data: { message: "Could not request the report." } }).kind, "error");
  assert.equal(interpretReportRequestResponse({ ok: true, status: 202, data: { status: "done" } }).kind, "error", "202 must say pending");
});

const noSleep = async () => {};

test("poll: pending then done resolves done, one request at a time, with growing-then-capped delays", async () => {
  const sleeps = [];
  let inFlight = 0, maxInFlight = 0, calls = 0;
  const fetchStatus = async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--; calls++;
    return calls < 3 ? { kind: "pending" } : { kind: "done" };
  };
  const result = await pollReportStatus({ fetchStatus, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.kind, "done");
  assert.equal(calls, 3);
  assert.equal(maxInFlight, 1, "requests never overlap");
  assert.deepEqual(sleeps, [1500, 2000, 3000]);
});

test("poll: never polls forever — stops at the attempt cap with 'timeout'", async () => {
  let calls = 0;
  const result = await pollReportStatus({ fetchStatus: async () => { calls++; return { kind: "pending" }; }, sleep: noSleep });
  assert.equal(result.kind, "timeout");
  assert.equal(calls, MAX_POLL_ATTEMPTS);
});

test("poll: delay is capped at the last configured value", async () => {
  const sleeps = [];
  await pollReportStatus({ fetchStatus: async () => ({ kind: "pending" }), sleep: async (ms) => sleeps.push(ms), maxAttempts: 8 });
  assert.equal(Math.max(...sleeps), 5000);
  assert.equal(sleeps.length, 8);
});

test("poll: failed and unauthorized stop immediately and pass through", async () => {
  let calls = 0;
  const failed = await pollReportStatus({ fetchStatus: async () => { calls++; return { kind: "failed", message: "boom" }; }, sleep: noSleep });
  assert.deepEqual(failed, { kind: "failed", message: "boom" });
  assert.equal(calls, 1);
  assert.equal((await pollReportStatus({ fetchStatus: async () => ({ kind: "unauthorized" }), sleep: noSleep })).kind, "unauthorized");
});

test("poll: tolerates isolated transient errors, gives up after 3 in a row, resets on success", async () => {
  const seq = [{ kind: "error", transient: true, message: "x" }, { kind: "pending" }, { kind: "error", transient: true, message: "x" }, { kind: "error", transient: true, message: "x" }, { kind: "done" }];
  let i = 0;
  assert.equal((await pollReportStatus({ fetchStatus: async () => seq[i++], sleep: noSleep })).kind, "done");

  let n = 0;
  const gaveUp = await pollReportStatus({ fetchStatus: async () => { n++; return { kind: "error", transient: true, message: "net down" }; }, sleep: noSleep });
  assert.equal(gaveUp.kind, "error");
  assert.equal(n, 3);

  const hard = await pollReportStatus({ fetchStatus: async () => ({ kind: "error", transient: false, message: "forbidden" }), sleep: noSleep });
  assert.equal(hard.kind, "error");
});

test("poll: cancellation (unmount) stops the loop before further requests", async () => {
  let cancelled = false, calls = 0;
  const result = await pollReportStatus({
    fetchStatus: async () => { calls++; cancelled = true; return { kind: "pending" }; },
    isCancelled: () => cancelled,
    sleep: noSleep,
  });
  assert.equal(result.kind, "cancelled");
  assert.equal(calls, 1);

  let c2 = 0;
  assert.equal((await pollReportStatus({ fetchStatus: async () => { c2++; return { kind: "pending" }; }, isCancelled: () => true, sleep: noSleep })).kind, "cancelled");
  assert.equal(c2, 0);
  assert.equal((await pollReportStatus({ fetchStatus: async () => ({ kind: "aborted" }), sleep: noSleep })).kind, "cancelled");
});

test("poll: 'none' after a request was accepted is surfaced as an error, not silently ignored", async () => {
  const r = await pollReportStatus({ fetchStatus: async () => ({ kind: "none" }), sleep: noSleep });
  assert.equal(r.kind, "error");
});

test("reportFilename: safe, readable, with fallback", () => {
  assert.equal(reportFilename({ company: "Acme Inc.", role: "Backend Engineer" }), "acme-inc-backend-engineer-report.pdf");
  assert.equal(reportFilename({ company: "../../etc", role: "" }), "etc-report.pdf");
  assert.equal(reportFilename({}), "application-report.pdf");
});

test("poll: a fetchStatus that THROWS is treated as a transient error — the loop neither crashes nor spins", async () => {
  let n = 0;
  const r = await pollReportStatus({ fetchStatus: async () => { n++; throw new Error("boom"); }, sleep: noSleep });
  assert.equal(r.kind, "error");
  assert.equal(n, 3, "gives up after 3 consecutive failures");

  const seq = [() => { throw new Error("boom"); }, () => ({ kind: "done" })];
  let i = 0;
  assert.equal((await pollReportStatus({ fetchStatus: async () => seq[i++](), sleep: noSleep })).kind, "done");
});

test("poll: a timed-out status check (status 0) is transient, so one hung request does not end polling", () => {
  const r = interpretReportStatusResponse({ ok: false, status: 0, timedOut: true, data: { error: "timeout", message: "The server took too long to respond. Please try again." } });
  assert.equal(r.kind, "error");
  assert.equal(r.transient, true);
});

test("nextActionBeforeRetry: after a FAILED report, look at server state before enqueueing another job", () => {
  assert.deepEqual(nextActionBeforeRetry({ kind: "pending" }), { type: "poll" }, "a server-side retry may be running: wait, don't enqueue a duplicate");
  assert.deepEqual(nextActionBeforeRetry({ kind: "done" }), { type: "apply" }, "it succeeded after all");
  assert.deepEqual(nextActionBeforeRetry({ kind: "failed", message: "x" }), { type: "request" });
  assert.deepEqual(nextActionBeforeRetry({ kind: "none" }), { type: "request" });
  assert.deepEqual(nextActionBeforeRetry({ kind: "error", transient: true, message: "x" }), { type: "apply" }, "unknown state: surface it instead of guessing");
  assert.deepEqual(nextActionBeforeRetry({ kind: "unauthorized" }), { type: "apply" });
});
