import express from "express";
import OpenAI from "openai";
import { mkdirSync } from "node:fs";
import { serve } from "inngest/express";
import { validateApplicationInput, validateSignupInput, validateLoginInput, validateTailorInput } from "./validation.js";
import { hashPassword, verifyPassword, signToken, requireAuth } from "./auth.js";
import { tailorBullets, TailorOutputError } from "./llm.js";
import { inngest } from "./inngest/client.js";
import { createGenerateApplicationReportFunction } from "./inngest/functions/generateApplicationReport.js";
import { REPORTS_DIR } from "./paths.js";

/**
 * `prisma` and `openaiClient` are both injected rather than imported
 * directly — same "the DB/API client is a dependency, not a global"
 * pattern as everything else here. Unlike Prisma and the earlier
 * Anthropic SDK, the official `openai` SDK throws immediately at
 * construction if no API key is present (confirmed by actually
 * running `new OpenAI()` with no key set) — so `openaiClient` is
 * NOT constructed via a default parameter (that would crash the
 * whole server at startup, even for routes that never touch OpenAI,
 * if `OPENAI_API_KEY` isn't set yet). Instead it's constructed lazily,
 * only inside the one route that actually needs it, the first time
 * that route is hit without an injected client. Tests always inject a
 * stub, so this only matters for the real server.
 *
 * `inngestClient` and `renderFn` follow the same injection pattern as
 * the pdf-report-generator project: real Inngest client + real
 * Playwright renderer by default, swappable in tests.
 */
