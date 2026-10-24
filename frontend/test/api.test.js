import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch, apiFetchBlob } from "../src/api.js";

function withFetch(impl, fn) {
  return async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
    try { await fn(calls); } finally { globalThis.fetch = original; }
  };
}

const jsonRes = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("apiFetch: sends bearer token and JSON body; defaults to localhost:5000", withFetch(async () => jsonRes(201, { ok: 1 }), async (calls) => {
  const r = await apiFetch("/applications/1/tailor", { method: "POST", body: { baseBullets: ["a"] }, token: "tok" });
  assert.deepEqual(r, { ok: true, status: 201, data: { ok: 1 } });
  assert.equal(calls[0].url, "http://localhost:5000/applications/1/tailor");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ baseBullets: ["a"] }));
}));

test("apiFetch: network failure returns a normalized error instead of throwing", withFetch(async () => { throw new TypeError("Failed to fetch"); }, async () => {
  const r = await apiFetch("/x");
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(r.data.error, "network_error");
}));

test("apiFetch: non-JSON body (e.g. an HTML 502 from a proxy) is normalized, not thrown", withFetch(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }), async () => {
  const r = await apiFetch("/x");
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.data.error, "invalid_response");
  assert.ok(!JSON.stringify(r).includes("Bad gateway"));
}));

test("apiFetch: abort is reported as aborted, and the signal is passed through", withFetch(async (_u, init) => {
  const err = new Error("aborted"); err.name = "AbortError";
  if (init.signal?.aborted) throw err;
  return jsonRes(200, {});
}, async (calls) => {
  const ctrl = new AbortController(); ctrl.abort();
  const r = await apiFetch("/x", { signal: ctrl.signal });
  assert.equal(r.aborted, true);
  assert.equal(calls[0].init.signal, ctrl.signal);
}));

test("apiFetchBlob: returns a Blob for a PDF and sends the bearer token", withFetch(async () => new Response("%PDF-1.4 fake", { status: 200, headers: { "content-type": "application/pdf" } }), async (calls) => {
  const r = await apiFetchBlob("/applications/1/report/file", { token: "tok" });
  assert.equal(r.ok, true);
  assert.ok(r.blob instanceof Blob);
  assert.equal(await r.blob.text(), "%PDF-1.4 fake");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.headers["Content-Type"], undefined);
}));

test("apiFetchBlob: 409 not_ready JSON error is surfaced as a failure with the server's message", withFetch(async () => jsonRes(409, { error: "not_ready", message: "The report is not ready yet." }), async () => {
  const r = await apiFetchBlob("/f");
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.data.message, "The report is not ready yet.");
}));

test("apiFetchBlob: 401 keeps its status so the caller can log out", withFetch(async () => jsonRes(401, { error: "unauthorized", message: "Invalid or expired token." }), async () => {
  assert.equal((await apiFetchBlob("/f")).status, 401);
}));

test("apiFetchBlob: a 200 that is not a PDF is a failure (never a wrong file)", withFetch(async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }), async () => {
  const r = await apiFetchBlob("/f");
  assert.equal(r.ok, false);
  assert.equal(r.data.error, "invalid_response");
}));

test("apiFetchBlob: non-JSON error body and network failure both normalize", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("oops", { status: 500, headers: { "content-type": "text/plain" } });
    const a = await apiFetchBlob("/f");
    assert.equal(a.ok, false);
    assert.equal(a.status, 500);
    assert.equal(a.data.error, "request_failed");
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    assert.equal((await apiFetchBlob("/f")).data.error, "network_error");
  } finally { globalThis.fetch = original; }
});
