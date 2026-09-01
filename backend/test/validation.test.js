import test from "node:test";
import assert from "node:assert/strict";
import { validateApplicationInput, validateSignupInput, validateLoginInput, validateTailorInput } from "../src/validation.js";

test("valid input passes and trims strings", () => {
  const result = validateApplicationInput({
    company: "  Acme Corp  ",
    role: " Backend Engineer ",
    jobDescription: " Build things. ",
  });
  assert.equal(result.valid, true);
  assert.equal(result.data.company, "Acme Corp");
  assert.equal(result.data.role, "Backend Engineer");
  assert.equal(result.data.jobDescription, "Build things.");
  assert.equal(result.data.jobUrl, null);
});

test("missing required fields are all reported at once", () => {
  const result = validateApplicationInput({});
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.sort(), ["company is required", "jobDescription is required", "role is required"].sort());
});

test("whitespace-only fields count as missing", () => {
  const result = validateApplicationInput({ company: "   ", role: "Engineer", jobDescription: "Do things" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["company is required"]);
});

test("optional jobUrl is accepted when present and trimmed", () => {
  const result = validateApplicationInput({
    company: "Acme",
    role: "Engineer",
    jobDescription: "Do things",
    jobUrl: "  https://acme.example/jobs/1  ",
  });
  assert.equal(result.valid, true);
  assert.equal(result.data.jobUrl, "https://acme.example/jobs/1");
});

test("valid status is accepted", () => {
  const result = validateApplicationInput({ company: "Acme", role: "Engineer", jobDescription: "Do things", status: "APPLIED" });
  assert.equal(result.valid, true);
  assert.equal(result.data.status, "APPLIED");
});

test("invalid status is rejected with the allowed list", () => {
  const result = validateApplicationInput({ company: "Acme", role: "Engineer", jobDescription: "Do things", status: "MAYBE" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /status must be one of SAVED, APPLIED, INTERVIEW, OFFER, REJECTED/);
});

test("non-string fields are treated as missing rather than throwing", () => {
  const result = validateApplicationInput({ company: 123, role: null, jobDescription: undefined });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
});

test("validateSignupInput: valid email + password passes, email is lowercased and trimmed", () => {
  const result = validateSignupInput({ email: "  User@Example.com ", password: "longenough" });
  assert.equal(result.valid, true);
  assert.equal(result.data.email, "user@example.com");
  assert.equal(result.data.password, "longenough");
});

test("validateSignupInput: rejects malformed email", () => {
  const result = validateSignupInput({ email: "not-an-email", password: "longenough" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("valid email")));
});

test("validateSignupInput: rejects short password", () => {
  const result = validateSignupInput({ email: "user@example.com", password: "short" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("at least 8 characters")));
});

test("validateSignupInput: missing fields are both reported", () => {
  const result = validateSignupInput({});
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["email is required", "password is required"]);
});

test("validateLoginInput: does not enforce password length (only presence)", () => {
  const result = validateLoginInput({ email: "user@example.com", password: "x" });
  assert.equal(result.valid, true);
  assert.equal(result.data.password, "x");
});

test("validateLoginInput: missing fields are reported", () => {
  const result = validateLoginInput({});
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["email is required", "password is required"]);
});

test("validateTailorInput: valid array of bullets passes and trims", () => {
  const result = validateTailorInput({ baseBullets: ["  Built X.  ", "Led Y."] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data.baseBullets, ["Built X.", "Led Y."]);
});

test("validateTailorInput: missing baseBullets is rejected", () => {
  const result = validateTailorInput({});
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /required and must be an array/);
});

test("validateTailorInput: non-array baseBullets is rejected", () => {
  const result = validateTailorInput({ baseBullets: "not an array" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /required and must be an array/);
});

test("validateTailorInput: empty array is rejected", () => {
  const result = validateTailorInput({ baseBullets: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("at least one bullet")));
});

test("validateTailorInput: more than 20 bullets is rejected", () => {
  const result = validateTailorInput({ baseBullets: Array.from({ length: 21 }, (_, i) => `Bullet ${i}`) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("at most 20")));
});

test("validateTailorInput: a non-string or empty-string bullet is rejected", () => {
  const result = validateTailorInput({ baseBullets: ["Fine.", "   ", 42] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("non-empty string")));
});

test("validateTailorInput: an oversized bullet is rejected", () => {
  const result = validateTailorInput({ baseBullets: ["x".repeat(501)] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("at most 500 characters")));
});
