import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

/**
 * Pure string-building — no Playwright, no filesystem, no Prisma.
 * Same reasoning as pdf-report-generator's buildReportHtml: this is
 * what makes "does the report contain the right content" testable
 * without a real headless browser — assert on the HTML string
 * directly, then a separate, unmockable Playwright call turns that
 * same string into a PDF later.
 *
 * Only ever renders data that's actually in the database — company,
 * role, job URL, job description, and the tailored bullets from a
 * real TailoredResume row. Nothing here invents content.
 */
export function buildApplicationReportHtml({ application, bullets }) {
  const generatedOn = new Date().toISOString().slice(0, 10);

  const bulletItems = bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(application.role)} at ${escapeHtml(application.company)} — Tailored Resume</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .subtitle { color: #555; margin-top: 0; margin-bottom: 4px; }
  .meta { color: #777; font-size: 11px; margin-bottom: 24px; }
  .meta a { color: #555; }
  h2 { font-size: 14px; margin-top: 26px; margin-bottom: 8px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  ul { padding-left: 18px; margin: 0; }
  li { margin-bottom: 8px; break-inside: avoid; }
  .job-description { white-space: pre-wrap; color: #333; font-size: 12px; }
</style>
</head>
<body>
  <h1>${escapeHtml(application.role)}</h1>
  <p class="subtitle">${escapeHtml(application.company)}</p>
  <p class="meta">
    Tailored resume generated ${generatedOn}${application.jobUrl ? ` &middot; <a href="${escapeHtml(application.jobUrl)}">${escapeHtml(application.jobUrl)}</a>` : ""}
  </p>

  <h2>Tailored Experience</h2>
  <ul>
    ${bulletItems}
  </ul>

  <h2>Job Description</h2>
  <p class="job-description">${escapeHtml(application.jobDescription)}</p>
</body>
</html>`;
}

/**
 * Renders the report straight to PDF with pdfkit — no headless
 * browser. Playwright/Chromium was the original renderer, but it
 * can't run on the free Render deploy (no Chromium in the build, and
 * ~400MB of browser in a 512MB instance), which is why report
 * generation never worked in production. pdfkit is pure JS, starts
 * instantly, and uses a few MB of memory.
 *
 * Content mirrors buildApplicationReportHtml exactly: same fields,
 * same order, nothing invented. The HTML builder stays (and stays
 * tested) as the canonical content check; this is the production
 * renderer, so it receives the structured data, not the HTML string.
 */
export async function renderReportPdf({ application, bullets }, outputPath) {
  const generatedOn = new Date().toISOString().slice(0, 10);

  const doc = new PDFDocument({ size: "A4", margins: { top: 57, bottom: 57, left: 51, right: 51 } });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  const rule = () => {
    const y = doc.y;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(1).stroke("#1a1a1a");
    doc.moveDown(0.6);
  };

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#1a1a1a").text(application.role);
  doc.font("Helvetica").fontSize(12).fillColor("#555555").text(application.company);
  const metaParts = [`Tailored resume generated ${generatedOn}`];
  if (application.jobUrl) metaParts.push(application.jobUrl);
  doc.font("Helvetica").fontSize(9).fillColor("#777777").text(metaParts.join("   "));
  doc.moveDown(1.5);

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1a1a1a").text("TAILORED EXPERIENCE");
  rule();
  doc.font("Helvetica").fontSize(11).fillColor("#1a1a1a").list(bullets, { bulletRadius: 1.6, textIndent: 14, bulletIndent: 4, lineGap: 3 });
  doc.moveDown(1.2);

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1a1a1a").text("JOB DESCRIPTION");
  rule();
  doc.font("Helvetica").fontSize(10).fillColor("#333333").text(application.jobDescription, { lineGap: 2.5 });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
  });
}
