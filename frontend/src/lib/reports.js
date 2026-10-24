// Bounded polling: first checks come quickly, then settle at 5s. 40 attempts
// is roughly three minutes in total; after that we stop and let the user
// re-check manually rather than polling forever.
export const POLL_DELAYS_MS = [1500, 2000, 3000, 4000, 5000];
export const MAX_POLL_ATTEMPTS = 40;
export const MAX_CONSECUTIVE_ERRORS = 3;

const FAILED_FALLBACK = "Report generation failed. You can try again.";

function safeMessage(data, fallback) {
  return typeof data?.message === "string" && data.message ? data.message : fallback;
}

/**
 * Interprets GET /applications/:id/report.
 * kinds: pending | done | failed | none | unauthorized | aborted | error
 * "done" is returned ONLY when the server says status === "done".
 */
export function interpretReportStatusResponse({ ok, status, data, aborted }) {
  if (aborted) return { kind: "aborted" };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 404 && data?.error === "not_found" && /No report has been requested/i.test(data?.message ?? "")) return { kind: "none" };
  if (ok && data?.status === "pending") return { kind: "pending" };
  if (ok && data?.status === "done") return { kind: "done" };
  if (ok && data?.status === "failed") return { kind: "failed", message: typeof data.error === "string" && data.error ? data.error : FAILED_FALLBACK };
  return { kind: "error", transient: status === 0 || status >= 500, message: safeMessage(data, "Could not check the report status.") };
}

/**
 * Interprets POST /applications/:id/report: 202 pending, 200 done
 * (already generated), 400 no_tailored_resume, 404, 5xx.
 */
export function interpretReportRequestResponse({ ok, status, data, aborted }) {
  if (aborted) return { kind: "aborted" };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 202 && data?.status === "pending") return { kind: "pending" };
  if (status === 200 && data?.status === "done") return { kind: "done" };
  if (status === 400 && data?.error === "no_tailored_resume") return { kind: "needs_tailoring", message: safeMessage(data, "Tailor a resume first, then request a report.") };
  return { kind: "error", message: safeMessage(data, "Could not request the report.") };
}

/**
 * What "Try again" should do after a FAILED report. The backend job can mark a
 * report FAILED on an attempt that Inngest then retries to success, so before
 * enqueueing a second job we look at the current server state:
 *   pending -> keep waiting (a retry is probably running)   done -> show it
 *   failed/none -> really request a new one                  error -> don't guess
 */
export function nextActionBeforeRetry(statusResult) {
  switch (statusResult.kind) {
    case "pending":
      return { type: "poll" };
    case "done":
    case "unauthorized":
    case "aborted":
      return { type: "apply" };
    case "failed":
    case "none":
      return { type: "request" };
    default:
      return { type: "apply" }; // error: surface it; applyResult shows "could not confirm"
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sequential poll loop — each check starts only after the previous one
 * settled, so requests never overlap. Stops on: done, failed, unauthorized,
 * a non-transient error, too many consecutive transient errors, the attempt
 * cap ("timeout"), or cancellation. `fetchStatus` must return the result of
 * interpretReportStatusResponse.
 */
export async function pollReportStatus({
  fetchStatus,
  isCancelled = () => false,
  sleep = defaultSleep,
  delaysMs = POLL_DELAYS_MS,
  maxAttempts = MAX_POLL_ATTEMPTS,
  maxConsecutiveErrors = MAX_CONSECUTIVE_ERRORS,
}) {
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isCancelled()) return { kind: "cancelled" };
    await sleep(delaysMs[Math.min(attempt, delaysMs.length - 1)]);
    if (isCancelled()) return { kind: "cancelled" };

    let result;
    try {
      result = await fetchStatus();
    } catch {
      // A throwing status check must not kill the loop or leave the caller's
      // guard set; count it like any other transient failure.
      result = { kind: "error", transient: true, message: "Could not check the report status." };
    }
    if (isCancelled() || result.kind === "aborted") return { kind: "cancelled" };

    if (result.kind === "pending") {
      consecutiveErrors = 0;
      continue;
    }
    if (result.kind === "error" && result.transient) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) return { kind: "error", message: result.message };
      continue;
    }
    if (result.kind === "none") return { kind: "error", message: "The report request could not be found. Please request it again." };
    return result; // done | failed | unauthorized | non-transient error
  }
  return { kind: "timeout" };
}

export function reportFilename(application) {
  const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const parts = [slug(application?.company), slug(application?.role)].filter(Boolean);
  return `${parts.length ? parts.join("-") : "application"}-report.pdf`;
}
