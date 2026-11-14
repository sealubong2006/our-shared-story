/**
 * Database backups from the command line (on the server: npm run backup:prod -- <command>).
 *
 *   list                         stored backups in R2, newest first
 *   create                       make a backup now and store it in R2
 *   save <file>                  write a fresh backup to a local file
 *   restore <backup> --yes-replace-everything
 *                                replace the whole database with a backup. <backup> is a key
 *                                from "list" (backups/…json.gz) or a local file. A safety
 *                                backup of the current database is stored in R2 first.
 *
 * Photos are not part of these backups; they stay in R2 untouched.
 */
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { createStorage } from "../src/lib/storage.js";
import { BackupError, createBackup, exportDatabase, listBackups, restoreDatabase } from "../src/services/backup.js";

const [command, target, ...flags] = process.argv.slice(2);
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const storage = createStorage(config);

function needStorage() {
  if (!storage) throw new BackupError("R2 isn't configured, so stored backups aren't available.");
  return storage;
}
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

try {
  if (command === "list") {
    const backups = await listBackups(needStorage());
    if (!backups.length) console.log("No backups yet.");
    for (const b of backups) console.log(`${b.createdAt}  ${kb(b.size).padStart(7)}  ${b.key}`);
  } else if (command === "create") {
    const b = await createBackup(db, needStorage());
    console.log(`Backup saved: ${b.key} (${kb(b.size)}).`);
  } else if (command === "save" && target) {
    const data = await exportDatabase(db);
    fs.writeFileSync(target, data);
    console.log(`Backup written to ${target} (${kb(data.length)}).`);
  } else if (command === "restore" && target) {
    if (!flags.includes("--yes-replace-everything")) {
      throw new BackupError(
        "Restoring replaces EVERYTHING in the database with the backup. Run again with --yes-replace-everything to confirm.",
      );
    }
    const data = fs.existsSync(target) ? fs.readFileSync(target) : await needStorage().getObject(target);
    if (storage) {
      const safety = await createBackup(db, storage);
      console.log(`Safety backup of the current database saved first: ${safety.key}`);
    }
    const counts = await restoreDatabase(db, data);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Restored ${total} rows across ${Object.keys(counts).length} tables. Everyone will need to enter their code again.`);
  } else {
    console.log("Usage: backup <list | create | save FILE | restore BACKUP --yes-replace-everything>");
    process.exitCode = 1;
  }
} catch (err) {
  if (err instanceof BackupError) {
    console.error(err.message);
    process.exitCode = 1;
  } else throw err;
} finally {
  await pool.end();
}
