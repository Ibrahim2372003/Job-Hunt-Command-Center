import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createPrismaClient } from "../src/db.js";

// Runs against a real, separate Postgres database (jobhunt_test) via
// the real Prisma client — not a mock. TEST_DATABASE_URL defaults to
// a local jobhunt_test database; override it in CI as needed. Run
// `npx prisma migrate dev` (or `db push`) against that database
// before running these tests, same as any other Prisma project.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:2372003@localhost:5432/jobhunt_db";

process.env.JWT_SECRET = process.env.JWT_SECRET ||"1R.=hS-d:|2LIna>>,}:sp";

async function request(app, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const url = `http://localhost:${port}${urlPath}`;
      const headers = {};
      if (body) headers["Content-Type"] = "application/json";
      if (token) headers["Authorization"] = `Bearer ${token}`;
      fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
        .then(async (res) => {
          const payload = await res.json();
          server.close();
          resolve({ status: res.status, body: payload });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// Signs up a fresh user (unique email per call) and returns their
// token — every /applications test needs this now that the routes
// are behind requireAuth.
async function signUpAndGetToken(app, emailPrefix = "user") {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app, "POST", "/auth/signup", { email, password: "longenough1" });
  assert.equal(res.status, 201, `signup must succeed to get a token (got ${res.status}: ${JSON.stringify(res.body)})`);
  return res.body.token;
}

// Stub OpenAI client — same reasoning as stubRender in the PDF
// project: no network, no real API key, but the exact shape
// tailorBullets()/app.js expect from the official OpenAI SDK's
// Responses API (`responses.create` returning `{ usage, output_text }`).
function makeStubOpenaiClient(outputText = '{"bullets": ["Tailored bullet one."]}', usage = { input_tokens: 100, output_tokens: 50 }) {
  return {
    responses: {
      create: async () => ({ usage, output_text: outputText }),
    },
  };
}

// Stub Inngest client — captures sent events instead of making a real
// call or requiring a real Inngest dev server, same pattern used for
// pdf-report-generator's server.test.js. Report generation tests
// exercise the actual work via runReportGeneration() directly (see
// report.test.js), not through this stub — this one is only for
// asserting on the HTTP-layer's "did we enqueue, and only once" logic.
function makeStubInngestClient() {
  const sent = [];
  return {
    sent,
    send: async (event) => {
      sent.push(event);
      return { ids: [`stub-${sent.length}`] };
    },
  };
}

// Creates an application and gives it one successful tailoring pass,
// so tests that need "an application with a valid tailored resume"
// don't each repeat the two-request setup inline.
async function createTailoredApplication(app, token) {
  const created = await request(
    app, "POST", "/applications",
    { company: "Acme", role: "Backend Engineer", jobDescription: "A backend role requiring Node.js." },
    token
  );
  await request(app, "POST", `/applications/${created.body.id}/tailor`, { baseBullets: ["Did a thing."] }, token);
  return created.body;
}

test("GET /health returns ok (no auth required)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });
  const res = await request(app, "GET", "/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
  await prisma.$disconnect();
});

test("POST /applications: without a token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });

  const res = await request(app, "POST", "/applications", { company: "Acme", role: "Engineer", jobDescription: "..." });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  await prisma.$disconnect();
});

test("GET /applications: without a token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });

  const res = await request(app, "GET", "/applications");

  assert.equal(res.status, 401);
  await prisma.$disconnect();
});

test("POST /applications: with an invalid token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });

  const res = await request(app, "POST", "/applications", { company: "Acme", role: "Engineer", jobDescription: "..." }, "not-a-real-token");

  assert.equal(res.status, 401);
  await prisma.$disconnect();
});

test("POST /applications: valid input with a valid token is persisted and scoped to that user", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });
  const token = await signUpAndGetToken(app);

  const res = await request(
    app,
    "POST",
    "/applications",
    { company: "Acme Corp", role: "Backend Engineer", jobUrl: "https://acme.example/jobs/42", jobDescription: "Build and maintain backend services." },
    token
  );

  assert.equal(res.status, 201);
  assert.ok(res.body.id);
  assert.equal(res.body.company, "Acme Corp");
  assert.equal(res.body.status, "SAVED");

  const stored = await prisma.application.findUnique({ where: { id: res.body.id } });
  assert.ok(stored, "the row must actually exist in Postgres, not just in the response");
  assert.equal(stored.role, "Backend Engineer");
  assert.ok(stored.userId, "the stored row must be attributed to a user");

  await prisma.$disconnect();
});

