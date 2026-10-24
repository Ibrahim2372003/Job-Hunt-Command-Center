import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api.js";
import { validateBulletInput, interpretTailorResponse, formatCostUsd, TAILOR_TIMEOUT_MS, MAX_BULLETS, MAX_BULLET_LENGTH } from "../lib/tailoring.js";
import { createSingleFlight } from "../lib/singleFlight.js";

const ISSUE_LABEL = { new_number: "a number", new_term: "a tool or term" };

function GroundingNote({ grounding }) {
  if (!grounding) {
    return <p className="tailor-note">No fact-check details were returned for this bullet, so review it yourself.</p>;
  }
  if (grounding.status === "accepted") {
    return <p className="tailor-note tailor-note-ok">Fact check passed: no new numbers or tool names were added. This does not check other claims.</p>;
  }
  return (
    <div className="tailor-note tailor-note-warn">
      <p>
        <strong>Reverted to your original wording.</strong> The rewrite added details that are not in your bullet:
      </p>
      <ul>
        {grounding.issues.map((issue) => (
          <li key={`${issue.type}-${issue.value}`}>
            {ISSUE_LABEL[issue.type]}: <code>{issue.value}</code>
            {issue.inJobDescription ? " (appears in the job description, not in your bullet)" : ""}
          </li>
        ))}
      </ul>
      {grounding.rejectedText && (
        <p className="tailor-rejected">
          Rejected rewrite: <span>{grounding.rejectedText}</span>
        </p>
      )}
    </div>
  );
}

function Usage({ usage }) {
  if (!usage) return null;
  const cost = formatCostUsd(usage.costUsd);
  const rows = [
    ["Model", usage.model],
    ["Input tokens", usage.promptTokens],
    ["Output tokens", usage.completionTokens],
    ["Estimated cost", cost],
  ].filter(([, v]) => v !== null && v !== undefined);
  if (rows.length === 0) return null;
  return (
    <dl className="usage-list" aria-label="Usage for this request">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function TailorPanel({ application, token, onUnauthorized }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [result, setResult] = useState(null); // { bullets, grounding, usage, originals }
  const [flight] = useState(createSingleFlight); // blocks a second submit in the same tick, and always unlocks
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);

  // If the card goes away mid-request (application deleted, logout), cancel
  // the request and never touch state afterwards.
  useEffect(() => {
    mountedRef.current = true;
    controllerRef.current = new AbortController();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const inputId = `tailor-input-${application.id}`;
  const hintId = `tailor-hint-${application.id}`;
  const errorId = `tailor-errors-${application.id}`;

  async function handleSubmit(event) {
    event.preventDefault();
    if (flight.running) return;

    const check = validateBulletInput(text);
    if (!check.valid) {
      setErrors(check.errors);
      return;
    }

    await flight.run(async () => {
      setSubmitting(true);
      setErrors([]);
      try {
        const response = await apiFetch(`/applications/${application.id}/tailor`, {
          method: "POST",
          body: { baseBullets: check.bullets },
          token,
          signal: controllerRef.current?.signal,
          timeoutMs: TAILOR_TIMEOUT_MS,
        });
        if (!mountedRef.current) return;

        const outcome = interpretTailorResponse(response);
        if (outcome.kind === "unauthorized") return onUnauthorized();
        if (outcome.kind === "error") {
          setErrors(outcome.messages); // keep the user's input and any earlier result untouched
          return;
        }
        if (outcome.kind === "success") {
          setResult({ bullets: outcome.bullets, grounding: outcome.grounding, usage: outcome.usage, originals: check.bullets });
        }
        // outcome.kind === "aborted": the panel was torn down; nothing to show
      } catch {
        if (mountedRef.current) setErrors(["Something went wrong while tailoring. Please try again."]);
      } finally {
        if (mountedRef.current) setSubmitting(false);
      }
    });
  }

  return (
    <section className="ai-panel" aria-labelledby={`tailor-title-${application.id}`}>
      <h4 id={`tailor-title-${application.id}`}>Tailor resume bullets</h4>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={inputId}>Your current resume bullets</label>
          <textarea
            id={inputId}
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${hintId}${errors.length ? ` ${errorId}` : ""}`}
            aria-invalid={errors.length > 0}
            disabled={submitting}
            placeholder={"Built REST APIs in Node.js for a payments platform.\nMentored two junior developers."}
          />
          <span id={hintId} className="field-hint">
            One bullet per line, up to {MAX_BULLETS} bullets of {MAX_BULLET_LENGTH} characters. Only use facts that are true: the AI should not add details, and anything it adds is checked and reverted.
          </span>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
            {submitting ? "Tailoring..." : "Tailor to this job"}
          </button>
        </div>
        {submitting && (
          <p className="state-message-inline" role="status">
            Tailoring your bullets. This can take a few seconds.
          </p>
        )}
        {errors.length > 0 && (
          <ul id={errorId} className="error-list" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>

      {result && (
        <div className="tailor-result" aria-live="polite">
          <h5>Tailored bullets</h5>
          <p className="field-hint">Review every bullet before using it. The fact check only looks for added numbers and tool names.</p>
          <ol className="tailor-list">
            {result.bullets.map((bullet, i) => (
              <li key={i}>
                <p className="tailor-bullet">{bullet}</p>
                {result.grounding?.[i]?.status === "reverted_to_original" ? null : result.originals[i] !== bullet && (
                  <p className="tailor-original">
                    Your original: <span>{result.originals[i]}</span>
                  </p>
                )}
                <GroundingNote grounding={result.grounding ? result.grounding[i] : null} />
              </li>
            ))}
          </ol>
          <Usage usage={result.usage} />
        </div>
      )}
    </section>
  );
}
