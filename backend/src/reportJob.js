import path from "node:path";
import { buildApplicationReportHtml, renderReportPdf } from "./report.js";
import { REPORTS_DIR } from "./paths.js";

const SAFE_FAILURE_MESSAGE = "Report generation failed. Please try requesting the report again.";

/**
 * Default renderer: the HTML is still built first (it is the tested
 * canonical content), but the production renderer draws the PDF from
 * the structured data with pdfkit — see report.js for why Playwright
 * had to go. Tests keep injecting their own (html, outputPath) stubs;
 * the third argument is simply ignored by them.
 */
const defaultRenderFn = (html, outputPath, data) => renderReportPdf(data, outputPath);

/**
 * Shared "load the real rows and draw the file" core. Only ever
 * renders a tailoring attempt that actually produced valid bullets —
 * a failed tailoring call stores { error, raw } in the same Json
 * column (see llm.js's TailorOutputError handling), and that must
 * never end up rendered into a "report" as if it were real content.
 */
async function renderReservedReport({ prisma, report, renderFn }) {
  const application = await prisma.application.findUnique({ where: { id: report.applicationId } });
  if (!application) {
    throw new Error(`Report ${report.id} references application ${report.applicationId}, which no longer exists.`);
  }

  const tailoredResumes = await prisma.tailoredResume.findMany({
    where: { applicationId: application.id },
    orderBy: { createdAt: "desc" },
  });
  const latestValidTailoring = tailoredResumes.find((t) => Array.isArray(t.bullets));
  if (!latestValidTailoring) {
    throw new Error(`Application ${application.id} has no valid tailored resume to build a report from.`);
  }

  const html = buildApplicationReportHtml({ application, bullets: latestValidTailoring.bullets });
  const filePath = path.join(REPORTS_DIR, `${report.id}.pdf`);
  await renderFn(html, filePath, { application, bullets: latestValidTailoring.bullets });
  return filePath;
}

/**
 * The slow work, as a plain async function with no job-queue client
 * in it — the renderer is swappable via `renderFn`, so the
 * PENDING -> DONE transition is genuinely testable without a real
 * PDF, and this exact function is also what the background runner
 * below calls in production.
 *
 * Idempotency: a duplicate dispatch (a retried request, or the
 * stale-pending recovery in the route) can run this for a report
 * that already finished. If it's DONE, skip the work entirely
 * instead of regenerating and re-saving a file that already exists.
 */
export async function runReportGeneration({ prisma, reportId, renderFn = defaultRenderFn }) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    throw new Error(`No report row for id ${reportId} — it must be reserved by POST /applications/:id/report before the job runs.`);
  }
  if (report.status === "DONE") {
    return { filePath: report.filePath };
  }

  const filePath = await renderReservedReport({ prisma, report, renderFn });
  await prisma.report.update({ where: { id: report.id }, data: { status: "DONE", filePath, error: null } });
  return { filePath };
}

/**
 * Re-draws the PDF for a report that is already DONE but whose file
 * is gone. Render's free-tier disk is ephemeral: after the instance
 * sleeps, every file under REPORTS_DIR is wiped while the Postgres
 * row survives. Regenerating on demand (pdfkit renders in well under
 * a second) is cheaper and simpler than external storage.
 */
export async function regenerateReportFile({ prisma, report, renderFn = defaultRenderFn }) {
  return renderReservedReport({ prisma, report, renderFn });
}

/**
 * In-process background runner with the same contract the Inngest
 * setup had: a few retries with backoff, and only once every attempt
 * has failed does the report get marked FAILED with a safe,
 * client-visible message (the real error only ever goes to the
 * server log).
 *
 * Why in-process: Inngest needs a hosted Inngest account and signing
 * keys to deliver events in production; with none configured, every
 * send failed and reports sat PENDING forever. One dyno, one job at
 * a time, sub-second renders — a queue service buys nothing here.
 */
async function runReportJobWithRetries({ prisma, reportId, renderFn, maxAttempts = 3 }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runReportGeneration({ prisma, reportId, renderFn });
      return;
    } catch (err) {
      lastError = err;
      console.error(`report job ${reportId}: attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) await sleep(1000 * attempt);
    }
  }
  console.error(`report job ${reportId}: exhausted ${maxAttempts} attempts:`, lastError?.message);
  await prisma.report
    .update({ where: { id: reportId }, data: { status: "FAILED", error: SAFE_FAILURE_MESSAGE } })
    .catch((logErr) => {
      console.error(`report job ${reportId}: failed to mark report as failed:`, logErr.message);
    });
}

/**
 * Drop-in replacement for the Inngest client the routes were written
 * against: same `send({ name, data })` shape and the same event name,
 * so the route code and the applications.test.js stub are unchanged.
 * `send` only validates and schedules — the render itself runs in the
 * background after the HTTP response has already gone out.
 */
export function createLocalJobClient({ prisma, renderFn = defaultRenderFn }) {
  return {
    async send({ name, data }) {
      if (name !== "report/requested") {
        throw new Error(`Unknown job event "${name}".`);
      }
      const reportId = data?.reportId;
      if (!reportId) {
        throw new Error('Job event "report/requested" requires data.reportId.');
      }
      setImmediate(() => {
        void runReportJobWithRetries({ prisma, reportId, renderFn });
      });
    },
  };
}