test("POST /applications: missing required fields returns 400 with clear messages (auth still required first)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });
  const token = await signUpAndGetToken(app);

  const res = await request(app, "POST", "/applications", { company: "" }, token);

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_request");
  assert.ok(res.body.messages.includes("company is required"));
  assert.ok(res.body.messages.includes("role is required"));
  assert.ok(res.body.messages.includes("jobDescription is required"));

  await prisma.$disconnect();
});

test("POST /applications: invalid status enum returns 400", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });
  const token = await signUpAndGetToken(app);

  const res = await request(app, "POST", "/applications", { company: "X", role: "Y", jobDescription: "Z", status: "NOT_A_STATUS" }, token);

  assert.equal(res.status, 400);
  assert.match(res.body.messages[0], /status must be one of/);

  await prisma.$disconnect();
});

test("GET /applications: returns only the caller's own applications, newest first", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });
  const token = await signUpAndGetToken(app);

  await request(app, "POST", "/applications", { company: "First Co", role: "Engineer", jobDescription: "..." }, token);
  await request(app, "POST", "/applications", { company: "Second Co", role: "Engineer", jobDescription: "..." }, token);

  const res = await request(app, "GET", "/applications", undefined, token);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].company, "Second Co", "newest first");

  await prisma.$disconnect();
});

