import test from "node:test";
import assert from "node:assert/strict";
import { parseBulletLines, validateBulletInput, normalizeGrounding, interpretTailorResponse, formatCostUsd, MAX_BULLETS, MAX_BULLET_LENGTH } from "../src/lib/tailoring.js";

test("parseBulletLines: one per line, strips list markers, drops blanks, keeps '5+ years' intact", () => {
  const text = "- Built APIs\n* Led a team\n\u2022 Shipped v2\n1. Fixed bugs\n2) Wrote docs\n\n   \n5+ years of Node.js\r\nPlain line";
  assert.deepEqual(parseBulletLines(text), ["Built APIs", "Led a team", "Shipped v2", "Fixed bugs", "Wrote docs", "5+ years of Node.js", "Plain line"]);
  assert.deepEqual(parseBulletLines(undefined), []);
});

test("validateBulletInput: mirrors the server limits (1-20 bullets, <=500 chars each)", () => {
  assert.equal(validateBulletInput("").valid, false);
  assert.equal(validateBulletInput("   \n  ").valid, false);
  assert.deepEqual(validateBulletInput("Built X.").bullets, ["Built X."]);

  const tooMany = Array.from({ length: MAX_BULLETS + 1 }, (_, i) => `b${i}`).join("\n");
  assert.match(validateBulletInput(tooMany).errors[0], /at most 20/);

  const atLimit = Array.from({ length: MAX_BULLETS }, (_, i) => `b${i}`).join("\n");
  assert.equal(validateBulletInput(atLimit).valid, true);

  const long = "x".repeat(MAX_BULLET_LENGTH + 1);
  const r = validateBulletInput(`ok\n${long}`);
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /Bullet 2 is 501 characters/);
  assert.equal(validateBulletInput("x".repeat(MAX_BULLET_LENGTH)).valid, true);
});

const goodData = {
  bullets: ["A.", "B."],
  grounding: [
    { index: 0, status: "accepted", issues: [] },
    { index: 1, status: "reverted_to_original", issues: [{ type: "new_term", value: "Kubernetes", inJobDescription: true }, { type: "new_number", value: "40%", inJobDescription: false }], rejectedText: "B on Kubernetes by 40%." },
  ],
  usage: { model: "gpt-5.6-luna", promptTokens: 120, completionTokens: 40, costUsd: 0.000072 },
};

test("interpretTailorResponse: 201 success carries bullets, grounding and usage exactly as returned", () => {
  const r = interpretTailorResponse({ ok: true, status: 201, data: goodData });
  assert.equal(r.kind, "success");
  assert.deepEqual(r.bullets, ["A.", "B."]);
  assert.equal(r.grounding[1].status, "reverted_to_original");
  assert.deepEqual(r.grounding[1].issues.map((i) => i.value), ["Kubernetes", "40%"]);
  assert.equal(r.grounding[1].issues[0].inJobDescription, true);
  assert.equal(r.grounding[1].rejectedText, "B on Kubernetes by 40%.");
  assert.deepEqual(r.usage, { model: "gpt-5.6-luna", promptTokens: 120, completionTokens: 40, costUsd: 0.000072 });
});

test("interpretTailorResponse: missing/malformed grounding or usage becomes null — never invented", () => {
  const noGrounding = interpretTailorResponse({ ok: true, status: 201, data: { bullets: ["A."] } });
  assert.equal(noGrounding.kind, "success");
  assert.equal(noGrounding.grounding, null);
  assert.equal(noGrounding.usage, null);

  assert.equal(normalizeGrounding([{ status: "weird" }], 1), null, "unknown status rejected");
  assert.equal(normalizeGrounding([{ status: "accepted", issues: [] }], 2), null, "length mismatch rejected");
  assert.equal(normalizeGrounding("nope", 1), null);

  const partial = interpretTailorResponse({ ok: true, status: 201, data: { bullets: ["A."], usage: { model: "m", costUsd: "abc" } } });
  assert.equal(partial.usage.costUsd, null);
  assert.equal(partial.usage.promptTokens, null);
});

test("interpretTailorResponse: unexpected success shape is an error, not a blank result", () => {
  for (const data of [{}, { bullets: [] }, { bullets: [1, 2] }, null]) {
    assert.equal(interpretTailorResponse({ ok: true, status: 201, data }).kind, "error");
  }
});

test("interpretTailorResponse: 401 -> unauthorized; abort -> aborted; 400 messages; 502 message; fallback", () => {
  assert.equal(interpretTailorResponse({ ok: false, status: 401, data: { error: "unauthorized" } }).kind, "unauthorized");
  assert.equal(interpretTailorResponse({ ok: false, status: 0, aborted: true, data: {} }).kind, "aborted");
  assert.deepEqual(interpretTailorResponse({ ok: false, status: 400, data: { messages: ["baseBullets must contain at least one bullet"] } }).messages, ["baseBullets must contain at least one bullet"]);
  assert.deepEqual(interpretTailorResponse({ ok: false, status: 502, data: { error: "llm_request_failed", message: "Could not reach the tailoring service." } }).messages, ["Could not reach the tailoring service."]);
  const fallback = interpretTailorResponse({ ok: false, status: 500, data: { stack: "Error: secret internals at /srv/app.js" } });
  assert.equal(fallback.kind, "error");
  assert.ok(!JSON.stringify(fallback).includes("secret internals"), "raw error bodies are never surfaced");
});

test("formatCostUsd", () => {
  assert.equal(formatCostUsd(0.000072), "$0.000072");
  assert.equal(formatCostUsd(null), null);
  assert.equal(formatCostUsd(NaN), null);
});

test("interpretTailorResponse: a client timeout is a visible error, not silently dropped", () => {
  const r = interpretTailorResponse({ ok: false, status: 0, timedOut: true, data: { error: "timeout" } });
  assert.equal(r.kind, "error");
  assert.match(r.messages[0], /took too long/);
});
