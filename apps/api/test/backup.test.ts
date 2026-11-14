import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import type { BackupDto, PersonDto } from "@family-album/shared";
import { addAdmin, setSharedCode } from "../src/services/codes.js";
import {
  BACKUP_KEEP,
  BackupError,
  backupIfDue,
  backupKey,
  createBackup,
  exportDatabase,
  listBackups,
  restoreDatabase,
} from "../src/services/backup.js";
import { MemoryStore } from "./memory-store.js";
import { setupTestApp } from "./helpers.js";

const store = new MemoryStore();
const t = setupTestApp(store);
const ADMIN_CODE = "harbour-meadow-finch-77";
const VIEW_CODE = "willow-canyon-heron-12";

let admin: ReturnType<typeof t.browser>;

/** Everything a restore should bring back, in a comparable form. */
async function snapshot() {
  const q = async (query: ReturnType<typeof sql>) => (await t.db.execute(query)).rows;
  return {
    people: await q(sql`select id, name, slug, description, sort_order, is_collection from people order by id`),
    categories: await q(sql`select id, name, slug from categories order by id`),
    events: await q(sql`select id, name, starts_on, ends_on from events order by id`),
    eventPeople: await q(sql`select * from event_people order by event_id, person_id`),
    admins: await q(sql`select id, name, code_hash, active from admins order by id`),
    codes: await q(sql`select scope, code_hash, version from access_codes order by scope`),
    activity: await q(sql`select id, action, details, created_at from admin_activity_logs order by id`),
    settings: await q(sql`select key, value from settings order by key`),
  };
}

beforeEach(async () => {
  await t.resetAll();
  store.objects.clear();
  await setSharedCode(t.db, "view", VIEW_CODE);
  await addAdmin(t.db, "Mum", ADMIN_CODE);
  admin = t.browser();
  await admin.post("/api/access/admin", { code: ADMIN_CODE });
});

afterAll(async () => {
  await t.pool.end();
});

describe("database backups", () => {
  it("a restore brings back exactly what was backed up, and signs everyone out", async () => {
    const people = (await admin.get("/api/people")).body as PersonDto[];
    const ev = await admin.post("/api/admin/events", {
      name: "Grandad's 80th",
      startsOn: "2026-06-01",
      endsOn: "2026-06-02",
      personIds: [people[1]!.id],
    });
    expect(ev.status).toBe(201);
    await admin.patch(`/api/admin/people/${people[2]!.id}`, { name: "Rosie", description: "Little sister" });
    const before = await snapshot();
    const backup = await createBackup(t.db, store);

    // Make a mess: delete, rename, add, change the code.
    await admin.delete(`/api/admin/people/${people[3]!.id}`);
    await admin.patch(`/api/admin/people/${people[2]!.id}`, { name: "Someone else" });
    await admin.post("/api/admin/categories", { name: "Mistake" });
    await setSharedCode(t.db, "view", "a-different-code-99");
    expect(await snapshot()).not.toEqual(before);

    const counts = await restoreDatabase(t.db, await store.getObject(backup.key));
    expect(counts.people).toBe(before.people.length);
    expect(await snapshot()).toEqual(before);

    // Sessions aren't backed up, so everyone signs in again, and the old code works again.
    expect((await admin.get("/api/access/me")).body.admin).toBeNull();
    const viewer = t.browser();
    expect((await viewer.post("/api/access/view", { code: VIEW_CODE })).status).toBe(200);
  });

  it("leaves short-lived security records out of the file", async () => {
    const file = JSON.parse(gunzipSync(await exportDatabase(t.db)).toString());
    expect(Object.keys(file.tables)).not.toContain("access_sessions");
    expect(Object.keys(file.tables)).not.toContain("failed_attempts");
    expect(Object.keys(file.tables)).toEqual(expect.arrayContaining(["photos", "people", "admins", "access_codes"]));
  });

  it("is all or nothing: a broken backup changes nothing", async () => {
    const before = await snapshot();
    const file = JSON.parse(gunzipSync(await exportDatabase(t.db)).toString());
    // Two people with the same id make the insert fail part-way through.
    file.tables.people.push(file.tables.people[0]);
    await expect(restoreDatabase(t.db, gzipSync(JSON.stringify(file)))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("refuses files that aren't backups, or come from a different database version", async () => {
    await expect(restoreDatabase(t.db, Buffer.from("hello"))).rejects.toThrow(BackupError);
    await expect(restoreDatabase(t.db, gzipSync('{"format":"something-else"}'))).rejects.toThrow(/isn't a backup/);
    const file = JSON.parse(gunzipSync(await exportDatabase(t.db)).toString());
    file.migrations.push("a-future-update");
    await expect(restoreDatabase(t.db, gzipSync(JSON.stringify(file)))).rejects.toThrow(/different database version/);
  });

  it("keeps only the newest backups", async () => {
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < BACKUP_KEEP + 3; i++) await createBackup(t.db, store, new Date(start + i * 86_400_000));
    const kept = await listBackups(store);
    expect(kept).toHaveLength(BACKUP_KEEP);
    expect(kept[0]!.key).toBe(backupKey(new Date(start + (BACKUP_KEEP + 2) * 86_400_000)));
    expect(kept.at(-1)!.key).toBe(backupKey(new Date(start + 3 * 86_400_000)));
  });

  it("backs up automatically once a day", async () => {
    const now = new Date("2026-11-14T03:00:00Z");
    expect(await backupIfDue(t.db, store, now)).not.toBeNull(); // none yet
    expect(await backupIfDue(t.db, store, new Date(now.getTime() + 60_000))).toBeNull(); // too soon
    expect(await backupIfDue(t.db, store, new Date(now.getTime() + 24 * 3_600_000))).not.toBeNull();
    expect(await listBackups(store)).toHaveLength(2);
  });

  it("lets admins list backups and download a fresh copy; nobody else", async () => {
    await createBackup(t.db, store);
    const list = (await admin.get("/api/admin/backups")).body as BackupDto[];
    expect(list).toHaveLength(1);

    const res = await admin.get("/api/admin/backups/download").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="our-shared-story-backup-\d{4}-\d{2}-\d{2}\.json\.gz"/);
    expect(res.headers["cache-control"]).toBe("no-store");
    // The download is a real, restorable backup.
    await expect(restoreDatabase(t.db, res.body as Buffer)).resolves.toBeTruthy();

    const viewer = t.browser();
    await viewer.post("/api/access/view", { code: VIEW_CODE });
    expect((await viewer.get("/api/admin/backups")).status).toBe(403);
    expect((await viewer.get("/api/admin/backups/download")).status).toBe(403);
    expect((await t.browser().get("/api/admin/backups/download")).status).toBe(403);
  });
});