test("cross-user isolation: user B never sees user A's applications", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });

  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");

  await request(app, "POST", "/applications", { company: "Alice-Only Co", role: "Engineer", jobDescription: "..." }, tokenA);

  const bobsList = await request(app, "GET", "/applications", undefined, tokenB);
  assert.equal(bobsList.status, 200);
  assert.equal(bobsList.body.length, 0, "Bob must not see Alice's application");

  const alicesList = await request(app, "GET", "/applications", undefined, tokenA);
  assert.equal(alicesList.body.length, 1);
  assert.equal(alicesList.body[0].company, "Alice-Only Co");

  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: without a token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });

  const res = await request(app, "POST", "/applications/some-id/tailor", { baseBullets: ["Did a thing."] });

  assert.equal(res.status, 401);
  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: invalid baseBullets returns 400 before any OpenAI call", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  let callCount = 0;
  const countingClient = {
    responses: { create: async () => { callCount += 1; return { usage: { input_tokens: 1, output_tokens: 1 }, output_text: '{"bullets": []}' }; } },
  };
  const app = createApp({ prisma, openaiClient: countingClient });
  const token = await signUpAndGetToken(app);

  const created = await request(
    app, "POST", "/applications",
    { company: "Acme", role: "Engineer", jobDescription: "A backend role." },
    token
  );

  const res = await request(app, "POST", `/applications/${created.body.id}/tailor`, { baseBullets: [] }, token);

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_request");
  assert.equal(callCount, 0, "no OpenAI call should be made when input validation fails");

  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: unknown application id returns 404", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });
  const token = await signUpAndGetToken(app);

  const res = await request(app, "POST", "/applications/00000000-0000-0000-0000-000000000000/tailor", { baseBullets: ["Did a thing."] }, token);

  assert.equal(res.status, 404);
  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: user B cannot tailor user A's application (404, not 403 — no existence leak)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient() });

  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");

  const created = await request(
    app, "POST", "/applications",
    { company: "Alice-Only Co", role: "Engineer", jobDescription: "A backend role." },
    tokenA
  );

  const res = await request(app, "POST", `/applications/${created.body.id}/tailor`, { baseBullets: ["Did a thing."] }, tokenB);

  assert.equal(res.status, 404, "Bob must get 404, not 403 or 200, for Alice's application");

  const rows = await prisma.tailoredResume.findMany({ where: { applicationId: created.body.id } });
  assert.equal(rows.length, 0, "no tailoring should have happened for an application Bob doesn't own");

  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: valid request returns tailored bullets and logs a real cost row", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({
    prisma,
    openaiClient: makeStubOpenaiClient('{"bullets": ["Built X for a backend role.", "Led Y with measurable impact."]}', { input_tokens: 120, output_tokens: 40 }),
  });
  const token = await signUpAndGetToken(app);

  const created = await request(
    app, "POST", "/applications",
    { company: "Acme", role: "Backend Engineer", jobDescription: "A backend role." },
    token
  );

  const res = await request(app, "POST", `/applications/${created.body.id}/tailor`, { baseBullets: ["Did a thing.", "Did another thing."] }, token);

  assert.equal(res.status, 201);
  assert.deepEqual(res.body.bullets, ["Built X for a backend role.", "Led Y with measurable impact."]);
  assert.equal(res.body.usage.promptTokens, 120);
  assert.equal(res.body.usage.completionTokens, 40);
  assert.ok(res.body.usage.costUsd > 0);

  const rows = await prisma.tailoredResume.findMany({ where: { applicationId: created.body.id } });
  assert.equal(rows.length, 1, "a real TailoredResume row must exist");
  assert.equal(rows[0].promptTokens, 120);
  assert.equal(rows[0].completionTokens, 40);
  assert.deepEqual(rows[0].bullets, ["Built X for a backend role.", "Led Y with measurable impact."]);

  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: malformed model output still logs the incurred cost, and reports failure", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({
    prisma,
    openaiClient: makeStubOpenaiClient("Not JSON at all.", { input_tokens: 90, output_tokens: 10 }),
  });
  const token = await signUpAndGetToken(app);

  const created = await request(
    app, "POST", "/applications",
    { company: "Acme", role: "Backend Engineer", jobDescription: "A backend role." },
    token
  );

  const res = await request(app, "POST", `/applications/${created.body.id}/tailor`, { baseBullets: ["Did a thing."] }, token);

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "invalid_llm_output");

  const rows = await prisma.tailoredResume.findMany({ where: { applicationId: created.body.id } });
  assert.equal(rows.length, 1, "the incurred cost must still be logged even though the output was unusable");
  assert.equal(rows[0].promptTokens, 90);
  assert.equal(rows[0].completionTokens, 10);
  assert.equal(rows[0].bullets.error, "invalid_llm_output");

  await prisma.$disconnect();
});

test("POST /applications/:id/tailor: a hard OpenAI request failure logs nothing (no usage was returned)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const failingClient = { responses: { create: async () => { throw new Error("simulated network failure"); } } };
  const app = createApp({ prisma, openaiClient: failingClient });
  const token = await signUpAndGetToken(app);

  const created = await request(
    app, "POST", "/applications",
    { company: "Acme", role: "Backend Engineer", jobDescription: "A backend role." },
    token
  );

  const res = await request(app, "POST", `/applications/${created.body.id}/tailor`, { baseBullets: ["Did a thing."] }, token);

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "llm_request_failed");

  const rows = await prisma.tailoredResume.findMany({ where: { applicationId: created.body.id } });
  assert.equal(rows.length, 0, "nothing to log — no response, no usage, no incurred cost we know of");

  await prisma.$disconnect();
});

// --- Feature 4: async PDF report generation ---

test("POST /applications/:id/report: without a token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });

  const res = await request(app, "POST", "/applications/some-id/report");

  assert.equal(res.status, 401);
  await prisma.$disconnect();
});

test("POST /applications/:id/report: user B cannot request a report for user A's application (404)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const inngestClient = makeStubInngestClient();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient });

  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");
  const application = await createTailoredApplication(app, tokenA);

  const res = await request(app, "POST", `/applications/${application.id}/report`, undefined, tokenB);

  assert.equal(res.status, 404, "Bob must get 404, not 403 or 202, for Alice's application");
  assert.equal(inngestClient.sent.length, 0, "no job should be enqueued for an application Bob doesn't own");

  await prisma.$disconnect();
});

