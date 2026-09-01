import { inngest } from "../client.js";
import { buildApplicationReportHtml, renderHtmlToPdf } from "../../report.js";
import { REPORTS_DIR } from "../../paths.js";
import path from "node:path";

const SAFE_FAILURE_MESSAGE = "Report generation failed. Please try requesting the report again.";

/**
 * The actual slow work, as a plain async function with no Inngest in
 * it — same reasoning as pdf-report-generator's runReportGeneration:
 * keep the untestable-without-a-browser part (Playwright) swappable
 * via `renderFn`, so the PENDING -> DONE/FAILED transition is
 * genuinely testable without a real headless browser, and this exact
 * function is also what `step.run` below calls in production.
 */
export async function runReportGeneration({ prisma, reportId, renderFn = renderHtmlToPdf }) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    throw new Error(`No report row for id ${reportId} — it must be reserved by POST /applications/:id/report before this event is sent.`);
  }

  // Idempotency: the same event can be delivered more than once (an
  // Inngest retry, or a duplicate delivery after the first run
  // already finished). If this report is already done, skip the work
  // entirely instead of regenerating and re-saving a file that
  // already exists — same guard, same reasoning, as the earlier PDF
  // project's background job.
  if (report.status === "DONE") {
    return { filePath: report.filePath };
  }

  const application = await prisma.application.findUnique({ where: { id: report.applicationId } });
  if (!application) {
    throw new Error(`Report ${reportId} references application ${report.applicationId}, which no longer exists.`);
  }

  // Only ever render a tailoring attempt that actually produced valid
  // bullets — a failed tailoring call stores { error, raw } in this
  // same Json column (see llm.js's TailorOutputError handling), and
  // that must never end up rendered into a "report" as if it were
  // real content.
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
  await renderFn(html, filePath);

  await prisma.report.update({ where: { id: report.id }, data: { status: "DONE", filePath, error: null } });

  return { filePath };
}

/**
 * Factory instead of a single module-level export so tests (and the
 * real server) can each supply their own `prisma`/`renderFn` — same
 * dependency-injection shape as everything else in this project.
 *
 * `retries: 2` and `concurrency: { limit: 2 }` match the established
 * convention from the earlier PDF/background-job projects.
 */
export function createGenerateApplicationReportFunction({ prisma, renderFn = renderHtmlToPdf }) {
  return inngest.createFunction(
    { id: "generate-application-report", retries: 2, concurrency: { limit: 2 } },
    { event: "report/requested" },
    async ({ event, step }) => {
      const { reportId } = event.data;

      try {
        return await step.run("generate-application-report", () => runReportGeneration({ prisma, reportId, renderFn }));
      } catch (err) {
        // Only reached once Inngest has truly given up (retries
        // exhausted). A safe, generic message is stored for the
        // client — the real error (which could contain internal
        // details) only ever goes to the server log.
        console.error(`generate-application-report failed for report ${reportId}:`, err.message);
        await prisma.report
          .update({ where: { id: reportId }, data: { status: "FAILED", error: SAFE_FAILURE_MESSAGE } })
          .catch((logErr) => {
            console.error(`generate-application-report: failed to mark report ${reportId} as failed:`, logErr.message);
          });
        throw err;
      }
    }
  );
}
