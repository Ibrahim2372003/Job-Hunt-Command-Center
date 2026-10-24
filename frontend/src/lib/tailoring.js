// Mirrors backend/src/validation.js validateTailorInput. The server stays the
// source of truth (it re-validates everything); these limits exist so the user
// gets instant feedback instead of a round trip. Keep in sync if they change.
export const MAX_BULLETS = 20;
export const MAX_BULLET_LENGTH = 500;

// Client-side wait for /tailor. The server allows its OpenAI call up to 45s
// with one retry (backend/src/llm.js REQUEST_OPTIONS), so wait longer than that.
export const TAILOR_TIMEOUT_MS = 120_000;

const LEADING_MARKER = /^\s*(?:[-*\u2022\u2013\u2014]|\d{1,2}[.)])\s+/;

/** One bullet per line; strips common list markers; drops blank lines. */
export function parseBulletLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(LEADING_MARKER, "").trim())
    .filter((line) => line.length > 0);
}

/** Returns { valid: true, bullets } or { valid: false, errors: string[] }. */
export function validateBulletInput(text) {
  const bullets = parseBulletLines(text);
  const errors = [];
  if (bullets.length === 0) errors.push("Enter at least one resume bullet.");
  if (bullets.length > MAX_BULLETS) errors.push(`Enter at most ${MAX_BULLETS} bullets (you entered ${bullets.length}).`);
  const tooLong = bullets.map((b, i) => ({ i: i + 1, len: b.length })).filter((x) => x.len > MAX_BULLET_LENGTH);
  for (const { i, len } of tooLong) errors.push(`Bullet ${i} is ${len} characters; the limit is ${MAX_BULLET_LENGTH}.`);
  return errors.length ? { valid: false, errors } : { valid: true, bullets };
}

const GROUNDING_STATUSES = ["accepted", "reverted_to_original"];

/**
 * Accepts the backend's `grounding` array only if every entry has the
 * expected shape; otherwise returns null so the UI says "not provided"
 * instead of inventing or half-rendering a verdict.
 */
export function normalizeGrounding(grounding, expectedLength) {
  if (!Array.isArray(grounding) || grounding.length !== expectedLength) return null;
  const out = [];
  for (let i = 0; i < grounding.length; i++) {
    const g = grounding[i];
    if (!g || typeof g !== "object" || !GROUNDING_STATUSES.includes(g.status)) return null;
    const issues = Array.isArray(g.issues) ? g.issues : [];
    out.push({
      status: g.status,
      issues: issues
        .filter((x) => x && typeof x.value === "string" && (x.type === "new_number" || x.type === "new_term"))
        .map((x) => ({ type: x.type, value: x.value, inJobDescription: x.inJobDescription === true })),
      rejectedText: typeof g.rejectedText === "string" ? g.rejectedText : null,
    });
  }
  return out;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const cost = Number(usage.costUsd);
  return {
    model: typeof usage.model === "string" ? usage.model : null,
    promptTokens: Number.isFinite(usage.promptTokens) ? usage.promptTokens : null,
    completionTokens: Number.isFinite(usage.completionTokens) ? usage.completionTokens : null,
    costUsd: Number.isFinite(cost) ? cost : null,
  };
}

export function formatCostUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(6)}` : null;
}

/**
 * Turns an apiFetch result for POST /applications/:id/tailor into
 * { kind: "success" | "unauthorized" | "aborted" | "error", ... }.
 * Only ever surfaces backend messages (already user-safe), never raw bodies.
 */
export function interpretTailorResponse({ ok, status, data, aborted, timedOut }) {
  if (aborted) return { kind: "aborted" };
  if (timedOut) return { kind: "error", messages: ["Tailoring took too long and was stopped. Please try again."] };
  if (status === 401) return { kind: "unauthorized" };
  if (ok && status === 201) {
    const bullets = data?.bullets;
    if (!Array.isArray(bullets) || bullets.length === 0 || !bullets.every((b) => typeof b === "string")) {
      return { kind: "error", messages: ["The server returned an unexpected response. Please try again."] };
    }
    return { kind: "success", bullets, grounding: normalizeGrounding(data.grounding, bullets.length), usage: normalizeUsage(data.usage) };
  }
  if (Array.isArray(data?.messages) && data.messages.every((m) => typeof m === "string") && data.messages.length) {
    return { kind: "error", messages: data.messages };
  }
  if (typeof data?.message === "string" && data.message) return { kind: "error", messages: [data.message] };
  return { kind: "error", messages: ["Something went wrong while tailoring. Please try again."] };
}
