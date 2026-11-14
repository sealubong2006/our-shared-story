import path from "node:path";

/** Loads ../../.env and points the app at the *test* database. */
export function applyTestEnv() {
  if (process.env.FAMILY_ALBUM_TEST_ENV === "1") return;
  if (!process.env.TEST_DATABASE_URL) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
    } catch {
      // No .env file: rely on variables already set (e.g. in CI).
    }
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run the tests");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = "test";
  process.env.ACCESS_RATE_LIMIT = "1000";
  process.env.FAMILY_ALBUM_TEST_ENV = "1";
}

applyTestEnv();
