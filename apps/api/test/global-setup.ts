import pg from "pg";
import { applyTestEnv } from "./env.js";
import { runMigrations } from "../src/db/migrate.js";

/** Wipes the test database and applies all migrations once per test run. */
export default async function setup() {
  applyTestEnv();
  const url = process.env.DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