test("POST /applications/:id/report: no tailored resume yet returns 400, no job enqueued", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const inngestClient = makeStubInngestClient();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient });
  const token = await signUpAndGetToken(app);

  const created = await request(app, "POST", "/applications", { company: "Acme", role: "Engineer", jobDescription: "A role." }, token);

  const res = await request(app, "POST", `/applications/${created.body.id}/report`, undefined, token);

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "no_tailored_resume");
  assert.equal(inngestClient.sent.length, 0);

  await prisma.$disconnect();
});

test("POST /applications/:id/report: valid request returns 202 pending, reserves a real Report row, enqueues exactly one job", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const inngestClient = makeStubInngestClient();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);

  const start = Date.now();
  const res = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);
  const elapsedMs = Date.now() - start;

  assert.equal(res.status, 202);
  assert.equal(res.body.status, "pending");
  assert.ok(res.body.reportId);
  assert.ok(elapsedMs < 1000, `should return quickly, no PDF rendering in the request; took ${elapsedMs}ms`);

  const stored = await prisma.report.findUnique({ where: { applicationId: application.id } });
  assert.equal(stored.status, "PENDING");
  assert.equal(stored.filePath, null);

  assert.equal(inngestClient.sent.length, 1);
  assert.equal(inngestClient.sent[0].name, "report/requested");
  assert.deepEqual(inngestClient.sent[0].data, { reportId: stored.id });

  await prisma.$disconnect();
});

test("POST /applications/:id/report: a second request while pending does not enqueue a second job", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const inngestClient = makeStubInngestClient();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);

  const first = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);
  const second = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(first.body.reportId, second.body.reportId, "both responses reference the same report");
  assert.equal(inngestClient.sent.length, 1, "only one job should ever have been enqueued");

  await prisma.$disconnect();
});

test("POST /applications/:id/report: a second request after done returns the existing done result, does not re-enqueue", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const inngestClient = makeStubInngestClient();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);

  const first = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);
  // Simulate what the background job does once it finishes — the
  // same DB write runReportGeneration performs, exercised here at
  // the HTTP layer to prove the idempotent-when-done behavior.
  await prisma.report.update({ where: { id: first.body.reportId }, data: { status: "DONE", filePath: "/tmp/fake-report.pdf" } });

  const second = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);

  assert.equal(second.status, 200);
  assert.equal(second.body.status, "done");
  assert.equal(second.body.reportId, first.body.reportId);
  assert.ok(second.body.url);
  assert.equal(inngestClient.sent.length, 1, "a done report must not trigger a new job");

  await prisma.$disconnect();
});

test("POST /applications/:id/report: a prior FAILED report does not block a retry", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const inngestClient = makeStubInngestClient();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);

  const first = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);
  await prisma.report.update({ where: { id: first.body.reportId }, data: { status: "FAILED", error: "Report generation failed. Please try requesting the report again." } });

  const retry = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);

  assert.equal(retry.status, 202, "a retry after a failure must be able to enqueue a new attempt");
  assert.equal(retry.body.reportId, first.body.reportId, "reuses the same Report row (unique per application)");
  assert.equal(inngestClient.sent.length, 2, "the retry really did enqueue a second job");

  const stored = await prisma.report.findUnique({ where: { id: first.body.reportId } });
  assert.equal(stored.status, "PENDING");
  assert.equal(stored.error, null);

  await prisma.$disconnect();
});

test("GET /applications/:id/report: unknown application (or someone else's) returns 404", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });

  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");
  const application = await createTailoredApplication(app, tokenA);
  await request(app, "POST", `/applications/${application.id}/report`, undefined, tokenA);

  const res = await request(app, "GET", `/applications/${application.id}/report`, undefined, tokenB);
  assert.equal(res.status, 404);

  await prisma.$disconnect();
});

test("GET /applications/:id/report: no report requested yet returns 404", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);

  const res = await request(app, "GET", `/applications/${application.id}/report`, undefined, token);
  assert.equal(res.status, 404);

  await prisma.$disconnect();
});

