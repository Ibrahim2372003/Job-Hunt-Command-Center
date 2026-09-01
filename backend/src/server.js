import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { createPrismaClient } from "./db.js";

// pathToFileURL(process.argv[1]).href, not a raw `file://${...}`
// string — the latter breaks this exact "am I the entrypoint?" check
// on Windows (backslash paths never equal import.meta.url's
// file:///-style URL), which is precisely the bug found and fixed in
// the pdf-report-generator project. Starting this one with the fix
// already in place instead of reintroducing it.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = createPrismaClient();
  const app = createApp({ prisma });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`job-hunt-command-center backend listening on :${port}`);
  });
}
