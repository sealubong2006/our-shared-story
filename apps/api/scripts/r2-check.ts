/**
 * Verifies the Cloudflare R2 settings in .env without printing any secrets:
 * connects, writes a tiny test object, reads it back, then deletes it.
 *
 *   npm run r2:check
 */
import { loadConfig } from "../src/config.js";
import { createStorage } from "../src/lib/storage.js";

const storage = createStorage(loadConfig());
if (!storage) {
  console.error("R2 is not configured. Fill in R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in .env.");
  process.exit(1);
}

const key = `healthcheck/${Date.now()}.txt`;
try {
  await storage.check();
  console.log("✓ Connected to the bucket");
  await storage.putObject(key, Buffer.from("ok"), "text/plain");
  console.log("✓ Upload works");
  const body = await storage.getObject(key);
  if (body.toString() !== "ok") throw new Error("Read-back content did not match");
  console.log("✓ Download works");
  await storage.deleteObject(key);
  console.log("✓ Delete works\n\nR2 is set up correctly.");
} catch (err) {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  console.error(`\n✗ R2 check failed: ${e.name ?? "Error"} (${e.$metadata?.httpStatusCode ?? "no status"}) ${e.message ?? ""}`);
  console.error("Check the account ID, bucket name, and that the API token has Object Read & Write on this bucket.");
  process.exit(1);
}
