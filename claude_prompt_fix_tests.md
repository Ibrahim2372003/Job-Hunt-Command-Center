# Usage Metering & Billing Engine — Full Implementation Task

You are the lead backend engineer responsible for building a production-quality capstone project called:

**Usage Metering & Billing Engine**

This is a FlyRank Internship Backend Track Capstone.

Your job is NOT to blindly generate code. You must first inspect the current repository, understand its structure, identify what already exists, and then implement the system incrementally with strong correctness, security, testing, and documentation.

The final result should be both:

1. **100% compliant with the mandatory capstone requirements**
2. A polished, demo-ready SaaS-style product that is strong enough to showcase in a backend portfolio.

---

# 1. PRIMARY OBJECTIVE

Build a multi-tenant backend service that:

* tracks customer usage
* calculates usage costs
* enforces subscription quotas
* supports Free and Pro plans
* integrates with Stripe Test Mode
* handles Stripe webhooks securely
* prevents duplicate usage through idempotency
* isolates all tenant data
* exposes a dummy billable API endpoint
* provides a polished dashboard for usage, billing, API keys, and account information

The core billing/metering contract has absolute priority over optional features.

DO NOT sacrifice correctness of the core requirements to add UI or stretch features.

---

# 2. MANDATORY TECHNOLOGY STACK

Use only the required/free technologies unless there is a strong technical reason otherwise:

* Node.js
* Express
* PostgreSQL
* Prisma ORM
* Docker / Docker Compose
* Stripe Test Mode
* Stripe CLI
* React + Vite for the dashboard
* JWT authentication
* Standard REST APIs

Keep the architecture simple and maintainable.

Do NOT introduce unnecessary infrastructure such as Redis, RabbitMQ, Kubernetes, microservices, etc.

This is a capstone, not an enterprise distributed system.

---

# 3. IMPORTANT WORKING RULE

Before changing anything:

## STEP 1 — AUDIT THE REPOSITORY

Inspect:

* directory structure
* package.json files
* existing source code
* database configuration
* Prisma schema/migrations
* existing tests
* environment files
* Docker configuration
* README
* existing frontend
* existing API routes
* existing authentication
* existing Stripe code

Determine what is already implemented and what is missing.

Do NOT overwrite working code unnecessarily.

Prefer minimal, maintainable, additive changes.

At the beginning, provide a short implementation plan based on the actual repository.

Then implement it.

---

# 4. CORE DATA MODEL

The database must support strict multi-tenant isolation.

At minimum implement:

## User

* id
* email
* passwordHash
* tenantId
* createdAt
* updatedAt

## Tenant

* id
* name
* createdAt
* updatedAt

## Plan

* id
* name
* monthlyApiCallLimit
* monthlyAiTokenLimit
* priceCents
* Stripe-related identifiers where appropriate
* createdAt
* updatedAt

Plans:

### FREE

Example limits:

* 10,000 API calls/month
* 1,000,000 AI tokens/month
* $0/month

### PRO

Example limits:

* 100,000 API calls/month
* 10,000,000 AI tokens/month
* configurable Stripe test price

Do not hard-code business logic throughout the application. Plans and pricing should come from the database/configuration.

## Subscription

Must represent the tenant's current subscription.

Include appropriate fields such as:

* id
* tenantId
* planId
* status
* stripeCustomerId
* stripeSubscriptionId
* currentPeriodStart
* currentPeriodEnd
* createdAt
* updatedAt

Stripe should be treated as the source of truth for payment state.

## UsageEvent

Must include enough information to audit every billable action.

Suggested fields:

* id
* tenantId
* type
* quantity
* idempotencyKey
* inputTokens
* cachedInputTokens
* outputTokens
* reasoningTokens
* costMicros
* metadata
* createdAt

The idempotency key must be uniquely constrained appropriately so database-level uniqueness protects against duplicate billing.

## WebhookEvent

Used to deduplicate Stripe webhook events.

Suggested:

* id
* stripeEventId UNIQUE
* eventType
* processedAt
* payload/metadata if appropriate
* createdAt

## ApiKey

For API consumers.

Suggested:

