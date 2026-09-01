# Feature 4 — Async PDF Export + Background Job

We are now continuing the core Job Hunt Command Center capstone.

Do NOT work on frontend UI/UX polish yet. Do NOT add visual styling, Edit/Delete UI, or unrelated features.

The next required core feature is:

**Async PDF export using a background job.**

This feature should cover the remaining capstone concepts:

* Background jobs
* PDF reporting

## Existing Project Context

The project currently has:

* PostgreSQL + Prisma
* Authentication with JWT
* User-owned job applications
* OpenAI integration for resume tailoring
* `TailoredResume` persisted in PostgreSQL
* Existing Prisma migrations
* Existing backend tests
* Express backend
* React/Vite frontend
* A previous `pdf-report-generator` project and background-job/Inngest pattern from earlier work that may be useful as a reference.

The current Prisma database is already migrated and up to date.

Do not modify existing migrations unless there is a concrete technical reason.

---

# Goal

Implement an asynchronous report/PDF generation flow for an authenticated application.

Desired API:

```text
POST /applications/:id/report
```

should enqueue/request report generation and immediately return:

```text
202 Accepted
```

with a response indicating that the report is pending.

A background job should then:

1. Verify the application belongs to the authenticated user.
2. Load the application and its tailored resume data.
3. Generate appropriate HTML/content for the report.
4. Render that HTML into a PDF using Playwright or the existing PDF generation approach.
5. Persist the generated PDF somewhere appropriate for the current project.
6. Update the report status.

Then:

```text
GET /applications/:id/report
```

should return the current report state:

```text
pending
```

or

```text
done
```

with access to the generated PDF,

or:

```text
failed
```

with a safe error message.

---

# IMPORTANT: Inspect Before Implementing

Before writing code, inspect the current repository carefully.

Specifically inspect:

### Backend

* `backend/package.json`
* `backend/src/app.js`
* `backend/src/server.js`
* `backend/src/db.js`
* `backend/src/llm.js`
* `backend/src/auth.js`
* `backend/src/validation.js`
* `backend/prisma/schema.prisma`
* all current Prisma migrations
* existing application routes
* existing application tests

### Previous PDF implementation

If the previous `pdf-report-generator` and/or background-job project is available locally, inspect it and reuse proven patterns where appropriate.

Do not blindly copy old code.

Determine:

* Which PDF library is currently available.
* Whether Playwright is already installed.
* Whether Inngest or another job mechanism is already installed.
* How the previous project handled browser lifecycle.
* How PDFs were stored.
* How background failures were handled.

---

# Architecture Decision

Choose the simplest reliable implementation that fits the current project.

Prefer reusing the existing Inngest/background-job pattern if it is already available or can be integrated cleanly.

Do NOT introduce Redis, RabbitMQ, BullMQ, SQS, or another infrastructure dependency unless the existing architecture genuinely requires it.

For this capstone, a simple reliable background-job implementation is preferable to unnecessary infrastructure.

---

# Database

Inspect the current Prisma schema first.

We need persistent report state associated with an application.

If the current schema already contains an appropriate report model, reuse it.

If not, add the minimum necessary model.

For example, conceptually:

```text
Report
------
id
applicationId
status
filePath / fileUrl
error
createdAt
updatedAt
```

Use an enum or constrained status representation where appropriate:

```text
PENDING
DONE
FAILED
```

Ensure the relationship respects application ownership and existing cascade behavior.

Do not duplicate data unnecessarily.

Do not store the actual PDF binary inside PostgreSQL unless the existing architecture specifically requires that.

---

# API

Implement:

## POST `/applications/:id/report`

Requirements:

* Requires authentication.
* Verify the application belongs to the authenticated user.
* Verify that the application has the data required to generate the report.
* Create/update a pending report record.
* Enqueue the background job.
* Return HTTP `202`.
* Do not wait for PDF generation to finish.

Example conceptual response:

```json
{
  "status": "pending",
  "reportId": "..."
}
```

Do not expose internal implementation details.

If a report is already pending, avoid creating duplicate jobs unnecessarily.

If a completed report already exists, decide on a sensible idempotent behavior rather than blindly generating duplicate PDFs.

---

# GET `/applications/:id/report`

Requirements:

* Requires authentication.
* Verify application ownership.
* Return:

### Pending

```json
{
  "status": "pending"
}
```

### Done

