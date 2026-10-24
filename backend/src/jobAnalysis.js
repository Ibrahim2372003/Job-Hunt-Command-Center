import { computeCostUsd, REQUEST_OPTIONS, DEFAULT_MODEL } from "./llm.js";
import { fenceUntrusted, UNTRUSTED_DATA_NOTICE } from "./promptSafety.js";

/**
 * Structured job-description analysis.
 *
 * Contract (every field the model returns is re-validated here):
 *
 *   title / seniority / workArrangement / location:
 *       null | { value, source: "stated"|"inferred", evidence, evidenceVerified }
 *   requirements[]: { text, category, importance, source, evidence, evidenceVerified }
 *   responsibilities[]: { text, evidence, evidenceVerified }
 *   keywords[]: strings that literally occur in the job description
 *   warnings[]: human-readable notes about anything corrected after the model responded
 *
 * "stated" is a CLAIM by the model that the job description says this
 * explicitly. We do not take its word for it: a stated item must carry an
 * `evidence` quote that is found verbatim (whitespace/case-insensitive) in
 * the job description. If not, it is relabeled "inferred" and flagged.
 * That is the deterministic line between "the posting says" and "the
 * model thinks".
 */

export const CATEGORIES = ["skill", "experience", "education", "certification", "other"];
export const IMPORTANCE = ["required", "preferred", "unspecified"];
export const SOURCES = ["stated", "inferred"];

const MAX_REQUIREMENTS = 40;
const MAX_RESPONSIBILITIES = 25;
const MAX_KEYWORDS = 30;
const MAX_TEXT = 300;

const nullableString = { type: ["string", "null"] };
const sourcedValueSchema = {
  type: "object",
  properties: {
    value: nullableString,
    source: { type: "string", enum: SOURCES },
    evidence: nullableString,
  },
  required: ["value", "source", "evidence"],
  additionalProperties: false,
};

export const JOB_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    title: sourcedValueSchema,
    seniority: sourcedValueSchema,
    workArrangement: sourcedValueSchema,
    location: sourcedValueSchema,
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          importance: { type: "string", enum: IMPORTANCE },
          source: { type: "string", enum: SOURCES },
          evidence: nullableString,
        },
        required: ["text", "category", "importance", "source", "evidence"],
        additionalProperties: false,
      },
    },
    responsibilities: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, evidence: nullableString },
        required: ["text", "evidence"],
        additionalProperties: false,
      },
    },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["title", "seniority", "workArrangement", "location", "requirements", "responsibilities", "keywords"],
  additionalProperties: false,
};

export class JobAnalysisOutputError extends Error {
  constructor(message, { rawText, model, promptTokens, completionTokens, costUsd }) {
    super(message);
    this.name = "JobAnalysisOutputError";
    this.rawText = rawText;
    this.model = model;
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
    this.costUsd = costUsd;
  }
}

function normalizeForMatch(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[*_`>#\u2022\u2023\u25E6\u2043\u2219•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `evidence` occurs verbatim (modulo case, whitespace, bullet glyphs) in `jobDescription`. */
export function evidenceInText(evidence, jobDescription) {
  if (typeof evidence !== "string") return false;
  const e = normalizeForMatch(evidence);
  if (e.length < 3) return false;
  return normalizeForMatch(jobDescription).includes(e);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordInText(keyword, jobDescription) {
  const k = normalizeForMatch(keyword);
  if (k.length < 2) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}($|[^a-z0-9])`, "i");
  return re.test(normalizeForMatch(jobDescription));
}

function asEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function clip(text) {
  return String(text).trim().slice(0, MAX_TEXT);
}

function applySourceCheck(source, evidence, jobDescription, counters) {
  const claimedStated = source === "stated";
  const verified = evidenceInText(evidence, jobDescription);
  if (claimedStated && !verified) {
    counters.downgraded += 1;
    return { source: "inferred", evidence: null, evidenceVerified: false };
  }
  return {
    source: claimedStated ? "stated" : "inferred",
    evidence: verified ? clip(evidence) : null,
    evidenceVerified: verified,
  };
}

function normalizeSourcedValue(raw, jobDescription, counters) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("A sourced field was not an object.");
  const value = typeof raw.value === "string" ? clip(raw.value) : "";
  if (!value) return null;
  return { value, ...applySourceCheck(raw.source, raw.evidence, jobDescription, counters) };
}

/**
 * Pure: parse + validate + deterministically correct the model's raw JSON.
 * Throws a plain Error for structurally unusable output; the caller wraps it
 * with usage data. Never throws for "the model over-claimed 'stated'" — that
 * is corrected and reported in `warnings` instead.
 */