* id
* tenantId
* name
* keyHash
* keyPrefix
* revokedAt
* createdAt
* lastUsedAt

NEVER store the raw API key in the database.

---

# 5. FINANCIAL PRECISION

This is mandatory.

NEVER use floating point numbers for financial values.

Examples:

GOOD:

```text
priceCents = 2900
costMicros = 1250
```

BAD:

```text
price = 29.00
cost = 0.00125
```

All financial calculations must use integers.

The pricing implementation must be deterministic and testable.

---

# 6. IDEMPOTENT METERING

This is one of the most important requirements.

Every billable action must accept:

```http
Idempotency-Key: <unique-key>
```

Example:

```http
POST /generate
Authorization: Bearer <API_KEY>
Idempotency-Key: abc123
```

If the client retries the exact same billable request with the same idempotency key:

* DO NOT create another UsageEvent
* DO NOT charge the tenant again
* DO NOT increment usage again
* return the original result/response where appropriate

The database must protect against races.

Do not implement idempotency only with:

```js
if (existing) ...
```

because concurrent requests can bypass that check.

Use appropriate database constraints/transactions/locking.

Add tests for:

* first request
* retry
* duplicate key
* different keys
* concurrent requests
* cross-tenant keys

---

# 7. QUOTA ENFORCEMENT

Before allowing a billable action:

1. Authenticate the caller
2. Identify the tenant
3. Identify the tenant's plan
4. Calculate current-period usage
5. Calculate requested usage
6. Check whether the action would exceed the quota
7. Reject if necessary
8. Otherwise perform the action and record usage atomically where appropriate

Use:

```http
429 Too Many Requests
```

or:

```http
402 Payment Required
```

with a clear JSON error message.

Example:

```json
{
  "error": "Monthly API call quota exceeded",
  "code": "QUOTA_EXCEEDED"
}
```

Do not allow concurrent requests to bypass quotas.

Test boundary cases carefully.

---

# 8. USAGE TYPES

Keep the scope intentionally small.

Only support:

## API_CALL

One billable API request.

## AI_TOKENS

AI token consumption.

Do NOT create unnecessary usage categories.

---

# 9. AI TOKEN PRICING

Implement a dedicated pricing/calculation module.

It must correctly handle:

* normal input tokens
* cached input tokens
* output tokens
* reasoning tokens

Important:

Cached input tokens have a cheaper price.

Reasoning tokens are billed as output tokens.

Do NOT simply add all token categories together.

The calculation must distinguish the categories and apply the correct price to each category.

Use integer micro-units/cents.

Create unit tests covering:

* normal input only
* cached input only
* output only
* reasoning only
* mixed usage
* zero tokens
* large values
* rounding behavior
* integer precision

Pricing rates should be centralized/configurable.

Do not scatter pricing constants throughout controllers.

---

# 10. BILLABLE ENDPOINT

Implement:

```http
POST /generate
```

This is a dummy billable endpoint.

It does NOT need a real AI provider.

It should simulate generation and return something like:

```json
{
  "result": "Generated response",
  "usage": {
    "apiCalls": 1,
    "inputTokens": 100,
    "cachedInputTokens": 20,
    "outputTokens": 80,
    "reasoningTokens": 30,
    "costMicros": 1234
  }
}
```

The endpoint must:

* authenticate via API key
* resolve tenant
* check quota
* require Idempotency-Key
* calculate usage
* calculate cost
* create exactly one UsageEvent
* return the result

---

# 11. AUTHENTICATION

Implement two authentication modes where appropriate.

## Dashboard authentication

JWT:

```http
Authorization: Bearer <JWT>
```

Used by the React dashboard.

## API authentication

API key:

```http
Authorization: Bearer mf_live_xxxxx
```

Used by `/generate` and other customer-facing API endpoints.

API keys must:

* be cryptographically random
* only show the full key once
* store only a secure hash
* support revocation
* belong to exactly one tenant
* never allow cross-tenant access

---

# 12. STRIPE CHECKOUT

Implement Stripe Test Mode.

Flow:

