import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "./client.js";
import { categories, people, settings } from "./schema.js";

/**
 * Database setup shared by the server (which runs it on every start), the command-line
 * scripts (migrate.ts / seed.ts) and the tests. Everything here is safe to run repeatedly.
 */

/** Resolved from the working directory (apps/api) so it works from src (tsx) and from dist. */
export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

/** Applies any migrations not yet applied. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrateDb(db);
  } finally {
    await pool.end();
  }
}

export const INITIAL_PEOPLE = [
  {
    name: "Family",
    slug: "family",
    isCollection: true,
    sortOrder: 0,
    description: "Photographs of the family together.",
  },
  // Generic placeholders: admins rename them to real names in Admin → People.
  { name: "Dad", slug: "dad", isCollection: false, sortOrder: 1 },
  { name: "Mum", slug: "mum", isCollection: false, sortOrder: 2 },
  { name: "Brother", slug: "brother", isCollection: false, sortOrder: 3 },
  { name: "Sister", slug: "sister", isCollection: false, sortOrder: 4 },
  { name: "Me", slug: "me", isCollection: false, sortOrder: 5 },
];

export const INITIAL_CATEGORIES = [
  "Family",
  "Travel",
  "Camping",
  "Birthdays",
  "Graduation",
  "Holidays",
  "Celebrations",
  "Everyday Memories",
].map((name, i) => ({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), sortOrder: i }));

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  albumTitle: "Our Shared Story",
  slideshowSeconds: 6,
};

/**
 * Fills in the starter people, categories and settings on a brand-new album. Runs on every
 * deploy, so it only adds people/categories when there are none at all — anything an admin
 * later deletes stays deleted — and never overwrites existing rows.
 */
export async function seed(db: Db): Promise<void> {
  const [anyPerson] = await db.select({ id: people.id }).from(people).limit(1);
  if (!anyPerson) await db.insert(people).values(INITIAL_PEOPLE).onConflictDoNothing({ target: people.slug });
  const [anyCategory] = await db.select({ id: categories.id }).from(categories).limit(1);
  if (!anyCategory) {
    await db.insert(categories).values(INITIAL_CATEGORIES).onConflictDoNothing({ target: categories.slug });
  }
  await db
    .insert(settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing({ target: settings.key });
}

/** Brings the database up to date and fills in a brand-new album. Run before serving visitors. */
export async function prepareDatabase(db: Db): Promise<void> {
  await migrateDb(db);
  await seed(db);
}
