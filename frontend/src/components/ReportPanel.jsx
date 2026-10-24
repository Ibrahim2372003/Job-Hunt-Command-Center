import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiFetchBlob, saveBlob } from "../api.js";
import { interpretReportStatusResponse, interpretReportRequestResponse, nextActionBeforeRetry, pollReportStatus, reportFilename } from "../lib/reports.js";
import { createSingleFlight } from "../lib/singleFlight.js";

// phase: checking | none | requesting | pending | done | failed | timeout
export default function ReportPanel({ application, token, onUnauthorized }) {
  const [phase, setPhase] = useState("checking");
  const [message, setMessage] = useState(null); // user-safe text for failed / error states
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const controllerRef = useRef(null);
  const cancelledRef = useRef(false);
  // Each guard is released in a `finally`, so an unexpected exception can never
  // leave a button permanently dead.
  const [pollFlight] = useState(createSingleFlight);
  const [requestFlight] = useState(createSingleFlight);
  const [downloadFlight] = useState(createSingleFlight);

  const basePath = `/applications/${application.id}/report`;

  const fetchStatus = useCallback(
    async () => interpretReportStatusResponse(await apiFetch(basePath, { token, signal: controllerRef.current?.signal })),
    [basePath, token]
  );

  const applyResult = useCallback(
    (result) => {
      if (cancelledRef.current) return;
      switch (result.kind) {
        case "unauthorized":
          onUnauthorized();
          break;
        case "done":
          setMessage(null);
          setPhase("done");
          break;
        case "failed":
          setMessage(result.message);
          setPhase("failed");
          break;
        case "timeout":
          setMessage(null);
          setPhase("timeout");
          break;
        case "none":
          setPhase("none");
          break;
        case "pending":
          setPhase("pending");
          break;
        case "error":
          setMessage(result.message);
          setPhase("timeout"); // status unknown: offer a manual re-check, never claim done/failed
          break;
        default:
          break; // cancelled / aborted: the component is going away, show nothing
      }
    },
    [onUnauthorized]
  );

  // Polling is bounded (see lib/reports.js) and deliberately keeps running
  // while the AI tools are collapsed: the job runs server-side regardless, and
  // the user finds the result when they reopen. It stops on unmount.
  const startPolling = useCallback(async () => {
    await pollFlight.run(async () => {
      setPhase("pending");
      setMessage(null);
      let result;
      try {
        result = await pollReportStatus({ fetchStatus, isCancelled: () => cancelledRef.current });
      } catch {
        result = { kind: "error", message: "Could not check the report status." };
      }
      applyResult(result);
    });
  }, [pollFlight, fetchStatus, applyResult]);

  // One status check on first mount, so an existing or in-progress report is
  // shown (and polling resumed) after a page reload. `active` is per effect
  // run, so React StrictMode's mount/unmount/mount cannot let the first run's
  // aborted request act on the second run's state.
  useEffect(() => {
    let active = true;
    cancelledRef.current = false;
    controllerRef.current = new AbortController();
    (async () => {
      let result;
      try {
        result = await fetchStatus();
      } catch {
        result = { kind: "error", message: "Could not check the report status." };
      }
      if (!active) return;
      if (result.kind === "pending") startPolling();
      else applyResult(result);
    })();
    return () => {
      active = false;
      cancelledRef.current = true; // stops the poll loop and pending state updates
      controllerRef.current?.abort();
    };
    // Intentionally mount-only: fetchStatus/startPolling are stable for a given application+token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRequest() {
    if (requestFlight.running || pollFlight.running) return;
    const phaseBefore = phase;
    await requestFlight.run(async () => {
      setPhase("requesting");
      setMessage(null);
      setDownloadError(null);
      try {
        if (phaseBefore === "failed") {
          // A FAILED report may be mid-retry on the server; look before enqueueing another job.
          const current = await fetchStatus();
          if (cancelledRef.current) return;
          const action = nextActionBeforeRetry(current);
          if (action.type === "poll") {
            startPolling(); // owns its own error handling; not awaited so this guard is released
            return;
          }
          if (action.type === "apply") return applyResult(current);
        }

        const response = await apiFetch(basePath, { method: "POST", token, signal: controllerRef.current?.signal });
        if (cancelledRef.current || response.aborted) return;
        const result = interpretReportRequestResponse(response);

        if (result.kind === "pending") {
          startPolling();
          return;
        }
        if (result.kind === "done") return applyResult(result);
        if (result.kind === "unauthorized") return onUnauthorized();
        // needs_tailoring / error: nothing was enqueued; return to a state where the user can act
        setMessage(result.message);
        setPhase(phaseBefore === "failed" ? "failed" : "none");
      } catch {
        if (cancelledRef.current) return;
        setMessage("Could not request the report. Please try again.");
        setPhase(phaseBefore === "failed" ? "failed" : "none");
      }
    });
  }

  async function handleDownload() {
    await downloadFlight.run(async () => {
      setDownloading(true);
      setDownloadError(null);
      try {
        const res = await apiFetchBlob(`${basePath}/file`, { token, signal: controllerRef.current?.signal });
        if (cancelledRef.current || res.aborted) return;
        if (res.status === 401) return onUnauthorized();
        if (!res.ok) {
          setDownloadError(res.data?.message || "Could not download the report.");
          return;
        }
        saveBlob(res.blob, reportFilename(application));
      } catch {
        if (!cancelledRef.current) setDownloadError("Could not save the report. Please try again.");
      } finally {
        if (!cancelledRef.current) setDownloading(false);
      }
    });
  }

  const busy = phase === "checking" || phase === "requesting" || phase === "pending";

  return (
    <section className="ai-panel" aria-labelledby={`report-title-${application.id}`}>
      <h4 id={`report-title-${application.id}`}>PDF report</h4>
      <p className="field-hint">The PDF is built from your most recent successful tailoring, so tailor your bullets first.</p>

      <div className="report-status" role="status" aria-live="polite">
        {phase === "checking" && <span>Checking report status...</span>}
        {phase === "none" && <span>No report has been generated yet.</span>}
        {phase === "requesting" && <span>Requesting report...</span>}
        {phase === "pending" && <span>Generating your report. This usually takes a few seconds; this page checks automatically.</span>}
        {phase === "done" && <span>Your report is ready.</span>}
        {phase === "failed" && <span>The report could not be generated.</span>}
        {phase === "timeout" && <span>We could not confirm the report status. It may still be processing.</span>}
      </div>

      {message && (phase === "failed" || phase === "none" || phase === "timeout") && (
        <p className="error-list report-message" role="alert">
          {message}
        </p>
      )}

      <div className="form-actions">
        {(phase === "none" || phase === "failed") && (
          <button type="button" className="btn btn-primary btn-sm" onClick={handleRequest}>
            {phase === "failed" ? "Try again" : "Generate PDF report"}
          </button>
        )}
        {phase === "timeout" && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={startPolling}>
            Check again
          </button>
        )}
        {phase === "done" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? "Downloading..." : "Download PDF"}
          </button>
        )}
        {busy && phase !== "checking" && (
          <button type="button" className="btn btn-secondary btn-sm" disabled>
            Please wait...
          </button>
        )}
      </div>

      {phase === "done" && (
        <p className="field-hint">A finished report is not regenerated. If you tailor again, this PDF still contains the earlier version.</p>
      )}
      {downloadError && (
        <p className="error-list report-message" role="alert">
          {downloadError}
        </p>
      )}
    </section>
  );
}
