import { tokenSet } from "./grounding.js";

/**
 * Transparent, deterministic requirement-vs-evidence matching.
 *
 * For each requirement we extract its meaningful words, then look at each
 * piece of the user's own evidence (CV bullets / skills / projects) and see
 * how many of those words it contains.
 *
 *   supported : some single evidence item contains >= 2/3 of the key words
 *   partial   : some evidence contains at least one key word, but not enough
 *   missing   : evidence exists but none of it mentions any key word
 *   unclear   : we cannot judge — the user supplied no evidence at all, or
 *               the requirement has no distinctive words to match on
 *
 * Deliberately NOT produced: a single numeric "fit score". Lexical overlap
 * is a weak proxy for ability, and summing it into one number would imply a
 * precision this method does not have. We return counts per status and the
 * evidence behind every row instead.
 *
 * "missing" means "nothing in the CV text you provided mentions this" — it
 * is NOT a claim that the user lacks the skill. If no evidence was provided
 * at all, every row is "unclear", never "missing": absence of data is not
 * absence of skill.
 *
 * LIMITATIONS: purely lexical — synonyms ("Postgres" vs "PostgreSQL"),
 * paraphrases, and implied skills are not matched, so "missing" can be a
 * false negative and "supported" does not prove depth. A semantic (LLM- or
 * embedding-assisted) matcher is a natural next step but would need its own
 * validation.
 */

const GENERIC_WORDS = new Set(
  (
    "a an and or the of to in on for with by at as is are be been being from into over under about " +
    "this that these those our your their you we they it its who will can may must should have has had do does " +
    "experience experienced years year strong solid proven demonstrated ability able knowledge understanding " +
    "skills skill working work including plus such etc using use used familiarity familiar good excellent " +
    "team teams environment environments role candidate candidates preferred required requirement requirements " +
    "player degree related relevant similar proficiency proficient hands-on handson minimum least more than"
  ).split(/\s+/)
);

export function keyTerms(requirementText) {
  const words = String(requirementText).match(/[A-Za-z0-9][A-Za-z0-9+#._-]*/g) || [];
  const out = [];
  for (const w of words) {
    const clean = w.replace(/[._-]+$/g, "");
    const lower = clean.toLowerCase();
    // Quantities ("5+", "10%") are not skills and a CV may spell them differently ("five years").
    if (lower.length < 2 || GENERIC_WORDS.has(lower) || /^\d+[+%]?$/.test(lower)) continue;
    if (!out.includes(lower)) out.push(lower);
  }
  return out;
}

function hits(terms, evidenceTokens) {
  return terms.filter((t) => evidenceTokens.has(t) || (t.length > 3 && t.endsWith("s") && evidenceTokens.has(t.slice(0, -1))));
}

/**
 * @param requirements  [{ text, importance?, ... }] — e.g. analysis.requirements
 * @param evidenceItems [{ id, text }] — the user's own CV bullets/skills/projects
 */
export function assessFit(requirements, evidenceItems) {
  const prepared = evidenceItems
    .filter((e) => e && typeof e.text === "string" && e.text.trim())
    .map((e) => ({ id: e.id, text: e.text, tokens: tokenSet(e.text) }));

  const rows = requirements.map((req) => {
    const terms = keyTerms(req.text);
    const base = { requirement: req.text, importance: req.importance ?? "unspecified", keyTerms: terms };

    if (prepared.length === 0) {
      return { ...base, status: "unclear", matchedEvidence: [], explanation: "No CV or profile evidence was provided, so this cannot be assessed." };
    }
    if (terms.length === 0) {
      return { ...base, status: "unclear", matchedEvidence: [], explanation: "This requirement has no distinctive terms to match against; review it manually." };
    }

    let best = { ratio: 0, matched: [], item: null };
    const matchedEvidence = [];
    for (const item of prepared) {
      const matched = hits(terms, item.tokens);
      if (matched.length > 0) matchedEvidence.push({ id: item.id, text: item.text, matchedTerms: matched });
      const ratio = matched.length / terms.length;
      if (ratio > best.ratio) best = { ratio, matched, item };
    }
    matchedEvidence.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);

    if (best.ratio >= 2 / 3) {
      return { ...base, status: "supported", matchedEvidence: matchedEvidence.slice(0, 3), explanation: `Matched ${best.matched.length} of ${terms.length} key terms in one piece of your evidence.` };
    }
    if (best.ratio > 0) {
      const missingTerms = terms.filter((t) => !best.matched.includes(t));
      return { ...base, status: "partial", matchedEvidence: matchedEvidence.slice(0, 3), explanation: `Evidence mentions ${best.matched.join(", ")} but nothing provided mentions ${missingTerms.join(", ")}.` };
    }
    return { ...base, status: "missing", matchedEvidence: [], explanation: "Nothing in the CV text you provided mentions these terms. This may reflect missing detail in the CV rather than a missing skill." };
  });

  const summary = { supported: 0, partial: 0, missing: 0, unclear: 0, total: rows.length };
  for (const r of rows) summary[r.status] += 1;

  return {
    rows,
    summary,
    method: "lexical-overlap-v1",
    limitations: [
      "Matching is keyword-based; synonyms and paraphrases are not recognized, so 'missing' can be a false negative.",
      "'Supported' means the terms appear together in your evidence, not that the depth of experience satisfies the role.",
      "No overall score is computed on purpose; counts and per-requirement evidence are shown instead.",
    ],
  };
}
