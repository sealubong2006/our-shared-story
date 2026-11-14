import { gunzipSync, gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import type { BackupDto } from "@family-album/shared";
import type { Db } from "../db/client.js";
import type { ObjectStore } from "../lib/storage.js";

/**
 * Database backups. Railway's built-in backups need its Pro plan, so the server makes its own:
 * a gzipped JSON copy of every table, stored in R2 under backups/. Photos are not included;
 * they already live in R2.
 *
 * Restoring replaces the whole database in one transaction (all or nothing), and only into a
 * database at exactly the same schema version as the backup.
 */

export const BACKUP_PREFIX = "backups/";
/** How many backups to keep; older ones are deleted after each new backup. */
export const BACKUP_KEEP = 30;
/** A new automatic backup is made once the latest is at least this old. */
export const BACKUP_INTERVAL_MS = 23 * 60 * 60 * 1000;

const FORMAT = "our-shared-story-backup";
const VERSION = 1;

/** Short-lived security records: left out of backups, and emptied by a restore (everyone signs in again). */
const NOT_BACKED_UP = new Set(["access_sessions", "failed_attempts"]);

interface BackupFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  /** Applied migration hashes: a backup can only be restored into the same schema. */
  migrations: string[];
  tables: Record<string, unknown[]>;
}

export class BackupError extends Error {}

/** Tables in the public schema, parents before children (foreign keys), so inserts succeed. */
async function tablesInRestoreOrder(db: Db): Promise<string[]> {
  const tables = (await db.execute<{ name: string }>(
    sql`select tablename as name from pg_tables where schemaname = 'public' order by tablename`,
  )).rows.map((r) => r.name);
  const links = (await db.execute<{ child: string; parent: string }>(sql`
    select c.relname as child, p.relname as parent
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_class p on p.oid = k.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname = 'public'
  `)).rows;

  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of links) if (child !== parent) parents.get(child)?.add(parent);

  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...parents.get(t)!].every((p) => done.has(p)));
    if (ready.length === 0) throw new BackupError("The tables reference each other in a loop; can't order them.");
    for (const t of ready) {
      ordered.push(t);
      done.add(t);
    }
  }
  return ordered;
}

async function appliedMigrations(db: Db): Promise<string[]> {
  const result = await db.execute<{ hash: string }>(sql`select hash from drizzle.__drizzle_migrations order by id`);
  return result.rows.map((r) => r.hash);
}

/** A complete, gzipped copy of the database (minus short-lived security records). */
export async function exportDatabase(db: Db, now = new Date()): Promise<Buffer> {
  const tables: Record<string, unknown[]> = {};
  for (const table of await tablesInRestoreOrder(db)) {
    if (NOT_BACKED_UP.has(table)) continue;
    const result = await db.execute<{ rows: unknown[] }>(
      sql`select coalesce(json_agg(t), '[]'::json) as rows from ${sql.identifier(table)} t`,
    );
    tables[table] = result.rows[0]!.rows;
  }
  const file: BackupFile = {
    format: FORMAT,
    version: VERSION,
    createdAt: now.toISOString(),
    migrations: await appliedMigrations(db),
    tables,
  };
  return gzipSync(JSON.stringify(file));
}

function readBackup(data: Buffer): BackupFile {
  let file: BackupFile;
  try {
    file = JSON.parse(gunzipSync(data).toString("utf8")) as BackupFile;
  } catch {
    throw new BackupError("This isn't a backup file from the album (it couldn't be read).");
  }
  if (file?.format !== FORMAT || file.version !== VERSION || !file.tables || !Array.isArray(file.migrations)) {
    throw new BackupError("This isn't a backup file from the album.");
  }
  return file;
}

/**
 * Replaces everything in the database with the backup's contents, in one transaction.
 * Returns the number of rows restored per table.
 */
export async function restoreDatabase(db: Db, data: Buffer): Promise<Record<string, number>> {
  const file = readBackup(data);
  const current = await appliedMigrations(db);
  if (current.join(",") !== file.migrations.join(",")) {
    throw new BackupError(
      `This backup was made with a different database version (${file.migrations.length} updates applied; ` +
        `this database has ${current.length}). Restore it with the matching version of the app.`,
    );
  }
  const order = await tablesInRestoreOrder(db);
  const unknown = Object.keys(file.tables).filter((t) => !order.includes(t));
  if (unknown.length) throw new BackupError(`The backup has tables this database doesn't: ${unknown.join(", ")}.`);

  const restored: Record<string, number> = {};
  await db.transaction(async (tx) => {
    await tx.execute(sql`truncate ${sql.join(order.map((t) => sql.identifier(t)), sql`, `)} restart identity cascade`);
    for (const table of order) {
      const rows = file.tables[table] ?? [];
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        await tx.execute(
          sql`insert into ${sql.identifier(table)}
              select * from json_populate_recordset(null::${sql.identifier(table)}, ${chunk}::json)`,
        );
      }
      restored[table] = rows.length;
    }
  });
  return restored;
}

// ---------------------------------------------------------------- stored backups (R2)

/** backups/2026-11-14T22-08-37.208Z.json.gz ⇄ the time it was made. */
export function backupKey(at: Date): string {
  return `${BACKUP_PREFIX}${at.toISOString().replace(/:/g, "-")}.json.gz`;
}

function backupTime(key: string): Date | null {
  const m = key.match(/^backups\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}(?:\.\d+)?)Z\.json\.gz$/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null;
}

/** Stored backups, newest first. */
export async function listBackups(storage: ObjectStore): Promise<BackupDto[]> {
  const found = await storage.list(BACKUP_PREFIX);
  return found
    .map(({ key, size }) => ({ key, size, createdAt: backupTime(key)?.toISOString() ?? null }))
    .filter((b): b is BackupDto => b.createdAt !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes all but the newest `keep` backups. Returns how many were removed. */
export async function pruneBackups(storage: ObjectStore, keep = BACKUP_KEEP): Promise<number> {
  const old = (await listBackups(storage)).slice(keep);
  for (const b of old) await storage.deleteObject(b.key);
  return old.length;
}

/** Makes a backup now and stores it in R2. */
export async function createBackup(db: Db, storage: ObjectStore, now = new Date()): Promise<BackupDto> {
  const data = await exportDatabase(db, now);
  const key = backupKey(now);
  await storage.putObject(key, data, "application/gzip");
  await pruneBackups(storage);
  return { key, size: data.length, createdAt: now.toISOString() };
}

/** Called by the server's housekeeping: backs up if the latest backup is a day old (or missing). */
export async function backupIfDue(db: Db, storage: ObjectStore, now = new Date()): Promise<BackupDto | null> {
  const [latest] = await listBackups(storage);
  if (latest && now.getTime() - new Date(latest.createdAt).getTime() < BACKUP_INTERVAL_MS) return null;
  return createBackup(db, storage, now);
}

export function backupDownloadName(now = new Date()): string {
  return `our-shared-story-backup-${now.toISOString().slice(0, 10)}.json.gz`;
}
