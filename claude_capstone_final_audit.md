# M5 — Frontend UI/UX Polish + Full Frontend/Backend Alignment

We now need to improve the frontend UI/UX of the Job Hunt Command Center and make sure the frontend and backend are fully aligned.

The current backend/M4 implementation is already in place, the database has 4 applied Prisma migrations, authentication is working, LLM integration is working, async PDF report generation is implemented, and the existing backend tests are passing.

**Do not rewrite or regress the existing authentication, application APIs, Prisma schema, LLM integration, report/background-job implementation, or existing tests.**

This milestone is primarily a frontend/UI/UX milestone, plus the minimum backend changes required to support Edit/Delete if those endpoints are genuinely missing.

---

# 0. REQUIRED FIRST STEP — Frontend/Backend Contract Audit

Before changing any code, inspect the current implementation.

Inspect:

* `frontend/src/api.js`
* `frontend/src/App.jsx`
* `frontend/src/main.jsx`
* all relevant files under `backend/src`
* especially application routes in `backend/src/app.js`
* authentication middleware/helpers
* Prisma schema
* existing backend tests
* existing frontend tests, if any

Determine and document internally:

1. What API endpoints currently exist for:

   * signup
   * login
   * logout/client-side auth
   * list applications
   * create application
   * get application
   * update application
   * delete application
   * tailor application
   * request report
   * report status/file

2. What HTTP methods, paths, request bodies, response shapes, and status codes are currently used.

3. How JWT authentication is currently sent from the frontend.

4. How backend ownership checks currently work.

5. Whether Update and Delete endpoints already exist.

6. Whether the frontend is currently making any assumptions that differ from the actual backend contract.

**Do not invent a new API contract if an existing contract already exists.**

If Update/Delete endpoints already exist, reuse them exactly.

If either endpoint is missing, add only the minimum required backend route while preserving the existing authentication and ownership model.

Do not modify Prisma migrations unless there is a real database capability missing.

---

# 1. Modern UI/UX Styling

Transform the current raw HTML/wireframe appearance into a clean, modern, responsive productivity dashboard.

You may use Tailwind CSS if it can be integrated safely into the existing Vite setup. Otherwise use a well-structured CSS file.

Do not introduce unnecessary dependencies.

Requirements:

* Center the main application content with a reasonable max width.
* Create consistent horizontal and vertical spacing.
* Establish clear visual hierarchy.
* Use a consistent typography system.
* Style the header/navigation area.
* Make the application form a proper card.
* Make each application a visually distinct card.
* Use appropriate borders, radius, spacing, shadows/subtle elevation, and hover states.
* Use responsive layout behavior.
* Work properly on desktop and mobile widths.
* Keep the visual language professional and appropriate for a job-search/productivity application.
* Do not turn it into a marketing landing page.
* Avoid excessive animations or unnecessary visual effects.

The final result should feel like a real MVP dashboard.

---

# 2. Frontend/Backend Data Contract Must Stay Consistent

The frontend must consume the actual backend response shapes.

Do not silently transform or rename backend fields unless there is already an established frontend adapter.

For applications, preserve the existing backend fields such as:

* `id`
* `company`
* `role`
* `jobUrl`
* `jobDescription`
* `status`
* `createdAt`
* `updatedAt`

If the backend returns additional fields, do not accidentally discard fields needed by existing functionality.

When adding/editing applications:

* Send exactly the fields expected by the backend.
* Respect existing backend validation.
* Handle backend validation errors gracefully.
* Do not duplicate backend validation rules unnecessarily in the frontend, but basic UX validation is fine.

---

# 3. Fix Long URL Overflow

There is currently a visual bug where intentionally malformed/very long URLs can overflow an application card.

The application card must remain intact even with extremely long strings.

Preferred UX:

Instead of displaying the complete raw URL, display something like:

`View job posting`

with the actual URL behind it.

Requirements:

* Link must remain clickable.
* Use a meaningful accessible label such as:
  `View job posting for [company]`
* Use safe handling for malformed/invalid URLs.
* Do not allow unbroken strings to expand the card.
* Use appropriate CSS such as:

  * `overflow-wrap: anywhere`
  * `word-break: break-word`

Do not introduce a layout regression for normal URLs.

---

# 4. Visual Status Badges

Replace plain status text with reusable visual status badges.

Support:

* `SAVED`
* `APPLIED`
* `INTERVIEW`
* `OFFER`
* `REJECTED`

Suggested semantics:

* SAVED → neutral/gray
* APPLIED → blue
* INTERVIEW → green/positive
* OFFER → positive/emphasis
* REJECTED → red

Requirements:

