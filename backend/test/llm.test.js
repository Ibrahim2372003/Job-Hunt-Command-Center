import test from "node:test";
import assert from "node:assert/strict";
import { parseTailoredBullets, computeCostUsd, tailorBullets, TailorOutputError } from "../src/llm.js";

test("parseTailoredBullets: valid JSON array of strings passes and trims", () => {
  const result = parseTailoredBullets('["  Built X.  ", "Led Y."]');
  assert.deepEqual(result, ["Built X.", "Led Y."]);
});

test("parseTailoredBullets: valid { bullets: [...] } object (OpenAI structured-output shape) passes", () => {
  const result = parseTailoredBullets('{"bullets": ["  Built X.  ", "Led Y."]}');
  assert.deepEqual(result, ["Built X.", "Led Y."]);
});

test("parseTailoredBullets: rejects non-JSON text", () => {
  assert.throws(() => parseTailoredBullets("Sure, here are your bullets:\n- Built X."), /not valid JSON/);
});

test("parseTailoredBullets: rejects an object without a bullets array", () => {
  assert.throws(() => parseTailoredBullets('{"notBullets": ["Built X."]}'), /not a JSON array/);
});

test("parseTailoredBullets: rejects an empty array", () => {
  assert.throws(() => parseTailoredBullets("[]"), /empty array/);
});

test("parseTailoredBullets: rejects an empty bullets array in the object shape", () => {
  assert.throws(() => parseTailoredBullets('{"bullets": []}'), /empty array/);
});

test("parseTailoredBullets: rejects a non-string element", () => {
  assert.throws(() => parseTailoredBullets('["Built X.", 42]'), /non-string or empty/);
});

test("parseTailoredBullets: rejects an empty-string element", () => {
  assert.throws(() => parseTailoredBullets('["Built X.", "   "]'), /non-string or empty/);
});

test("parseTailoredBullets: rejects more than 20 bullets", () => {
  const tooMany = JSON.stringify(Array.from({ length: 21 }, (_, i) => `Bullet ${i}`));
  assert.throws(() => parseTailoredBullets(tooMany), /more than 20/);
});

test("computeCostUsd: computes from the pricing table (gpt-5.6-luna: $0.20/M input, $1.20/M output)", () => {
  const cost = computeCostUsd("gpt-5.6-luna", 1_000_000, 1_000_000);
  assert.equal(cost, 1.4);
});

test("computeCostUsd: zero tokens costs zero", () => {
  assert.equal(computeCostUsd("gpt-5.6-luna", 0, 0), 0);
});

test("computeCostUsd: throws for an unpriced model", () => {
  assert.throws(() => computeCostUsd("some-unknown-model", 100, 100), /No pricing configured/);
});

// --- tailorBullets with a STUB client (no network, no real API key) ---
// Shape matches the official OpenAI SDK's Responses API:
// client.responses.create(...) -> { usage: { input_tokens, output_tokens }, output_text }

function makeStubClient(outputText, usage = { input_tokens: 100, output_tokens: 50 }) {
  return {
    responses: {
      create: async () => ({ usage, output_text: outputText }),
    },
  };
}

test("tailorBullets: with a stub client, returns bullets + usage + cost on valid structured output", async () => {
  const client = makeStubClient('{"bullets": ["Tailored bullet one.", "Tailored bullet two."]}');
  const result = await tailorBullets(client, { jobDescription: "A backend role.", baseBullets: ["Did a thing."] });

  assert.deepEqual(result.bullets, ["Tailored bullet one.", "Tailored bullet two."]);
  assert.equal(result.model, "gpt-5.6-luna");
  assert.equal(result.promptTokens, 100);
  assert.equal(result.completionTokens, 50);
  assert.ok(result.costUsd > 0);
});

test("tailorBullets: with a stub client returning malformed output, throws TailorOutputError carrying real usage/cost", async () => {
  const client = makeStubClient("Sorry, I can't format that as JSON.", { input_tokens: 80, output_tokens: 20 });

  await assert.rejects(
    () => tailorBullets(client, { jobDescription: "A backend role.", baseBullets: ["Did a thing."] }),
    (err) => {
      assert.ok(err instanceof TailorOutputError);
      assert.equal(err.promptTokens, 80);
      assert.equal(err.completionTokens, 20);
      assert.ok(err.costUsd > 0, "cost was still incurred even though output was unusable");
      assert.equal(err.rawText, "Sorry, I can't format that as JSON.");
      return true;
    }
  );
});

test("tailorBullets: a hard client failure (e.g. network/auth) propagates without usage data", async () => {
  const client = {
    responses: {
      create: async () => {
        throw new Error("simulated network failure");
      },
    },
  };

  await assert.rejects(
    () => tailorBullets(client, { jobDescription: "A backend role.", baseBullets: ["Did a thing."] }),
    (err) => {
      assert.ok(!(err instanceof TailorOutputError), "a request-level failure should not be a TailorOutputError");
      assert.match(err.message, /simulated network failure/);
      return true;
    }
  );
});