test("GET /applications/:id/report: reflects pending, then done (simulating the background job), then failed", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);

  const created = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);

  const pending = await request(app, "GET", `/applications/${application.id}/report`, undefined, token);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.status, "pending");

  await prisma.report.update({ where: { id: created.body.reportId }, data: { status: "DONE", filePath: "/tmp/fake-report.pdf" } });
  const done = await request(app, "GET", `/applications/${application.id}/report`, undefined, token);
  assert.equal(done.body.status, "done");
  assert.equal(done.body.url, `/applications/${application.id}/report/file`);
  assert.equal(done.body.reportId, created.body.reportId);

  await prisma.report.update({ where: { id: created.body.reportId }, data: { status: "FAILED", filePath: null, error: "Report generation failed. Please try requesting the report again." } });
  const failed = await request(app, "GET", `/applications/${application.id}/report`, undefined, token);
  assert.equal(failed.body.status, "failed");
  assert.equal(failed.body.error, "Report generation failed. Please try requesting the report again.");
  assert.equal(failed.body.stack, undefined, "no stack trace or internal detail must ever be exposed");

  await prisma.$disconnect();
});

test("GET /applications/:id/report/file: 409 while pending, 200 with the file once done, never a raw filesystem path", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);
  const application = await createTailoredApplication(app, token);
  const created = await request(app, "POST", `/applications/${application.id}/report`, undefined, token);

  const stillPending = await request(app, "GET", `/applications/${application.id}/report/file`, undefined, token);
  assert.equal(stillPending.status, 409);

  const { writeFileSync, mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const { REPORTS_DIR } = await import("../src/paths.js");
  mkdirSync(REPORTS_DIR, { recursive: true });
  const realFilePath = path.join(REPORTS_DIR, `${created.body.reportId}.pdf`);
  writeFileSync(realFilePath, "%PDF-1.4 fake pdf content for test purposes");
  await prisma.report.update({ where: { id: created.body.reportId }, data: { status: "DONE", filePath: realFilePath } });

  const server = app.listen(0);
  const { port } = server.address();
  const fileRes = await fetch(`http://localhost:${port}/applications/${application.id}/report/file`, { headers: { Authorization: `Bearer ${token}` } });
  const bodyText = await fileRes.text();
  server.close();

  assert.equal(fileRes.status, 200);
  assert.match(bodyText, /fake pdf content/);
  assert.doesNotMatch(bodyText, /home\/claude|C:\\|D:\\/, "the response body must never leak a raw filesystem path");

  const { rmSync } = await import("node:fs");
  rmSync(realFilePath, { force: true });
  await prisma.$disconnect();
});

test("GET /applications/:id/report/file: user B cannot fetch user A's report file (404)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");
  const application = await createTailoredApplication(app, tokenA);
  const created = await request(app, "POST", `/applications/${application.id}/report`, undefined, tokenA);
  await prisma.report.update({ where: { id: created.body.reportId }, data: { status: "DONE", filePath: "/tmp/fake-report.pdf" } });

  const res = await request(app, "GET", `/applications/${application.id}/report/file`, undefined, tokenB);
  assert.equal(res.status, 404);

  await prisma.$disconnect();
});

// --- M5: Update (PATCH /applications/:id) ---

test("PATCH /applications/:id: without a token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });

  const res = await request(app, "PATCH", "/applications/some-id", { company: "X", role: "Y", jobDescription: "Z" });

  assert.equal(res.status, 401);
  await prisma.$disconnect();
});

test("PATCH /applications/:id: authenticated owner can update their own application", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);

  const created = await request(app, "POST", "/applications", { company: "Acme", role: "Engineer", jobDescription: "A role." }, token);

  const res = await request(
    app, "PATCH", `/applications/${created.body.id}`,
    { company: "Acme Corp", role: "Senior Engineer", jobDescription: "An updated role.", status: "APPLIED", jobUrl: "https://acme.example/jobs/1" },
    token
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.company, "Acme Corp");
  assert.equal(res.body.role, "Senior Engineer");
  assert.equal(res.body.status, "APPLIED");
  assert.equal(res.body.jobUrl, "https://acme.example/jobs/1");

  const stored = await prisma.application.findUnique({ where: { id: created.body.id } });
  assert.equal(stored.company, "Acme Corp");
  assert.equal(stored.status, "APPLIED");

  await prisma.$disconnect();
});

