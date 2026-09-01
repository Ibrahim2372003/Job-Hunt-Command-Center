import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createPrismaClient } from "../src/db.js";
import { buildApplicationReportHtml } from "../src/report.js";
import { runReportGeneration } from "../src/inngest/functions/generateApplicationReport.js";
import { REPORTS_DIR } from "../src/paths.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:2372003@localhost:5432/jobhunt_db";

mkdirSync(REPORTS_DIR, { recursive: true });

// --- buildApplicationReportHtml: pure, no Playwright, no DB ---

test("buildApplicationReportHtml: includes company, role, job description, and every tailored bullet", () => {
  const html = buildApplicationReportHtml({
    application: { company: "Acme Corp", role: "Backend Engineer", jobUrl: "https://acme.example/jobs/1", jobDescription: "Build backend services." },
    bullets: ["Built REST APIs.", "Maintained a Postgres database."],
  });

  assert.match(html, /Acme Corp/);
  assert.match(html, /Backend Engineer/);
  assert.match(html, /Build backend services\./);
  assert.match(html, /Built REST APIs\./);
  assert.match(html, /Maintained a Postgres database\./);
  assert.match(html, /https:\/\/acme\.example\/jobs\/1/);
});

test("buildApplicationReportHtml: omits the job URL line entirely when there is none", () => {
  const html = buildApplicationReportHtml({
    application: { company: "Acme", role: "Engineer", jobUrl: null, jobDescription: "A role." },
    bullets: ["A bullet."],
  });
  assert.doesNotMatch(html, /<a href=/);
});

test("buildApplicationReportHtml: escapes HTML in every field — no injection from user-entered content", () => {
  const html = buildApplicationReportHtml({
    application: { company: '<script>alert("x")</script>', role: "Engineer", jobUrl: null, jobDescription: "A role." },
    bullets: ["<img src=x onerror=alert(1)>"],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test("buildApplicationReportHtml: never invents content not passed in", () => {
  const html = buildApplicationReportHtml({
    application: { company: "Acme", role: "Engineer", jobUrl: null, jobDescription: "A role." },
    bullets: ["Only this bullet."],
  });
  assert.equal((html.match(/<li>/g) || []).length, 1, "exactly one bullet in, exactly one <li> out");
});

// --- runReportGeneration: real Postgres, STUB renderFn (no real browser) ---

let renderCallCount = 0;
async function stubRender(html, outputPath) {
  renderCallCount += 1;
  writeFileSync(outputPath, `STUB PDF (not real Chromium output)\n\n${html.length} chars of HTML would have been rendered here.`, "utf-8");
}

async function setUpApplicationWithTailoring(prisma) {
  const user = await prisma.user.create({ data: { email: `report-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: "x" } });
  const application = await prisma.application.create({
    data: { userId: user.id, company: "Acme", role: "Backend Engineer", jobDescription: "A backend role." },
  });
  await prisma.tailoredResume.create({
    data: { applicationId: application.id, bullets: ["Built X.", "Led Y."], model: "gpt-5.6-luna", promptTokens: 10, completionTokens: 5, costUsd: 0.0001 },
  });
  return { user, application };
}

test("runReportGeneration: turns a pending report into a done report with a real file on disk", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  const { application } = await setUpApplicationWithTailoring(prisma);
  const report = await prisma.report.create({ data: { applicationId: application.id, status: "PENDING" } });
  renderCallCount = 0;

  const result = await runReportGeneration({ prisma, reportId: report.id, renderFn: stubRender });

  const stored = await prisma.report.findUnique({ where: { id: report.id } });
  assert.equal(stored.status, "DONE");
  assert.ok(stored.filePath);
  assert.equal(result.filePath, stored.filePath);
  assert.equal(renderCallCount, 1);

  const fileContents = await import("node:fs/promises").then((fs) => fs.readFile(stored.filePath, "utf-8"));
  assert.match(fileContents, /STUB PDF/);

  rmSync(stored.filePath, { force: true });
  await prisma.$disconnect();
});

test("runReportGeneration: the rendered HTML actually reflects the real tailored bullets, not a mock of the whole pipeline", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  const { application } = await setUpApplicationWithTailoring(prisma);
  const report = await prisma.report.create({ data: { applicationId: application.id, status: "PENDING" } });

  let capturedHtml = null;
  const capturingRender = async (html, outputPath) => {
    capturedHtml = html;
    await stubRender(html, outputPath);
  };

  await runReportGeneration({ prisma, reportId: report.id, renderFn: capturingRender });

  assert.match(capturedHtml, /Built X\./);
  assert.match(capturedHtml, /Led Y\./);
  assert.match(capturedHtml, /Acme/);

  const stored = await prisma.report.findUnique({ where: { id: report.id } });
  rmSync(stored.filePath, { force: true });
  await prisma.$disconnect();
});

test("runReportGeneration: idempotent — a report already marked DONE is not re-rendered", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  const { application } = await setUpApplicationWithTailoring(prisma);
  const report = await prisma.report.create({ data: { applicationId: application.id, status: "DONE", filePath: "/tmp/already-here.pdf" } });
  renderCallCount = 0;

  const result = await runReportGeneration({ prisma, reportId: report.id, renderFn: stubRender });

  assert.equal(renderCallCount, 0, "an already-done report must not trigger another render");
  assert.equal(result.filePath, "/tmp/already-here.pdf");
  await prisma.$disconnect();
});

test("runReportGeneration: no valid tailored resume — throws, report is left for the caller to mark FAILED", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({ data: { email: `report-test-novalid-${Date.now()}@example.com`, passwordHash: "x" } });
  const application = await prisma.application.create({ data: { userId: user.id, company: "Acme", role: "Engineer", jobDescription: "A role." } });
  // Only a FAILED tailoring attempt exists — { error, raw } shape, not a valid bullets array.
  await prisma.tailoredResume.create({
    data: { applicationId: application.id, bullets: { error: "invalid_llm_output", raw: "not json" }, model: "gpt-5.6-luna", promptTokens: 1, completionTokens: 1, costUsd: 0.00001 },
  });
  const report = await prisma.report.create({ data: { applicationId: application.id, status: "PENDING" } });

  await assert.rejects(() => runReportGeneration({ prisma, reportId: report.id, renderFn: stubRender }), /no valid tailored resume/);

  const stored = await prisma.report.findUnique({ where: { id: report.id } });
  assert.equal(stored.status, "PENDING", "runReportGeneration itself doesn't mark failure — the Inngest wrapper does, only once retries are exhausted");

  await prisma.$disconnect();
});

test("runReportGeneration: a render failure leaves the report PENDING (not silently DONE), for the caller to mark FAILED", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  const { application } = await setUpApplicationWithTailoring(prisma);
  const report = await prisma.report.create({ data: { applicationId: application.id, status: "PENDING" } });

  const failingRender = async () => {
    throw new Error("simulated renderer crash (e.g. Chromium not installed)");
  };

  await assert.rejects(() => runReportGeneration({ prisma, reportId: report.id, renderFn: failingRender }), /simulated renderer crash/);

  const stored = await prisma.report.findUnique({ where: { id: report.id } });
  assert.equal(stored.status, "PENDING");
  assert.equal(stored.filePath, null);

  await prisma.$disconnect();
});

test("runReportGeneration: throws a clear error for a report id with no reserved row", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await assert.rejects(() => runReportGeneration({ prisma, reportId: "00000000-0000-0000-0000-000000000000", renderFn: stubRender }), /No report row for id/);
  await prisma.$disconnect();
});
