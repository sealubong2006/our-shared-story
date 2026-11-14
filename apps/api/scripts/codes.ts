/**
 * Manage access codes from the command line (run from the project root):
 *
 *   npm run codes -- set-view                 new family viewing code
 *   npm run codes -- set-download             new family download code
 *   npm run codes -- add-admin "Mum"          add an admin with their own code
 *   npm run codes -- reset-admin "Mum"        give an admin a new code
 *   npm run codes -- disable-admin "Mum"      block an admin (signs them out)
 *   npm run codes -- enable-admin "Mum"
 *   npm run codes -- list-admins
 *
 * A memorable code is generated for you. To choose your own, add  --code "your words here".
 * Codes are shown once and stored only as hashes — note them down somewhere safe.
 */
import { createDb } from "../src/db/client.js";
import { generateMemorableCode } from "../src/lib/crypto.js";
import {
  CodeError,
  addAdmin,
  listAdmins,
  resetAdminCode,
  setAdminActive,
  setSharedCode,
} from "../src/services/codes.js";

const args = process.argv.slice(2);
const command = args[0];
const codeFlag = args.indexOf("--code");
const chosenCode = codeFlag >= 0 ? args[codeFlag + 1] : undefined;
const name = args[1] && args[1] !== "--code" ? args[1] : undefined;

function usage(): never {
  console.log(
    "Usage: npm run codes -- <set-view | set-download | add-admin NAME | reset-admin NAME | disable-admin NAME | enable-admin NAME | list-admins> [--code \"...\"]",
  );
  process.exit(1);
}

function show(label: string, code: string) {
  console.log(`\n${label}:\n\n    ${code}\n\nWrite this down now — it cannot be shown again.\n`);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool } = createDb(url);

try {
  switch (command) {
    case "set-view":
    case "set-download": {
      const scope = command === "set-view" ? "view" : "download";
      const code = chosenCode ?? generateMemorableCode(3);
      await setSharedCode(db, scope, code);
      show(`New family ${scope === "view" ? "viewing" : "download"} code (anyone using the old one is signed out)`, code);
      break;
    }
    case "add-admin": {
      if (!name) usage();
      const code = chosenCode ?? generateMemorableCode(4);
      await addAdmin(db, name, code);
      show(`Admin code for ${name}`, code);
      break;
    }
    case "reset-admin": {
      if (!name) usage();
      const code = chosenCode ?? generateMemorableCode(4);
      await resetAdminCode(db, name, code);
      show(`New admin code for ${name} (their old code no longer works)`, code);
      break;
    }
    case "disable-admin":
    case "enable-admin": {
      if (!name) usage();
      await setAdminActive(db, name, command === "enable-admin");
      console.log(`${name} is now ${command === "enable-admin" ? "enabled" : "disabled"}.`);
      break;
    }
    case "list-admins": {
      const rows = await listAdmins(db);
      if (rows.length === 0) console.log("No admins yet.");
      for (const r of rows) console.log(`${r.active ? "✓" : "✗"} ${r.name}  (added ${r.createdAt.toISOString().slice(0, 10)})`);
      break;
    }
    default:
      usage();
  }
} catch (err) {
  if (err instanceof CodeError) {
    console.error(`\n${err.message}\n`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await pool.end();
}
