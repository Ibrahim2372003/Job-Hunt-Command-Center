import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiClient } from "../src/gemini.js";

test("gemini client: sends schema without additionalProperties and maps usage", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"bullets":["a"]}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 1 },
      }),
    };
  };
  const client = createGeminiClient({ apiKey: "k", fetchImpl });
  const out = await client.responses.create({
    model: "gemini-3.5-flash-lite",
    instructions: "sys",
    input: "hi",
    text: { format: { schema: { type: "object", properties: { bullets: { type: "array", items: { type: "string" } } }, additionalProperties: false } } },
  });
  assert.equal(out.output_text, '{"bullets":["a"]}');
  assert.deepEqual(out.usage, { input_tokens: 10, output_tokens: 5 });
  assert.ok(sent.url.includes("gemini-3.5-flash-lite:generateContent"));
  assert.equal(sent.init.headers["x-goog-api-key"], "k");
  assert.equal(JSON.stringify(sent.body).includes("additionalProperties"), false);
});

test("gemini client: missing key and API errors throw", async () => {
  await assert.rejects(createGeminiClient({ apiKey: "" }).responses.create({ model: "m", instructions: "", input: "" }), /GEMINI_API_KEY/);
  const bad = createGeminiClient({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 429, text: async () => "quota" }) });
  await assert.rejects(bad.responses.create({ model: "m", instructions: "", input: "" }), /429/);
});
