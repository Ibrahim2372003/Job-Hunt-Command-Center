const DEFAULT_MODEL = "gpt-5.6-luna";

// Prices are $ per million tokens. Verified against OpenAI's own
// pricing announcement (openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6,
// July 30, 2026 price cut, confirmed still current as of this
// writing): gpt-5.6-luna is $0.20/1M input, $1.20/1M output. Luna is
// OpenAI's own designated "most cost-efficient" tier of the GPT-5.6
// family, described in OpenAI's model guidance as suited to
// "efficient, high-volume workloads" — a good fit for this narrow,
// structured, single-turn task. Re-check https://openai.com/api/pricing
// before relying on these numbers long-term; OpenAI revises pricing
// periodically (this model's own rate changed 80% on July 30, 2026).
const PRICING_PER_MILLION_TOKENS = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

const MAX_BULLETS_OUT = 20;

/**
 * Thrown when the OpenAI API responded successfully (so real usage —
 * and therefore real cost — was incurred) but the response didn't
 * parse into the shape we need. Carries the usage/cost data so the
 * caller can still log what was spent, per the "log cost for
 * API-response failures where usage data is available" requirement.
 * A hard request failure (network, auth, rate limit) is a plain
 * Error instead — there's no usage to attach because no response
 * came back.
 */
export class TailorOutputError extends Error {
  constructor(message, { rawText, model, promptTokens, completionTokens, costUsd }) {
    super(message);
    this.name = "TailorOutputError";
    this.rawText = rawText;
    this.model = model;
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
    this.costUsd = costUsd;
  }
}

export function computeCostUsd(model, promptTokens, completionTokens) {
  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) {
    throw new Error(`No pricing configured for model "${model}"`);
  }
  const cost = (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal places, avoids float noise
}

function buildPrompt(jobDescription, baseBullets) {
  const instructions =
    "You tailor resume bullet points to a specific job description. " +
    "Rewrite each bullet to emphasize relevant skills and keywords from the job description. " +
    "Never invent experience, tools, employers, or metrics the person didn't provide. " +
    "Return your answer as a JSON object matching the required schema — one tailored bullet " +
    "per input bullet, same order, same count.";

  const input =
    `Job description:\n${jobDescription}\n\n` +
    `Base resume bullets (tailor each one, keep the same count):\n` +
    baseBullets.map((b, i) => `${i + 1}. ${b}`).join("\n");

  return { instructions, input };
}

// OpenAI's structured-output schemas must have an object at the root
// (not a bare array), so the model returns { "bullets": [...] }
// rather than a top-level array. `strict: true` + `additionalProperties:
// false` gets the SDK's own schema-conformance guarantee; the
// application-level validation below still runs on top of that
// (defense in depth, and it's what makes this testable with a stub
// client that doesn't actually enforce the schema).
const TAILORED_BULLETS_SCHEMA = {
  type: "object",
  properties: {
    bullets: { type: "array", items: { type: "string" } },
  },
  required: ["bullets"],
  additionalProperties: false,
};

/**
 * Parses and validates the model's raw text output. Pure — no
 * network, no OpenAI types — so it's directly unit-testable against
 * arbitrary strings, including malformed ones a real model could
 * plausibly return. Accepts either a bare JSON array of strings or
 * the `{ "bullets": [...] }` object shape OpenAI's structured outputs
 * require at the root, so this function's own contract doesn't need
 * to change if a future provider naturally returns a bare array.
 */
export function parseTailoredBullets(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Model output was not valid JSON.");
  }

  let bullets = parsed;
  if (!Array.isArray(parsed) && parsed && typeof parsed === "object" && Array.isArray(parsed.bullets)) {
    bullets = parsed.bullets;
  }

  if (!Array.isArray(bullets)) {
    throw new Error("Model output was not a JSON array (or an object with a bullets array).");
  }
  if (bullets.length === 0) {
    throw new Error("Model output was an empty array.");
  }
  if (bullets.length > MAX_BULLETS_OUT) {
    throw new Error(`Model output had more than ${MAX_BULLETS_OUT} bullets.`);
  }
  if (!bullets.every((b) => typeof b === "string" && b.trim().length > 0)) {
    throw new Error("Model output contained a non-string or empty bullet.");
  }

  return bullets.map((b) => b.trim());
}

/**
 * The one narrow AI job: tailor resume bullets to a job description.
 * `openaiClient` is injected — production passes a real official
 * `openai` SDK client (see app.js's default), tests pass a stub with
 * a `responses.create` that returns a canned response, so this — and
 * everything that calls it — is fully testable without a real API key.
 */
export async function tailorBullets(openaiClient, { jobDescription, baseBullets, model = DEFAULT_MODEL }) {
  const { instructions, input } = buildPrompt(jobDescription, baseBullets);

  // Let a hard request failure (network, auth, rate limit, etc.)
  // propagate as-is — there's no usage to attach to it.
  const response = await openaiClient.responses.create({
    model,
    instructions,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "tailored_bullets",
        strict: true,
        schema: TAILORED_BULLETS_SCHEMA,
      },
    },
  });

  const promptTokens = response.usage?.input_tokens ?? 0;
  const completionTokens = response.usage?.output_tokens ?? 0;
  const costUsd = computeCostUsd(model, promptTokens, completionTokens);

  const rawText = response.output_text ?? "";

  try {
    const bullets = parseTailoredBullets(rawText);
    return { bullets, model, promptTokens, completionTokens, costUsd };
  } catch (err) {
    // The API call succeeded — real usage was incurred — but the
    // output didn't validate. Attach the usage/cost so the caller can
    // still log what was spent.
    throw new TailorOutputError(err.message, { rawText, model, promptTokens, completionTokens, costUsd });
  }
}
