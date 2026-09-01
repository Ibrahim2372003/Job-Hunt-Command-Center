import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
/**
 * Factory instead of a bare module-level singleton so tests can point
 * this at a separate database (jobhunt_test) instead of the real dev
 * database — same dependency-injection reasoning as openDb() in the
 * pdf-report-generator project, adapted for Prisma.
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
}
