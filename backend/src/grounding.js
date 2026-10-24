/**
 * Deterministic factual-consistency check for tailored CV bullets.
 *
 * Prompt instructions ("never invent experience") are not a correctness
 * guarantee, so after the model responds we compare each tailored bullet
 * against the user's ORIGINAL bullet at the same index and reject
 * anything that introduces:
 *
 *   - a number / percentage / currency amount not in the original
 *     ("new_number") — the classic fabricated-metric failure; or
 *   - a tool / technology / proper-noun-like term not in the original
 *     ("new_term"). If that term appears in the job description, the issue
 *     is flagged `inJobDescription: true` — the signature of keyword
 *     stuffing, where the model copies a requirement into the CV as if the
 *     user had done it.
 *
 * A flagged bullet is REVERTED to the user's original text (never silently
 * kept), and the report says why, so the UI can show it.
 *
 * LIMITATIONS (also documented in the README): this is lexical. It cannot
 * detect semantic inflation ("contributed to" -> "led"), invented
 * responsibilities phrased in plain lowercase words, or number words
 * ("tripled"). It catches the highest-risk, most mechanical fabrications;
 * it does not make the output provably true. The user must still review
 * every bullet.
 */

const NUMBER_RE = /(?<![A-Za-z0-9.])\$?\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|[kKmMbB]\b)?/g;
const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9+#._-]*/g;

export function normalizeNumber(raw) {
  return raw
    .toLowerCase()
    .replace(/[$,\s]/g, "")
    .replace(/percent$/, "%");
}

export function extractNumbers(text) {
  return new Set((String(text).match(NUMBER_RE) || []).map(normalizeNumber));
}

function cleanToken(t) {
  return t.replace(/[._-]+$/g, "");
}

function variants(token) {
  const key = token.toLowerCase();
  const set = new Set([key]);
  if (key.length > 3 && key.endsWith("s")) set.add(key.slice(0, -1));
  if (key.length > 3 && key.endsWith("es")) set.add(key.slice(0, -2));
  return set;
}

/** All word-ish tokens of a text, expanded with simple plural variants, as a lookup set. */
export function tokenSet(text) {
  const out = new Set();
  for (const m of String(text).matchAll(TOKEN_RE)) {
    for (const v of variants(cleanToken(m[0]))) out.add(v);
  }
  return out;
}

function isSentenceStart(text, index) {
  const before = text.slice(0, index).trimEnd();
  if (before === "") return true;
  return /[.!?:;•\u2022\-–—\n]$/.test(before) || /\n\s*$/.test(text.slice(0, index));
}

/**
 * Tokens that look like a named tool/technology/employer rather than an
 * ordinary word: internal capitals (JavaScript, PostgreSQL, AWS), + or #
 * (C++, C#), letter+digit mixes (S3, Python3), internal dots (Node.js),
 * or a Capitalized word that is not at the start of a sentence.
 */
export function extractTerms(text) {
  const src = String(text);
  const terms = [];
  for (const m of src.matchAll(TOKEN_RE)) {
    const token = cleanToken(m[0]);
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue; // pure numbers handled separately
    const internalCaps = /[A-Z]/.test(token.slice(1));
    const symbolic = /[+#]/.test(token);
    const mixedDigits = /[A-Za-z]/.test(token) && /\d/.test(token);
    const internalDot = /[A-Za-z]\.[A-Za-z]/.test(token);
    const capitalizedMidSentence = /^[A-Z][a-z]/.test(token) && !isSentenceStart(src, m.index);
    if (internalCaps || symbolic || mixedDigits || internalDot || capitalizedMidSentence) {
      terms.push(token);
    }
  }
  return terms;
}

/**
 * Compare one tailored bullet to its original.
 * Returns the list of issues (empty = grounded as far as this check can tell).
 */
export function findGroundingIssues({ original, tailored, jobDescription = "" }) {
  const issues = [];

  const originalNumbers = extractNumbers(original);
  for (const n of extractNumbers(tailored)) {
    if (!originalNumbers.has(n)) issues.push({ type: "new_number", value: n, inJobDescription: extractNumbers(jobDescription).has(n) });
  }

  const originalTokens = tokenSet(original);
  const jdTokens = tokenSet(jobDescription);
  const seen = new Set();
  for (const term of extractTerms(tailored)) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const known = [...variants(term)].some((v) => originalTokens.has(v));
    if (!known) {
      issues.push({ type: "new_term", value: term, inJobDescription: [...variants(term)].some((v) => jdTokens.has(v)) });
    }
  }
  return issues;
}

/**
 * Apply the check to a whole tailoring result. `baseBullets` and
 * `tailoredBullets` must be the same length (llm.js enforces that first).
 * Returns the corrected bullets plus a per-bullet report.
 */
export function enforceGrounding({ baseBullets, tailoredBullets, jobDescription = "" }) {
  if (baseBullets.length !== tailoredBullets.length) {
    throw new Error("enforceGrounding requires index-aligned bullet arrays.");
  }
  const reports = [];
  const bullets = tailoredBullets.map((tailored, index) => {
    const original = baseBullets[index];
    const issues = findGroundingIssues({ original, tailored, jobDescription });
    if (issues.length === 0) {
      reports.push({ index, status: "accepted", issues: [] });
      return tailored;
    }
    reports.push({ index, status: "reverted_to_original", issues, rejectedText: tailored });
    return original;
  });
  return { bullets, reports };
}