export function createApp({ prisma, openaiClient, inngestClient = inngest, renderFn }) {
  const app = express();
  app.use(express.json());
  mkdirSync(REPORTS_DIR, { recursive: true });

  const generateApplicationReport = createGenerateApplicationReportFunction({ prisma, renderFn });

  // Minimal, hand-rolled CORS — this is a local dev SPA on a
  // different port, not a public API with real cross-origin
  // requirements yet. A `cors` dependency would be solving a problem
  // this project doesn't have at M2.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader(
  "Access-Control-Allow-Methods",
  "GET, POST, PATCH, DELETE, OPTIONS"
);    // M3 added `Authorization: Bearer <token>` on every authenticated
    // request; this header list was never updated to match, so a real
    // browser's CORS preflight rejected every authenticated request
    // (list load and form submit alike) before it ever reached the
    // server — Node's fetch (used by every automated test here)
    // doesn't enforce CORS, which is exactly why this was never
    // caught by npm test.
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Signup: create the user, then hand back a token immediately —
  // one less round trip than making them log in right after signing
  // up.
  app.post("/auth/signup", async (req, res) => {
    const result = validateSignupInput(req.body);
    if (!result.valid) {
      return res.status(400).json({ error: "invalid_request", messages: result.errors });
    }

    try {
      const existing = await prisma.user.findUnique({ where: { email: result.data.email } });
      if (existing) {
        return res.status(409).json({ error: "email_taken", message: "An account with this email already exists." });
      }

      const passwordHash = await hashPassword(result.data.password);
      const user = await prisma.user.create({ data: { email: result.data.email, passwordHash } });
      const token = signToken(user.id);

      return res.status(201).json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      console.error("POST /auth/signup failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not create the account." });
    }
  });

  // Login: deliberately the same generic error for "no such email"
  // and "wrong password" — distinguishing them lets an attacker
  // enumerate which emails have accounts.
  app.post("/auth/login", async (req, res) => {
    const result = validateLoginInput(req.body);
    if (!result.valid) {
      return res.status(400).json({ error: "invalid_request", messages: result.errors });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email: result.data.email } });
      const passwordMatches = user ? await verifyPassword(result.data.password, user.passwordHash) : false;

      if (!user || !passwordMatches) {
        return res.status(401).json({ error: "invalid_credentials", message: "Email or password is incorrect." });
      }

      const token = signToken(user.id);
      return res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      console.error("POST /auth/login failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not log in." });
    }
  });

  // The walking skeleton from M2, now behind requireAuth and scoped
  // to the caller's own data. validate -> insert -> respond is
  // otherwise unchanged.
  app.post("/applications", requireAuth, async (req, res) => {
    const result = validateApplicationInput(req.body);
    if (!result.valid) {
      return res.status(400).json({ error: "invalid_request", messages: result.errors });
    }

    try {
      const application = await prisma.application.create({ data: { ...result.data, userId: req.userId } });
      return res.status(201).json(application);
    } catch (err) {
      console.error("POST /applications failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not create the application." });
    }
  });

  app.get("/applications", requireAuth, async (req, res) => {
    try {
      const applications = await prisma.application.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
      });
      return res.json(applications);
    } catch (err) {
      console.error("GET /applications failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not list applications." });
    }
  });

  // Update: reuses validateApplicationInput exactly as POST does —
  // the Edit form resubmits the full set of fields (not a partial
  // patch), so the same "company/role/jobDescription required"
  // validation applies unchanged. Same 404-not-403 ownership check as
  // every other application route.
  app.patch("/applications/:id", requireAuth, async (req, res) => {
    const result = validateApplicationInput(req.body);
    if (!result.valid) {
      return res.status(400).json({ error: "invalid_request", messages: result.errors });
    }

    let application;
    try {
      application = await prisma.application.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      console.error("PATCH /applications/:id failed (lookup):", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not look up the application." });
    }
    if (!application || application.userId !== req.userId) {
      return res.status(404).json({ error: "not_found", message: `No application with id "${req.params.id}".` });
    }

    try {
      const updated = await prisma.application.update({ where: { id: application.id }, data: result.data });
      return res.json(updated);
    } catch (err) {
      console.error("PATCH /applications/:id failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not update the application." });
    }
  });

  // Delete: Application has non-cascading FK relations to both
  // TailoredResume and Report (no onDelete: Cascade — deliberate,
  // matching Feature 4's precedent). Deleting an Application with
  // existing children would hit the exact FK-violation this project
  // already learned about the hard way in test cleanup — so children
  // are deleted first, in a transaction, respecting that existing
  // relation behavior instead of changing it.
  app.delete("/applications/:id", requireAuth, async (req, res) => {
    let application;
    try {
      application = await prisma.application.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      console.error("DELETE /applications/:id failed (lookup):", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not look up the application." });
    }
    if (!application || application.userId !== req.userId) {
      return res.status(404).json({ error: "not_found", message: `No application with id "${req.params.id}".` });
    }

    try {
      await prisma.$transaction([
        prisma.report.deleteMany({ where: { applicationId: application.id } }),
        prisma.tailoredResume.deleteMany({ where: { applicationId: application.id } }),
        prisma.application.delete({ where: { id: application.id } }),
      ]);
      // A JSON body (not a bare 204) — every other response in this
      // API is JSON, and the frontend's apiFetch always calls
      // res.json(); a truly empty 204 body would make that throw.
      return res.status(200).json({ deleted: true, id: application.id });
    } catch (err) {
      console.error("DELETE /applications/:id failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not delete the application." });
    }
  });

  // M4: the one narrow AI job. Ownership-checked the same way as
  // everything else that touches an application — 404, not 403, for
  // someone else's application, so we're not confirming it exists.
  app.post("/applications/:id/tailor", requireAuth, async (req, res) => {
    const result = validateTailorInput(req.body);
    if (!result.valid) {
      return res.status(400).json({ error: "invalid_request", messages: result.errors });
    }

    let application;
    try {
      application = await prisma.application.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      console.error("POST /applications/:id/tailor failed (lookup):", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not look up the application." });
    }

    if (!application || application.userId !== req.userId) {
      return res.status(404).json({ error: "not_found", message: `No application with id "${req.params.id}".` });
    }

    try {
      const client = openaiClient ?? new OpenAI();
      const outcome = await tailorBullets(client, {
        jobDescription: application.jobDescription,
        baseBullets: result.data.baseBullets,
      });

      await prisma.tailoredResume.create({
        data: {
          applicationId: application.id,
          bullets: outcome.bullets,
          model: outcome.model,
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
          costUsd: outcome.costUsd,
        },
      });

      return res.status(201).json({
        bullets: outcome.bullets,
        usage: { model: outcome.model, promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens, costUsd: outcome.costUsd },
      });
    } catch (err) {
      if (err instanceof TailorOutputError) {
        // The API call succeeded — real cost was incurred — but the
        // output didn't validate. Log the cost even though there are
        // no valid bullets to return.
        try {
          await prisma.tailoredResume.create({
            data: {
              applicationId: application.id,
              bullets: { error: "invalid_llm_output", raw: err.rawText },
              model: err.model,
              promptTokens: err.promptTokens,
              completionTokens: err.completionTokens,
              costUsd: err.costUsd,
            },
          });
        } catch (logErr) {
          console.error("POST /applications/:id/tailor: failed to log a costed failure:", logErr.message);
        }
        console.error("POST /applications/:id/tailor failed (bad output):", err.message);
        return res.status(502).json({ error: "invalid_llm_output", message: "The model's response could not be used. The attempt was still logged." });
      }

      // A hard request failure (network, auth, rate limit) — no
      // usage came back, so nothing to log.
      console.error("POST /applications/:id/tailor failed (request):", err.message);
      return res.status(502).json({ error: "llm_request_failed", message: "Could not reach the tailoring service." });
    }
  });

  // Feature 4: async PDF report generation. Validates ownership and
  // that there's actually tailored content to render, then reserves
  // a Report row and enqueues the background job — the slow work
  // (Playwright) never runs inside this request. Race-safe: Report's
  // applicationId is unique, so a genuine simultaneous double-POST
  // hits a unique-constraint violation (caught below) instead of
  // creating two rows or enqueuing two jobs.
  app.post("/applications/:id/report", requireAuth, async (req, res) => {
    let application;
    try {
      application = await prisma.application.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      console.error("POST /applications/:id/report failed (lookup):", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not look up the application." });
    }
    if (!application || application.userId !== req.userId) {
      return res.status(404).json({ error: "not_found", message: `No application with id "${req.params.id}".` });
    }

    try {
      const tailoredResumes = await prisma.tailoredResume.findMany({
        where: { applicationId: application.id },
        orderBy: { createdAt: "desc" },
      });
      const hasValidTailoring = tailoredResumes.some((t) => Array.isArray(t.bullets));
      if (!hasValidTailoring) {
        return res.status(400).json({
          error: "no_tailored_resume",
          message: "This application has no tailored resume yet. Tailor a resume first, then request a report.",
        });
      }

      let report = await prisma.report.findUnique({ where: { applicationId: application.id } });

      if (report) {
        if (report.status === "PENDING") {
          // Already in progress — don't enqueue a second job.
          return res.status(202).json({ status: "pending", reportId: report.id });
        }
        if (report.status === "DONE") {
          // Idempotent: a completed report already exists, so this
          // endpoint doesn't blindly regenerate it.
          return res.status(200).json({ status: "done", reportId: report.id, url: `/applications/${application.id}/report/file` });
        }
        // FAILED: reset to pending and try again — a past failure
        // must not permanently block every future attempt.
        report = await prisma.report.update({ where: { id: report.id }, data: { status: "PENDING", error: null } });
      } else {
        try {
          report = await prisma.report.create({ data: { applicationId: application.id, status: "PENDING" } });
        } catch (err) {
          if (err.code === "P2002") {
            // Lost a genuine race to a concurrent request that
            // created the row first — treat it the same as "already
            // pending", not an error.
            report = await prisma.report.findUnique({ where: { applicationId: application.id } });
            return res.status(202).json({ status: "pending", reportId: report.id });
          }
          throw err;
        }
      }

      await inngestClient.send({ name: "report/requested", data: { reportId: report.id } });

      return res.status(202).json({ status: "pending", reportId: report.id });
    } catch (err) {
      console.error("POST /applications/:id/report failed:", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not request the report." });
    }
  });

  app.get("/applications/:id/report", requireAuth, async (req, res) => {
    let application;
    try {
      application = await prisma.application.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      console.error("GET /applications/:id/report failed (lookup):", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not look up the application." });
    }
    if (!application || application.userId !== req.userId) {
      return res.status(404).json({ error: "not_found", message: `No application with id "${req.params.id}".` });
    }

    const report = await prisma.report.findUnique({ where: { applicationId: application.id } });
    if (!report) {
      return res.status(404).json({ error: "not_found", message: "No report has been requested for this application yet." });
    }

    if (report.status === "PENDING") return res.json({ status: "pending" });
    if (report.status === "DONE") return res.json({ status: "done", reportId: report.id, url: `/applications/${application.id}/report/file` });
    return res.json({ status: "failed", error: report.error });
  });

  // Store and link: the only endpoint that moves the PDF bytes, only
  // once the background job has actually finished, only to the
  // application's owner. Never a raw filesystem path in any response.
  app.get("/applications/:id/report/file", requireAuth, async (req, res) => {
    let application;
    try {
      application = await prisma.application.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      console.error("GET /applications/:id/report/file failed (lookup):", err.message);
      return res.status(500).json({ error: "request_failed", message: "Could not look up the application." });
    }
    if (!application || application.userId !== req.userId) {
      return res.status(404).json({ error: "not_found", message: `No application with id "${req.params.id}".` });
    }

    const report = await prisma.report.findUnique({ where: { applicationId: application.id } });
    if (!report || report.status !== "DONE" || !report.filePath) {
      return res.status(409).json({ error: "not_ready", message: "The report is not ready yet." });
    }

    return res.sendFile(report.filePath);
  });

  app.use("/api/inngest", serve({ client: inngestClient, functions: [generateApplicationReport] }));

  return app;
}
