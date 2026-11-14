/** Command line: add the starter data to a brand-new album (npm run db:seed). Safe to repeat. */
import { createDb } from "./client.js";
import { seed } from "./setup.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool } = createDb(url);
try {
  await seed(db);
  console.log("Seed data inserted (existing rows left unchanged).");
} finally {
  await pool.end();
}