* Centralize status-to-style mapping.
* Do not duplicate status styling throughout the application.
* Badge text must remain readable.
* Badges must be accessible.
* Gracefully handle unexpected future status values using a neutral fallback.

---

# 5. Application Management — Edit

Add an Edit action to every application card.

Prefer reusing the existing Add Application form rather than creating a separate form.

Edit flow:

1. User clicks Edit.
2. Existing application values populate the form.
3. Form enters edit mode.
4. Primary action changes from:
   `Add application`
   to:
   `Save changes`
5. Show a visible `Cancel` action.
6. User can modify:

   * Company
   * Role
   * Job URL
   * Job description
   * Status
7. Submit to the existing backend update endpoint.
8. On success:

   * update the application in local state
   * exit edit mode
   * show appropriate success feedback if useful
9. On failure:

   * remain in edit mode
   * preserve entered values
   * show a useful user-facing error

Cancel must:

* exit edit mode
* restore/reset the form appropriately
* not make an API request

Do not lose user-entered values when an API request fails.

Prevent duplicate submissions while saving.

---

# 6. Application Management — Delete

Add a Delete action to every application card.

Delete flow:

1. User clicks Delete.
2. Ask for simple confirmation before permanently deleting.
3. Call the existing backend DELETE endpoint if available.
4. Do not invent a different API contract.
5. While deleting:

   * disable the delete action
   * prevent duplicate deletion requests
6. On success:

   * immediately remove the application from local UI state
7. On failure:

   * keep the application visible
   * show a useful user-facing error
   * do not pretend deletion succeeded

Security requirement:

The backend must enforce ownership.

A malicious user must NOT be able to delete another user's application simply by changing the application ID in a request.

Do not rely on frontend checks for security.

If the backend DELETE endpoint is missing, add the minimal authenticated route following the exact same ownership pattern already used by the existing application routes.

---

# 7. Backend Update Endpoint — Only If Missing

If the backend currently has no update endpoint, add the smallest possible implementation.

Expected behavior:

* authenticated request
* identify application by ID
* verify application belongs to `req.user.id`
* validate incoming fields using the existing validation approach
* update only allowed application fields
* return the updated application
* return an appropriate 404/403-style response according to the existing backend conventions

Do not change authentication architecture.

Do not change Prisma schema.

Do not change existing create/list behavior.

Add focused backend regression tests for:

* authenticated owner can update own application
* unauthenticated request is rejected
* user cannot update another user's application
* invalid update input is rejected

---

# 8. Backend Delete Endpoint — Only If Missing

If the backend currently has no delete endpoint, add the smallest possible implementation.

Expected behavior:

* authenticated request
* identify application by ID
* verify ownership using the authenticated user
* delete the application
* rely on existing Prisma relation behavior for dependent records
* return the appropriate success response
* return the appropriate error for missing/non-owned applications

Do not expose internal database errors.

Add focused backend regression tests for:

* authenticated owner can delete own application
* unauthenticated request is rejected
* user cannot delete another user's application
* deleted application no longer appears in the owner's list

Do not rewrite existing tests.

---

# 9. Improve Add Application Form

Transform the form into a polished accessible form card.

Fields remain:

* Company
* Role
* Job URL (optional)
* Job description
* Status

Requirements:

* clear visible labels
* consistent input styling
* proper spacing
* clear focus states
* keyboard accessible controls
* appropriate hover states
* disabled/loading state while submitting
* visible submission feedback
* accessible error messages

After successful creation:

* reset the form
* add the returned application from the backend to local state
* do not refetch unnecessarily unless the existing architecture requires it

After failed creation:

* preserve the user's entered values
* show a useful error
* do not reset the form

Use the backend's actual returned application object instead of fabricating an object on the frontend.

---

# 10. Loading / Error / Empty States

Implement proper asynchronous UX.

## Initial loading

While applications are being fetched:

* show a simple loading indicator or skeleton
* do not show fake/demo applications

## Add/Edit loading

While submitting:

* disable the primary submit button
* show visible feedback such as `Saving...`

## Delete loading

While deleting:

* disable the relevant delete button
* prevent duplicate clicks

## API errors

Show clear user-friendly messages.

Do NOT expose:

* Prisma stack traces
* SQL errors
* internal server details
* secrets
* implementation-specific debugging information

If the backend provides a safe error message, display it.

Otherwise provide a generic useful message.

## Empty state

If the authenticated user has no applications:

`No applications yet. Add your first application above.`

Do not use fake/demo applications as a fallback.

---

# 11. Authentication Must Remain Intact

Do not regress:

* signup
* login
* JWT handling
* authenticated requests
* logout
* user-specific/private application behavior
* backend authentication middleware
* ownership checks

The frontend must continue to send authentication exactly as the current backend expects.

