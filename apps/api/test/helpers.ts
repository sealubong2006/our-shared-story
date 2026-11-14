import { sql } from "drizzle-orm";
import request from "supertest";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@family-album/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import type { ObjectStore } from "../src/lib/storage.js";

export function setupTestApp(storage: ObjectStore | null = null) {
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  const app = createApp({ db, config, storage });

  /** Clears access data only. */
  async function reset() {
    await db.execute(
      sql`truncate admin_activity_logs, access_sessions, failed_attempts, access_codes, admins restart identity cascade`,
    );
  }

  /** Clears everything, then re-seeds people and categories. */
  async function resetAll() {
    await db.execute(
      sql`truncate photos, people, categories, events, favourites, share_links, download_audit_logs,
          admin_activity_logs, access_sessions, failed_attempts, access_codes, admins, settings
          restart identity cascade`,
    );
    await seed(db);
  }

  /** A cookie-keeping client, like one browser. */
  function browser() {
    const agent = request.agent(app);
    return {
      agent,
      get: (url: string) => agent.get(url),
      post: (url: string, body?: object) => agent.post(url).set(CSRF_HEADER, CSRF_HEADER_VALUE).send(body ?? {}),
      patch: (url: string, body?: object) => agent.patch(url).set(CSRF_HEADER, CSRF_HEADER_VALUE).send(body ?? {}),
      delete: (url: string) => agent.delete(url).set(CSRF_HEADER, CSRF_HEADER_VALUE),
    };
  }

  return { app, db, pool, reset, resetAll, browser };
}
