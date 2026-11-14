/**
 * Local development helper: creates the dev and test databases named in
 * DATABASE_URL / TEST_DATABASE_URL if they don't exist yet.
 * The database user needs the CREATEDB privilege.
 */
import pg from "pg";

async function ensureDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unexpected database name: ${name}`);

  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (rowCount) {
      console.log(`Database ${name} already exists.`);
    } else {
      await client.query(`create database "${name}"`);
      console.log(`Created database ${name}.`);
    }
  } finally {
    await client.end();
  }
}

for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
  const value = process.env[key];
  if (value) await ensureDatabase(value);
  else console.log(`${key} not set, skipping.`);
}
