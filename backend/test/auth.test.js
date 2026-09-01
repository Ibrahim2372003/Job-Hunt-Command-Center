import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "1R.=hS-d:|2LIna>>,}:sp";

const { hashPassword, verifyPassword, signToken, verifyToken } = await import("../src/auth.js");

test("hashPassword + verifyPassword: round-trips correctly", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.notEqual(hash, "correct-horse-battery-staple", "must not store the plaintext");
  assert.equal(await verifyPassword("correct-horse-battery-staple", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("signToken + verifyToken: round-trips the user id", () => {
  const token = signToken("user-123");
  assert.equal(verifyToken(token), "user-123");
});

test("verifyToken: returns null (not a throw) for a malformed token", () => {
  assert.equal(verifyToken("not-a-real-token"), null);
});

test("verifyToken: returns null for a token signed with a different secret", () => {
  const foreignToken = jwt.sign({ sub: "user-123" }, "a-different-secret", { expiresIn: "1h" });
  assert.equal(verifyToken(foreignToken), null);
});

test("verifyToken: returns null for an expired token", () => {
  const expiredToken = jwt.sign({ sub: "user-123" }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal(verifyToken(expiredToken), null);
});
