/** Command line: apply migrations (npm run db:migrate). The server also does this on start. */
import { runMigrations } from "./setup.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
await runMigrations(url);
console.log("Migrations applied.");
