const VALID_STATUSES = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED"];

/**
 * Validates a POST /applications body. Pure function, no Express or
 * Prisma involved — same "keep the testable part testable without a
 * server or a database" reasoning as renderReport.js's split in the
 * PDF project.
 *
 * Returns { valid: true, data } with a clean, trimmed payload ready
 * for Prisma, or { valid: false, errors } with human-readable
 * messages the route can hand straight back as a 400.
 */
export function validateApplicationInput(body) {
  const errors = [];

  const company = typeof body?.company === "string" ? body.company.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim() : "";
  const jobDescription = typeof body?.jobDescription === "string" ? body.jobDescription.trim() : "";
  const jobUrl = typeof body?.jobUrl === "string" && body.jobUrl.trim() ? body.jobUrl.trim() : null;
  const status = body?.status;

  if (!company) errors.push("company is required");
  if (!role) errors.push("role is required");
  if (!jobDescription) errors.push("jobDescription is required");
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    errors.push(`status must be one of ${VALID_STATUSES.join(", ")}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      company,
      role,
      jobDescription,
      jobUrl,
      ...(status ? { status } : {}),
    },
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Same pure, framework-free shape as validateApplicationInput —
 * shared by both /auth/signup and /auth/login since the input shape
 * (email + password) is the same; login additionally doesn't care
 * about password strength, only that something was sent.
 */
export function validateSignupInput(body) {
  const errors = [];

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email) errors.push("email is required");
  else if (!EMAIL_PATTERN.test(email)) errors.push("email must be a valid email address");

  if (!password) errors.push("password is required");
  else if (password.length < MIN_PASSWORD_LENGTH) errors.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: { email, password } };
}

export function validateLoginInput(body) {
  const errors = [];

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email) errors.push("email is required");
  if (!password) errors.push("password is required");

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: { email, password } };
}

const MAX_BULLETS_IN = 20;
const MAX_BULLET_LENGTH = 500;

/**
 * Validates the input to POST /applications/:id/tailor, before any
 * OpenAI API call is made — the "with validation" half of the LLM
 * concept's own definition, not just the cost log.
 */
export function validateTailorInput(body) {
  const errors = [];
  const baseBullets = body?.baseBullets;

  if (!Array.isArray(baseBullets)) {
    return { valid: false, errors: ["baseBullets is required and must be an array of strings"] };
  }
  if (baseBullets.length === 0) {
    errors.push("baseBullets must contain at least one bullet");
  }
  if (baseBullets.length > MAX_BULLETS_IN) {
    errors.push(`baseBullets must contain at most ${MAX_BULLETS_IN} bullets`);
  }

  const trimmed = baseBullets.map((b) => (typeof b === "string" ? b.trim() : null));
  if (trimmed.some((b) => b === null || b.length === 0)) {
    errors.push("every bullet must be a non-empty string");
  }
  if (trimmed.some((b) => b && b.length > MAX_BULLET_LENGTH)) {
    errors.push(`every bullet must be at most ${MAX_BULLET_LENGTH} characters`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: { baseBullets: trimmed } };
}