```json
{
  "status": "done",
  "reportId": "...",
  "url": "..."
}
```

### Failed

```json
{
  "status": "failed",
  "error": "..."
}
```

Do not expose stack traces, filesystem internals, API keys, or other sensitive information.

---

# PDF Content

The PDF should represent the tailored job application information.

At minimum include useful information such as:

* Candidate/application context
* Company
* Role
* Job URL if available
* Tailored resume information
* Tailored bullets/content generated by the LLM
* Any other structured information already available in `TailoredResume`

Do not invent information that is not present in the database.

Create a clean printable HTML document before converting it to PDF.

The output should look like an actual report/resume document rather than raw JSON.

---

# File Storage

For the MVP, local filesystem storage is acceptable if that matches the existing project architecture.

For example:

```text
backend/reports/
```

Make sure generated files are not accidentally committed to Git.

Add the appropriate directory to `.gitignore` if necessary.

Do not expose arbitrary filesystem paths to clients.

If using local storage, expose the PDF through a controlled authenticated endpoint or another safe mechanism.

Do not return a raw absolute Windows filesystem path.

---

# Background Job Behavior

The job must:

1. Receive the report/application identifier.
2. Load the necessary database records.
3. Verify the application/report still exists.
4. Generate the HTML.
5. Launch/use Playwright.
6. Generate the PDF.
7. Store the PDF.
8. Mark the report `DONE`.

If anything fails:

1. Catch the error.
2. Log useful server-side diagnostic information.
3. Mark the report `FAILED`.
4. Store a safe user-facing error message.

Avoid leaving reports permanently stuck in `PENDING`.

---

# Concurrency / Duplicate Jobs

Think carefully about race conditions.

Multiple requests for the same application should not unnecessarily generate multiple reports simultaneously.

Use the database state to prevent duplicate pending work where practical.

Do not use a fragile polling loop or `setInterval` implementation.

The background job should have a clear lifecycle.

---

# Tests

This is important.

Add focused tests for the new behavior.

At minimum cover:

### API

* Unauthenticated user cannot request a report.
* User cannot request a report for another user's application.
* Valid request returns `202`.
* Report starts in `PENDING`.
* GET report returns `pending`.
* GET report returns `done` after successful generation.
* GET report returns `failed` after job failure.
* User cannot access another user's report.

### Background job

Test the job logic independently where practical.

Mock Playwright/browser operations rather than requiring a real browser in every unit test.

Verify:

* Successful generation creates/stores the PDF and marks the report `DONE`.
* Generation failure marks the report `FAILED`.
* Failure does not leave the report stuck in `PENDING`.

### Regression

Run the entire existing backend test suite.

Do not weaken or delete existing tests.

---

# Verification

After implementation:

1. Run the existing tests.
2. Run the new tests.
3. Run Prisma validation/generation if schema changed.
4. Verify migrations.
5. Start the backend.
6. Perform a real manual API smoke test if possible:

   * login
   * create/use an application
   * ensure it has a TailoredResume
   * POST `/applications/:id/report`
   * confirm `202`
   * GET `/applications/:id/report`
   * confirm transition from `pending` to `done`
   * verify the resulting PDF opens correctly.

If Playwright/browser installation requires a separate setup step, document the exact command.

---

# Git Safety

Do not commit generated PDFs.

Do not commit:

* `.env`
* API keys
* database credentials
* generated report files
* `node_modules`

Preserve the existing `.gitignore`.

Do not create a second Git repository.

---

# Scope Restrictions

For this task:

DO:

* Async PDF report generation
* Background job
* Report persistence/status
* PDF generation
* Required API endpoints
* Required tests
* Minimal schema changes if necessary

DO NOT:

* Redesign the frontend
* Add Tailwind
* Add Edit/Delete UI
* Rewrite authentication
* Rewrite the OpenAI integration
* Add unrelated features
* Refactor large portions of the existing codebase
* Introduce unnecessary infrastructure

---

# Final Report

When finished, provide:

1. Exact files changed.
2. Database/schema changes.
3. Background-job architecture chosen and why.
4. PDF generation approach.
5. API endpoints added.
6. Tests added.
7. Exact test commands and results.
8. Manual smoke-test result.
9. Any setup commands required.
10. Any remaining limitations.

Most importantly, keep the implementation aligned with the existing capstone architecture instead of creating a new application inside the application.
