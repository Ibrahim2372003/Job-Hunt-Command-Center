// Minimal Gemini client that exposes the same `responses.create(...)` shape
// the rest of the backend already uses (tailorBullets, analyzeJobDescription),
// so swapping providers does not touch the prompts, parsing or grounding.
// Uses Gemini's REST generateContent endpoint with structured JSON output.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Gemini's responseSchema accepts an OpenAPI subset: no additionalProperties.
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "additionalProperties") continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

export function createGeminiClient({ apiKey = process.env.GEMINI_API_KEY, fetchImpl = fetch } = {}) {
  return {
    responses: {
      async create({ model, instructions, input, text }, options = {}) {
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY is not set.");
        }
        const generationConfig = { responseMimeType: "application/json" };
        const schema = text?.format?.schema;
        if (schema) generationConfig.responseSchema = toGeminiSchema(schema);

        const res = await fetchImpl(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instructions }] },
            contents: [{ role: "user", parts: [{ text: input }] }],
            generationConfig,
          }),
          signal: AbortSignal.timeout(options.timeout ?? 45_000),
        });

        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          throw new Error(`Gemini API error ${res.status}: ${detail}`);
        }
        const data = await res.json();
        const output_text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        return {
          output_text,
          usage: {
            input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
            output_tokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
          },
        };
      },
    },
  };
}
