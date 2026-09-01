import { chromium } from "playwright";

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
 * The one piece of this pipeline that genuinely needs a real headless
 * browser — launches Chromium, loads the HTML, prints it. Identical
 * approach to pdf-report-generator's renderHtmlToPdf.
 */
export async function renderHtmlToPdf(html, outputPath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}