export function parseJobAnalysis(rawText, jobDescription) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Model output was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model output was not a JSON object.");
  }
  if (!Array.isArray(parsed.requirements)) throw new Error("Model output is missing a requirements array.");
  if (!Array.isArray(parsed.responsibilities)) throw new Error("Model output is missing a responsibilities array.");
  if (!Array.isArray(parsed.keywords)) throw new Error("Model output is missing a keywords array.");

  const counters = { downgraded: 0, dropped: 0 };

  const requirements = [];
  for (const r of parsed.requirements.slice(0, MAX_REQUIREMENTS)) {
    if (!r || typeof r !== "object" || typeof r.text !== "string" || !r.text.trim()) {
      counters.dropped += 1;
      continue;
    }
    requirements.push({
      text: clip(r.text),
      category: asEnum(r.category, CATEGORIES, "other"),
      importance: asEnum(r.importance, IMPORTANCE, "unspecified"),
      ...applySourceCheck(r.source, r.evidence, jobDescription, counters),
    });
  }
  if (parsed.requirements.length > MAX_REQUIREMENTS) counters.dropped += parsed.requirements.length - MAX_REQUIREMENTS;

  const responsibilities = [];
  for (const r of parsed.responsibilities.slice(0, MAX_RESPONSIBILITIES)) {
    if (!r || typeof r.text !== "string" || !r.text.trim()) {
      counters.dropped += 1;
      continue;
    }
    const verified = evidenceInText(r.evidence, jobDescription);
    responsibilities.push({ text: clip(r.text), evidence: verified ? clip(r.evidence) : null, evidenceVerified: verified });
  }

  const keywords = [];
  for (const k of parsed.keywords) {
    if (typeof k !== "string") continue;
    const kw = k.trim();
    if (!kw || keywords.some((x) => x.toLowerCase() === kw.toLowerCase())) continue;
    if (keywordInText(kw, jobDescription)) keywords.push(kw.slice(0, 60));
    else counters.dropped += 1;
    if (keywords.length >= MAX_KEYWORDS) break;
  }

  const warnings = [];
  if (counters.downgraded > 0) {
    warnings.push(`${counters.downgraded} item(s) were labeled "stated" by the model but no matching quote was found in the job description; they were relabeled "inferred".`);
  }
  if (counters.dropped > 0) {
    warnings.push(`${counters.dropped} malformed, excess, or unsupported item(s) were removed from the model output.`);
  }

  return {
    title: normalizeSourcedValue(parsed.title, jobDescription, counters),
    seniority: normalizeSourcedValue(parsed.seniority, jobDescription, counters),
    workArrangement: normalizeSourcedValue(parsed.workArrangement, jobDescription, counters),
    location: normalizeSourcedValue(parsed.location, jobDescription, counters),
    requirements,
    responsibilities,
    keywords,
    warnings,
  };
}

function buildPrompt(jobDescription) {
  const instructions =
    "You extract structured information from a job posting. " +
    UNTRUSTED_DATA_NOTICE +
    " Rules: (1) Mark an item source=\"stated\" ONLY if the posting says it explicitly, and then copy a short exact quote from the posting into `evidence`. " +
    "(2) If you are interpreting, summarizing across sentences, or guessing, use source=\"inferred\" and evidence=null. " +
    "(3) Do not infer seniority, location, or work arrangement unless stated; use value=null when not stated. " +
    "(4) importance=\"required\" or \"preferred\" only when the wording supports it (e.g. 'must have', 'nice to have'); otherwise \"unspecified\". " +
    "(5) `keywords` must be terms that literally appear in the posting. Return JSON matching the schema and nothing else.";
  const input = `Job posting to analyze:\n${fenceUntrusted("job_description", jobDescription)}`;
  return { instructions, input };
}

/**
 * Calls the model, then validates/corrects. `openaiClient` is injected exactly
 * like tailorBullets — tests pass a stub, so no network or key is needed.
 */
export async function analyzeJobDescription(openaiClient, { jobDescription, model = DEFAULT_MODEL }) {
  const { instructions, input } = buildPrompt(jobDescription);

  const response = await openaiClient.responses.create(
    {
      model,
      instructions,
      input,
      text: { format: { type: "json_schema", name: "job_analysis", strict: true, schema: JOB_ANALYSIS_SCHEMA } },
    },
    REQUEST_OPTIONS
  );

  const promptTokens = response.usage?.input_tokens ?? 0;
  const completionTokens = response.usage?.output_tokens ?? 0;
  const costUsd = computeCostUsd(model, promptTokens, completionTokens);
  const rawText = response.output_text ?? "";

  try {
    const analysis = parseJobAnalysis(rawText, jobDescription);
    return { analysis, model, promptTokens, completionTokens, costUsd };
  } catch (err) {
    throw new JobAnalysisOutputError(err.message, { rawText, model, promptTokens, completionTokens, costUsd });
  }
}