```text
Dashboard
   ↓
Upgrade to Pro
   ↓
Backend creates Stripe Checkout Session
   ↓
Stripe Checkout
   ↓
Successful payment
   ↓
Stripe webhook
   ↓
Signature verification
   ↓
Webhook deduplication
   ↓
Database subscription update
```

Do not trust the frontend to mark a user as Pro.

The backend/database subscription state must be updated from verified Stripe webhook events.

Implement the relevant subscription lifecycle events, such as:

* checkout completion
* subscription created
* subscription updated
* subscription deleted/canceled

Use environment variables for Stripe secrets and IDs.

NEVER commit Stripe secrets.

---

# 13. STRIPE WEBHOOK SECURITY

Webhook endpoint:

```http
POST /webhooks/stripe
```

Stripe signature verification is mandatory.

The raw request body must be preserved as required by Stripe signature verification.

Invalid signatures must return:

```http
400
```

Do not parse/modify the body before signature verification if that would break Stripe verification.

Webhook events must be deduplicated using a database uniqueness constraint on the Stripe event ID.

If the same event arrives twice:

* do not perform the business action twice
* do not create duplicate subscriptions/records
* return a successful response where appropriate

Add tests for:

* valid signature
* invalid signature
* missing signature
* duplicate event
* subscription activation
* subscription update
* subscription cancellation

---

# 14. STRICT TENANT ISOLATION

This is mandatory.

Tenant A must NEVER be able to access:

* Tenant B users
* Tenant B applications/data
* Tenant B usage
* Tenant B subscription
* Tenant B API keys
* Tenant B billing information

Every relevant query must be tenant-scoped.

Add integration tests proving:

```text
Tenant A cannot read Tenant B data
Tenant A cannot mutate Tenant B data
Tenant A cannot use Tenant B API keys
Tenant A cannot affect Tenant B quota
Tenant A cannot see Tenant B usage
```

Do not rely only on frontend restrictions.

Enforce isolation in backend/database access logic.

---

# 15. API DESIGN

Create clean REST endpoints.

At minimum consider:

## Authentication

```text
POST /auth/signup
POST /auth/login
GET  /auth/me
```

## Dashboard

```text
GET /usage
GET /usage/summary
GET /subscription
```

## API Keys

```text
GET    /api-keys
POST   /api-keys
DELETE /api-keys/:id
```

## Billing

```text
POST /billing/checkout
GET  /billing/subscription
POST /webhooks/stripe
```

## Metering

```text
POST /generate
```

Keep naming consistent.

Return predictable JSON responses.

Validate all user-controlled input.

---

# 16. DASHBOARD

Build a polished React/Vite dashboard.

The dashboard should look like a real SaaS product, not a raw admin page.

Required areas:

## Overview

Show:

* current plan
* API calls used
* API call quota
* AI tokens used
* AI token quota
* estimated/current usage cost
* subscription status
* billing period
* recent usage

Use progress indicators/cards.

## Usage

Show:

* API calls
* AI tokens
* cost
* usage history
* recent events

A simple chart is encouraged.

## Billing

Show:

* Free/Pro
* current subscription
* limits
* Stripe billing state
* Upgrade to Pro button

## API Keys

Show:

* key name
* prefix
* creation date
* last used
* revoked status
* create key
* revoke key

When creating a key, display the full key ONCE with a clear warning that it cannot be retrieved later.

## API Documentation

Add a simple developer documentation page explaining:

```text
POST /generate
Authorization
Idempotency-Key
Request body
Response
Quota behavior
```

Include an example request/response.

---

# 17. UI QUALITY

The dashboard must be:

* responsive
* clean
* modern
* accessible
* mobile-friendly
* consistent
* readable

Handle:

* loading states
* empty states
* errors
* success states
* unauthorized state
* expired JWT
* revoked API key
* quota exceeded
* Stripe checkout errors

Do not introduce a huge UI dependency unless necessary.

---

# 18. SECURITY

Apply reasonable production-style security:

* password hashing
* JWT validation
* secure API key generation
* API key hashing
* input validation
* tenant authorization
* Helmet
* sensible CORS
* rate limiting where appropriate
* no secrets in source control
* no secrets in frontend environment variables
* no sensitive data in logs

