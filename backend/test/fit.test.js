import test from "node:test";
import assert from "node:assert/strict";
import { assessFit, keyTerms } from "../src/fit.js";

const reqs = [
  { text: "5+ years of Node.js experience", importance: "required" },
  { text: "Kubernetes", importance: "preferred" },
  { text: "Strong communication skills", importance: "unspecified" },
  { text: "Experience with PostgreSQL and Redis", importance: "required" },
];

const evidence = [
  { id: "b1", text: "Built REST APIs in Node.js for a payments platform over five years." },
  { id: "b2", text: "Designed PostgreSQL schemas and migrations." },
];

test("keyTerms: drops generic words and keeps distinctive ones", () => {
  assert.deepEqual(keyTerms("Strong experience with PostgreSQL and Redis"), ["postgresql", "redis"]);
  assert.deepEqual(keyTerms("Strong communication skills"), ["communication"]);
});

test("assessFit: supported, partial, missing statuses with the evidence behind each", () => {
  const { rows, summary } = assessFit(reqs, evidence);
  const byReq = Object.fromEntries(rows.map((r) => [r.requirement, r]));

  assert.equal(byReq["5+ years of Node.js experience"].status, "supported");
  assert.equal(byReq["5+ years of Node.js experience"].matchedEvidence[0].id, "b1");
  assert.equal(byReq["Experience with PostgreSQL and Redis"].status, "partial");
  assert.match(byReq["Experience with PostgreSQL and Redis"].explanation, /redis/i);
  assert.equal(byReq["Kubernetes"].status, "missing");
  assert.match(byReq["Kubernetes"].explanation, /may reflect missing detail/);
  assert.deepEqual(summary, { supported: 1, partial: 1, missing: 2, unclear: 0, total: 4 });
});

test("assessFit: with NO evidence supplied, nothing is 'missing' — everything is 'unclear'", () => {
  const { rows, summary } = assessFit(reqs, []);
  assert.ok(rows.every((r) => r.status === "unclear"));
  assert.equal(summary.missing, 0);
  assert.equal(summary.unclear, 4);
});

test("assessFit: blank evidence items are ignored (same as no evidence)", () => {
  const { summary } = assessFit(reqs, [{ id: "x", text: "   " }, null]);
  assert.equal(summary.unclear, 4);
});

test("assessFit: a requirement with no distinctive terms is unclear, not missing", () => {
  const { rows } = assessFit([{ text: "Good team player with strong ability" }], evidence);
  assert.equal(rows[0].status, "unclear");
});

test("assessFit: reports method and limitations, and exposes no single score", () => {
  const result = assessFit(reqs, evidence);
  assert.equal(result.method, "lexical-overlap-v1");
  assert.ok(result.limitations.length >= 2);
  assert.equal("score" in result, false);
  assert.equal("score" in result.summary, false);
});

test("assessFit: plural/singular wording still matches", () => {
  const { rows } = assessFit([{ text: "Build REST APIs" }], [{ id: "e", text: "Maintained a REST API for billing." }]);
  assert.ok(["supported", "partial"].includes(rows[0].status));
  assert.ok(rows[0].matchedEvidence.length > 0);
});
