import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_EXPIRY = "7d";
const BCRYPT_ROUNDS = 10;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Copy .env.example to .env and fill it in.");
  }
  return secret;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function signToken(userId) {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: JWT_EXPIRY });
}

/**
 * Returns the userId on a valid token, or null on any failure
 * (expired, malformed, wrong signature) — callers decide what a null
 * means (usually a 401), this function just doesn't throw for
 * ordinary "the token isn't good" cases.
 */
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, getSecret());
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Express middleware: reads `Authorization: Bearer <token>`, verifies
 * it, and attaches `req.userId`. Missing header, malformed header,
 * or an invalid/expired token are all the same outcome to the
 * caller — 401 — on purpose; distinguishing them in the response
 * would leak information about why a token failed for no real
 * benefit to a legitimate client.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "unauthorized", message: "Missing or malformed Authorization header." });
  }

  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid or expired token." });
  }

  req.userId = userId;
  next();
}