Never log:

* passwords
* JWTs
* raw API keys
* Stripe secret keys

---

# 19. DATABASE DESIGN

Use Prisma migrations.

The final repository MUST contain the migration files necessary to recreate the database from scratch.

Verify:

```bash
npx prisma migrate deploy
```

works on a clean database.

Do not rely on an already-existing local database.

Seed the two plans if appropriate.

A fresh developer should be able to clone the repository and initialize the system.

---

# 20. DOCKER

Provide a simple Docker Compose setup for PostgreSQL and any necessary services.

The project should be easy to start locally.

Example:

```bash
docker compose up -d
```

Then:

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Document exact commands based on the actual implementation.

Do not document commands that do not work.

---

# 21. TESTING

Testing is mandatory.

Create a strong automated test suite.

Test at minimum:

### Authentication

* signup
* login
* invalid credentials
* protected routes

### Tenant isolation

* cross-tenant read
* cross-tenant mutation
* cross-tenant API key usage

### Idempotency

* first request
* retry
* duplicate key
* concurrent requests

### Quotas

* within limit
* exact limit
* over limit
* concurrent requests
* Free plan
* Pro plan

### Pricing

* all token categories
* cached tokens
* reasoning tokens
* mixed usage
* integer precision

### API Keys

* creation
* hashing
* authentication
* revocation
* invalid key

### Stripe

* valid webhook
* invalid signature
* duplicate webhook
* subscription creation/update/deletion

### Generate

* successful billable request
* usage event created
* cost calculated
* idempotent retry
* quota enforcement

Run the full suite before declaring completion.

---

# 22. CAPSTONE DELIVERABLES

The repository root MUST contain:

```text
README.md
capstone.yaml
.env.example
BUILDLOG.md
EVIDENCE.md
```

## README.md

Include:

* project overview
* architecture diagram
* tech stack
* database model
* API overview
* local setup
* Docker setup
* Prisma migration setup
* Stripe Test Mode setup
* Stripe CLI webhook setup
* environment variables
* how to run backend
* how to run frontend
* how to run tests
* example `/generate` request
* idempotency explanation
* quota explanation
* pricing explanation
* webhook explanation
* security/tenant isolation explanation

The architecture diagram can be Mermaid if appropriate.

## capstone.yaml

Create a clear evaluator manifest mapping the mandatory requirements to the relevant implementation/test evidence.

## BUILDLOG.md

Document AI assistance transparently.

Include:

* what AI tools were used
* what they helped with
* important implementation decisions
* debugging
* testing
* human verification

Do not falsely claim that AI did things that were not actually done.

## EVIDENCE.md

This is extremely important.

Create a requirement-by-requirement verification document.

For every mandatory requirement include:

```text
Requirement
Implementation
Relevant files
Relevant API/test
How to verify
Expected result
```

For example:

```text
Idempotent Metering
Implementation:
UsageEvent.idempotencyKey has a unique database constraint.

Verification:
POST /generate with the same Idempotency-Key twice.

Expected:
Exactly one UsageEvent exists.
The second request does not double-count usage.
```

---

# 23. CAPSTONE CONTRACT FIRST

Before adding optional features, create a checklist:

```text
[ ] PostgreSQL
[ ] Docker
[ ] Tenant model
[ ] Plan model
[ ] Subscription model
[ ] UsageEvent model
[ ] API calls metering
[ ] AI token metering
[ ] Idempotency
[ ] Database-level idempotency protection
[ ] Quota enforcement
[ ] 429/402 behavior
[ ] Integer financial values
[ ] Cached input pricing
[ ] Reasoning token pricing
[ ] Stripe Checkout
[ ] Stripe webhooks
[ ] Webhook signature verification
[ ] Webhook deduplication
[ ] Tenant isolation
[ ] /generate
[ ] README
[ ] capstone.yaml
[ ] BUILDLOG.md
[ ] EVIDENCE.md
[ ] Tests
```

Do not move to stretch features until every item above is implemented and verified.

---

# 24. OPTIONAL FEATURES — ONLY AFTER CORE IS COMPLETE

