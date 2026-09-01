# Job Hunt Command Center

FlyRank Internship · Backend Track Capstone — Your 10x Solution

## Status: Feature 4 — async PDF report generation (background job) — NOT YET VERIFIED end-to-end

`POST /applications/:id/report` — reserves a report, enqueues a background job via Inngest, returns `202` immediately. A background function loads the application and its latest valid tailored resume, builds a printable HTML document, renders it to PDF with Playwright, and stores the file. `GET /applications/:id/report` reports `pending`/`done` (with a link)/`failed` (with a safe message). Covers the two remaining required concepts (background jobs + PDF reporting) in one feature, same as planned.

```
POST /applications/:id/report   (Authorization: Bearer <token>)
  no tailored resume yet   -> 400 no_tailored_resume, no job enqueued
  owned by someone else    -> 404
  valid                     -> 202 {status: "pending", reportId}
  already pending           -> 202, same reportId, no second job enqueued
  already done               -> 200 {status: "done", reportId, url} (idempotent, no re-render)
  previously failed          -> 202, retried (a past failure never permanently blocks a retry)

GET /applications/:id/report          -> {status: "pending"} | {status: "done", reportId, url} | {status: "failed", error}
GET /applications/:id/report/file      -> the PDF, only once done, only to the owner, never a raw filesystem path
```

**This feature has NOT been fully verified end-to-end.** See "Verification status" below before relying on it — the route/job logic is confirmed correct against a real database using stand-ins, but the real Prisma migration and a real Chromium-rendered PDF remain unverified in this build environment.

M1–M4 (walking skeleton, auth, user-scoped applications, OpenAI resume tailoring) are unchanged underneath. No dashboard polish yet.

## Verification status (read before treating this as done)

**Verified for real, in the sandbox this was built in:**
- The pure HTML report builder (`buildApplicationReportHtml`) — content, escaping, no invented data — 4/4 tests, actually run.
- The background-job logic (`runReportGeneration`) against a real Postgres database — pending→done transition, idempotency, missing-tailoring guard, render-failure handling — using a stub renderer (not real Chromium).
- The full HTTP route logic (ownership checks, validation-before-enqueue, idempotency, cross-user isolation) against a real Postgres database, through the real, unmodified `app.js`, using a **real local Inngest dev server** (genuine async dispatch and execution — not a stubbed `send()`) with only the Playwright renderer stubbed. Watched a real `pending → done` transition happen through real Inngest execution, fetched a real file through the real authenticated endpoint, confirmed real cross-user `404`s and real idempotent re-requests.
- `node --check` clean on every file; `npm test`'s pure/stub-based suites all pass.

**Requires verification on a real machine with real Prisma and Chromium (this build environment can do neither):**
- `npx prisma migrate dev` actually applying the new `Report` model/`ReportStatus` enum to a real database.
- A real Chromium-rendered PDF — page layout, whether it actually opens, whether the CSS in `report.js` behaves as intended under real Playwright.
- `npm test`'s Prisma-backed suites (`applications.test.js`, most of `report.test.js`) actually passing with a real generated Prisma Client.
- The full manual smoke test (login → tailor → request report → poll to done → open the real PDF) with the real stack end-to-end.

**Blocked in this environment specifically:**
- Prisma's CLI (`binaries.prisma.sh` unreachable — confirmed again this session).
- Chromium installation (`npx playwright install chromium` — confirmed blocked again this session, same "Download failure" as every prior milestone).

## Structure

```
backend/    Express API + Prisma/PostgreSQL + JWT auth + OpenAI-backed tailoring (Responses API)
frontend/   React SPA (Vite) — login/signup, then the M2 applications page
```

## Running it locally

```bash
# 1. Postgres
createdb jobhunt_db
cd backend
cp .env.example .env   # edit DATABASE_URL, JWT_SECRET, and OPENAI_API_KEY

# 2. Backend
npm install
npx prisma generate
npx prisma migrate dev --name add_report   # adds the new Report model/ReportStatus enum
npx playwright install chromium             # needed for real PDF rendering
npm run inngest:dev                          # real Inngest dev server, in its own terminal
npm start                                     # listens on :3001

# 3. Frontend, in a second terminal
cd ../frontend
npm install
npm run dev              # listens on :5173, talks to :3001
```

`OPENAI_API_KEY` needs a real key from your OpenAI account to actually call the model. Unlike Prisma's client and the auth secrets, the official `openai` SDK throws immediately if a key isn't present when it's constructed — so this app constructs it lazily, only inside the `/tailor` route, the first time that route runs without an injected client. Every other route (signup, login, applications CRUD) works fine with no `OPENAI_API_KEY` set at all.

## Tests

```bash
cd backend
npm test
```

`test/validation.test.js`, `test/auth.test.js`, and `test/llm.test.js` are pure (no database, no real API key — the LLM tests use a stub OpenAI client shaped like the real Responses API: `responses.create` returning `{ usage: { input_tokens, output_tokens }, output_text }`) and run anywhere. `test/applications.test.js` needs a real `jobhunt_test` database — run `npx prisma migrate dev` against it first.

## Model and pricing choice

`gpt-5.6-luna`, verified against OpenAI's own sources at the time this was built (not assumed, not taken from a third-party aggregator):
- **Model fit**: OpenAI's own "Model guidance" doc places Luna as the tier for "efficient, high-volume workloads," versus Terra (balanced) and Sol (flagship). Tailoring a short bullet list to a job description is exactly that kind of narrow, repeatable task.
- **Pricing**: $0.20 per 1M input tokens, $1.20 per 1M output tokens — confirmed directly from OpenAI's own pricing announcement (`openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6`, the July 30, 2026 price cut), not a third-party price tracker. Re-check `https://openai.com/api/pricing` before relying on this long-term — Luna's own rate changed 80% in a single announcement earlier in 2026, so OpenAI revises these periodically.

## Known limitations (as of this review)

1. **The live OpenAI API call has not yet been confirmed with a real key in this conversation.** Every test and every sandbox check so far has used a stub client. This capstone's own convention (per M2–M4) is not to consider a milestone fully done until a real call has actually succeeded.
2. **`backend/prisma/migrations/` is not included in this archive** — never generated in this build environment (Prisma's CLI can't reach `binaries.prisma.sh` here). See "Verification status" above for exactly what that means for Feature 4 specifically. The real migration history only exists on the machine where `prisma migrate dev` is actually run. Before committing, copy that local `backend/prisma/migrations/` folder into the repo — it is not covered by `.gitignore` and should be committed alongside the schema.