Do not:

* hard-code JWTs
* hard-code credentials
* put API keys in frontend source
* expose `.env` secrets
* store OpenAI keys in the frontend

---

# 12. Existing M4 Functionality Must Not Regress

The current backend already contains the LLM and report/background-job functionality.

Do not modify or rewrite:

* LLM integration
* tailoring endpoint
* TailoredResume persistence
* report generation
* Inngest function
* report status flow
* PDF generation
* Prisma migrations
* existing authentication architecture

The frontend polish must not break these APIs.

If existing UI already has hooks/buttons related to tailoring or reports, preserve them.

Do not start a new PDF/background-job implementation in this milestone.

---

# 13. Responsive and Accessibility Requirements

The UI should be usable at:

* desktop width
* tablet width
* mobile width

Ensure:

* no horizontal page overflow
* cards shrink correctly
* long URLs cannot break layout
* form controls remain usable on small screens
* buttons remain accessible
* sufficient focus visibility
* semantic labels for inputs
* buttons have accessible names
* icon-only buttons must have `aria-label`
* status badges must not be the only way important information is conveyed

Do not sacrifice accessibility for visual styling.

---

# 14. Maintainable Component Structure

Do not over-engineer the project.

You may introduce small reusable components where they clearly improve maintainability, for example:

* `StatusBadge`
* `ApplicationCard`
* `ApplicationForm`
* `LoadingState`
* `EmptyState`
* `ErrorMessage`

But do not create unnecessary abstractions.

Centralize:

* API calls in `api.js`
* status badge mapping
* repeated UI patterns

Keep `App.jsx` readable.

---

# 15. Verification — MUST ACTUALLY TEST

After implementation, run the existing backend test suite.

Also run frontend tests if they exist.

At minimum verify manually:

### Authentication

* signup
* login
* logout
* authenticated application loading

### Application CRUD

* create application
* form resets after successful create
* form does not reset after failed create
* edit application
* cancel edit
* save edit
* delete application
* delete confirmation
* delete loading state
* UI updates after deletion
* empty state after deleting the final application

### Status

Verify:

* SAVED
* APPLIED
* INTERVIEW
* OFFER
* REJECTED
* unexpected status fallback

### URL

Test with:

* normal URL
* long URL
* intentionally malformed extremely long URL

The card/page must never horizontally overflow.

### Security

Verify using two authenticated users:

* User A sees only User A applications.
* User B sees only User B applications.
* User A cannot update User B's application by changing the ID.
* User A cannot delete User B's application by changing the ID.

Frontend hiding an application is NOT sufficient; verify the backend rejects unauthorized ownership operations.

### Existing M4 functionality

Verify that existing tailoring/report functionality has not been broken.

---

# 16. Test Requirements

Do not delete or weaken existing tests.

If backend changes are required, add focused regression tests.

If frontend testing infrastructure already exists, add focused tests for:

* status badge rendering
* long URL rendering
* edit mode
* cancel edit
* delete confirmation
* loading states
* error states

If there is no frontend test infrastructure, do not introduce a large testing framework solely for this milestone unless there is a clear existing project convention that supports it.

---

# 17. Final Audit Report

At the end, report exactly:

1. **Files changed**

   * file path
   * concise explanation of changes

2. **Backend changes**

   * State explicitly whether backend changes were required.
   * If yes, explain exactly which routes/tests were added.
   * Confirm existing auth/ownership behavior was preserved.

3. **Frontend changes**

   * styling
   * components
   * form behavior
   * edit/delete
   * loading/error/empty states
   * responsive behavior
   * accessibility improvements

4. **API contract**

   * summarize which existing endpoints were reused
   * identify any new endpoint added

5. **Tests executed**

   * exact commands
   * exact pass/fail results

6. **Manual verification**

   * CRUD
   * authentication
   * ownership
   * responsive behavior
   * long URL
   * M4 functionality

7. **Remaining issues / assumptions**

   * explicitly list anything not verified or any assumption made

Do not claim something was tested if it was not actually tested.

---

# IMPORTANT CONSTRAINTS

* Do not rewrite the architecture.
* Do not migrate frameworks.
* Do not replace React/Vite.
* Do not rewrite Prisma.
* Do not create new Prisma migrations unless absolutely required.
* Do not modify LLM implementation.
* Do not modify Inngest/report implementation.
* Do not weaken authentication or ownership checks.
* Do not invent API contracts when existing endpoints can be reused.
* Do not add unnecessary dependencies.
* Do not add fake/demo data.
* Do not put secrets into source code.
* Do not expose `.env` files.
* Keep this milestone focused on frontend polish + application management.
* Preserve all existing working behavior.