Once the mandatory contract is 100% complete, you MAY add:

* usage alerts
* invoices
* overage billing
* proration
* nightly reconciliation
* richer analytics
* billing history
* downloadable usage reports

Do not implement these if they introduce unnecessary risk.

Prioritize stability.

---

# 25. ENGINEERING PRINCIPLES

Follow these rules:

* Keep modules small and focused.
* Separate business logic from HTTP controllers.
* Keep pricing logic independently testable.
* Keep quota logic independently testable.
* Keep Stripe integration isolated.
* Keep webhook handling isolated.
* Use transactions where atomicity matters.
* Use database constraints to enforce invariants.
* Avoid duplicated logic.
* Avoid unnecessary abstractions.
* Avoid overengineering.
* Prefer explicit code over clever code.
* Never silently swallow errors.
* Return useful error messages.
* Preserve existing working functionality.

---

# 26. VERIFICATION REQUIREMENT

Before saying the project is complete, actually run:

```bash
npm test
```

and relevant build commands.

Also verify:

```bash
npx prisma validate
npx prisma migrate deploy
```

against a clean/test database where practical.

Verify frontend production build.

Perform a manual smoke test:

```text
Signup
↓
Login
↓
Dashboard
↓
Create API key
↓
Call /generate
↓
Usage increases
↓
Repeat same Idempotency-Key
↓
Usage does NOT increase twice
↓
View usage
↓
Upgrade to Pro through Stripe Test Mode
↓
Webhook received
↓
Subscription becomes Pro
```

If Stripe CLI is available, document and test the actual webhook flow.

---

# 27. FINAL AUDIT

At the end, do NOT simply say "done".

Produce a final engineering audit containing:

## Implementation Summary

What was implemented.

## Files Changed

List important files and what changed.

## Database

Explain models, constraints, and migrations.

## API

List important endpoints.

## Security

Explain authentication, API keys, tenant isolation, webhook verification, etc.

## Billing

Explain Stripe Checkout and webhook synchronization.

## Metering

Explain idempotency, quota enforcement, and usage tracking.

## Pricing

Explain token pricing and integer arithmetic.

## Tests

Give the actual test command and actual result.

Example:

```text
Tests: 87
Passed: 87
Failed: 0
```

Never fabricate test results.

## Manual Verification

List what was actually tested manually.

## Remaining Issues

Be honest.

If something could not be tested because Stripe credentials/CLI/database/etc. are unavailable, explicitly say so.

---

# 28. IMPORTANT: DO NOT FAKE SUCCESS

This is critical.

Never claim:

* tests pass if you didn't run them
* Stripe works if you didn't verify it
* webhooks are secure if signature verification wasn't tested
* migrations work if you didn't test them
* tenant isolation works if it wasn't tested

If something is blocked by environment limitations, report it clearly and provide the exact command/action needed to finish verification.

---

# 29. IMPLEMENTATION ORDER

Follow this order:

### Phase 1

Repository audit + architecture

### Phase 2

Database schema + migrations + seed

### Phase 3

Authentication + tenant isolation

### Phase 4

API key system

### Phase 5

Usage/metering engine

### Phase 6

Idempotency + quota enforcement

### Phase 7

Pricing engine

### Phase 8

`POST /generate`

### Phase 9

Stripe Checkout

### Phase 10

Stripe webhooks + signature verification + deduplication

### Phase 11

Automated tests

### Phase 12

React dashboard

### Phase 13

API documentation page

### Phase 14

README / capstone.yaml / BUILDLOG.md / EVIDENCE.md

### Phase 15

Full audit + final verification

---

# 30. START NOW

Start by inspecting the repository.

Do NOT immediately rewrite files.

First:

1. inspect the existing project
2. identify what already exists
3. identify missing requirements
4. provide a concise implementation plan
5. then begin implementation

Work directly in the repository.

Keep the implementation production-quality but appropriately scoped for a capstone.

The final goal is:

**A fully functional, secure, tested, multi-tenant Usage Metering & Billing SaaS with Stripe Test Mode, not merely a collection of demo endpoints.**
