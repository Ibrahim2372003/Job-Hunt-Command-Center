import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (this file lives directly in src/, one level down). */
export const PROJECT_ROOT = path.join(__dirname, "..");

/**
 * Where generated PDFs live and get served from. Reuses the same
 * naming/placement convention as the pdf-report-generator project's
 * REPORTS_DIR — a plain on-disk directory, never exposed as a raw
 * path to clients, only ever reached through the authenticated
 * GET /applications/:id/report/file route.
 */
export const REPORTS_DIR = path.join(PROJECT_ROOT, "reports");