test("PATCH /applications/:id: user B cannot update user A's application (404)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");

  const created = await request(app, "POST", "/applications", { company: "Alice-Only Co", role: "Engineer", jobDescription: "A role." }, tokenA);
  const res = await request(app, "PATCH", `/applications/${created.body.id}`, { company: "Hijacked", role: "X", jobDescription: "Y" }, tokenB);

  assert.equal(res.status, 404);

  const stored = await prisma.application.findUnique({ where: { id: created.body.id } });
  assert.equal(stored.company, "Alice-Only Co", "Bob's request must not have changed anything");

  await prisma.$disconnect();
});

test("PATCH /applications/:id: invalid input is rejected with 400, existing data untouched", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);

  const created = await request(app, "POST", "/applications", { company: "Acme", role: "Engineer", jobDescription: "A role." }, token);
  const res = await request(app, "PATCH", `/applications/${created.body.id}`, { company: "" }, token);

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_request");

  const stored = await prisma.application.findUnique({ where: { id: created.body.id } });
  assert.equal(stored.company, "Acme");

  await prisma.$disconnect();
});

// --- M5: Delete (DELETE /applications/:id) ---

test("DELETE /applications/:id: without a token is rejected with 401", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });

  const res = await request(app, "DELETE", "/applications/some-id");

  assert.equal(res.status, 401);
  await prisma.$disconnect();
});

test("DELETE /applications/:id: authenticated owner can delete their own application, and it disappears from their list", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);

  const created = await request(app, "POST", "/applications", { company: "Acme", role: "Engineer", jobDescription: "A role." }, token);

  const res = await request(app, "DELETE", `/applications/${created.body.id}`, undefined, token);
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);

  const stored = await prisma.application.findUnique({ where: { id: created.body.id } });
  assert.equal(stored, null);

  const list = await request(app, "GET", "/applications", undefined, token);
  assert.equal(list.body.length, 0, "the deleted application must no longer appear in the owner's list");

  await prisma.$disconnect();
});

test("DELETE /applications/:id: user B cannot delete user A's application (404), and it still exists", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const tokenA = await signUpAndGetToken(app, "alice");
  const tokenB = await signUpAndGetToken(app, "bob");

  const created = await request(app, "POST", "/applications", { company: "Alice-Only Co", role: "Engineer", jobDescription: "A role." }, tokenA);
  const res = await request(app, "DELETE", `/applications/${created.body.id}`, undefined, tokenB);

  assert.equal(res.status, 404);

  const stored = await prisma.application.findUnique({ where: { id: created.body.id } });
  assert.ok(stored, "Alice's application must still exist — Bob's delete attempt must not have succeeded");

  await prisma.$disconnect();
});

test("DELETE /applications/:id: an application with existing TailoredResume and Report rows deletes cleanly (no FK violation)", async () => {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  await prisma.report.deleteMany();
  await prisma.tailoredResume.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();
  const app = createApp({ prisma, openaiClient: makeStubOpenaiClient(), inngestClient: makeStubInngestClient() });
  const token = await signUpAndGetToken(app);

  const application = await createTailoredApplication(app, token);
  await request(app, "POST", `/applications/${application.id}/report`, undefined, token);

  const reportBefore = await prisma.report.findUnique({ where: { applicationId: application.id } });
  assert.ok(reportBefore, "sanity check: a Report row really exists before deleting");

  const res = await request(app, "DELETE", `/applications/${application.id}`, undefined, token);
  assert.equal(res.status, 200, "deleting an application with dependent TailoredResume/Report rows must not hit an FK violation");

  const tailoredAfter = await prisma.tailoredResume.findMany({ where: { applicationId: application.id } });
  const reportAfter = await prisma.report.findUnique({ where: { applicationId: application.id } });
  assert.equal(tailoredAfter.length, 0, "dependent TailoredResume rows must be gone too");
  assert.equal(reportAfter, null, "the dependent Report row must be gone too");

  await prisma.$disconnect();
});
