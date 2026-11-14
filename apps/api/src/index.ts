import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { prepareDatabase } from "./db/setup.js";
import { createStorage } from "./lib/storage.js";
import { createApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { purgeDeletedPhotos } from "./services/purge.js";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const storage = createStorage(config);
if (!storage) console.warn("Cloudflare R2 is not configured — photo storage is unavailable.");

// Apply any new database changes (and fill in a brand-new album) before accepting visitors.
// Safe on every start; if it fails the server exits, so a broken deploy never goes live.
await prepareDatabase(db);
console.log("Database is up to date.");

const app = createApp({ db, config, storage });
const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
});

/** Daily-ish housekeeping: old sessions, and photos deleted more than 30 days ago. */
async function housekeeping() {
  try {
    await purgeExpiredSessions(db);
    if (storage) {
      const purged = await purgeDeletedPhotos(db, storage);
      if (purged) console.log(`Permanently removed ${purged} photo(s) deleted over 30 days ago.`);
    }
  } catch (err) {
    console.error("Housekeeping failed", err);
  }
}
const startup = setTimeout(housekeeping, 60_000);
const interval = setInterval(housekeeping, 6 * 60 * 60 * 1000);

function shutdown() {
  clearTimeout(startup);
  clearInterval(interval);
  server.close(() => void pool.end());
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
