import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { ActivityDto, AdminDto, SettingsOverview } from "@family-album/shared";
import type { Db } from "../db/client.js";
import { accessCodes, accessSessions, adminActivityLogs, admins } from "../db/schema.js";
import { generateMemorableCode } from "../lib/crypto.js";
import { CodeError, addAdmin, resetAdminCode, setAdminActive, setSharedCode } from "./codes.js";
import { logActivity } from "./activity.js";
import { badRequest, notFound } from "../lib/errors.js";

/** Turn code-rule violations into friendly 400s for the admin screens. */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CodeError) throw badRequest(err.message);
    throw err;
  }
}

export async function settingsOverview(db: Db, currentAdminId: string): Promise<SettingsOverview> {
  const now = new Date();
  const [codes, adminRows, sessions] = await Promise.all([
    db.select().from(accessCodes),
    db.select().from(admins).orderBy(asc(admins.createdAt)),
    db
      .select({ scope: accessSessions.scope, n: sql<number>`count(*)::int` })
      .from(accessSessions)
      .where(and(isNull(accessSessions.revokedAt), gt(accessSessions.expiresAt, now)))
      .groupBy(accessSessions.scope),
  ]);
  const code = (scope: "view" | "download") => {
    const row = codes.find((c) => c.scope === scope);
    return row ? { rotatedAt: row.rotatedAt.toISOString() } : null;
  };
  const count = (scope: string) => sessions.find((s) => s.scope === scope)?.n ?? 0;
  return {
    codes: { view: code("view"), download: code("download") },
    admins: adminRows.map(
      (a): AdminDto => ({ id: a.id, name: a.name, active: a.active, createdAt: a.createdAt.toISOString(), isYou: a.id === currentAdminId }),
    ),
    activeSessions: { view: count("view"), download: count("download"), admin: count("admin"), share: count("share") },
  };
}

/** New shared code; everyone using the old one is signed out. Returns the code (shown once). */
export async function rotateSharedCode(db: Db, adminId: string, scope: "view" | "download", chosen?: string) {
  const code = chosen || generateMemorableCode(3);
  await friendly(() => setSharedCode(db, scope, code));
  await logActivity(db, adminId, `code.rotate_${scope}`);
  return code;
}

export async function createAdmin(db: Db, adminId: string, name: string, chosen?: string) {
  const code = chosen || generateMemorableCode(4);
  const created = await friendly(() => addAdmin(db, name, code));
  await logActivity(db, adminId, "admin.create", { type: "admin", id: created.id }, { name: created.name });
  return code;
}

async function adminById(db: Db, id: string) {
  const [a] = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
  if (!a) throw notFound("Admin");
  return a;
}

export async function resetAdmin(db: Db, adminId: string, targetId: string, chosen?: string) {
  const target = await adminById(db, targetId);
  const code = chosen || generateMemorableCode(4);
  await friendly(() => resetAdminCode(db, target.name, code));
  await logActivity(db, adminId, "admin.reset_code", { type: "admin", id: target.id }, { name: target.name });
  return code;
}

export async function changeAdminActive(db: Db, adminId: string, targetId: string, active: boolean) {
  const target = await adminById(db, targetId);
  if (!active && target.id === adminId) throw badRequest("You can't disable yourself. Ask another admin to do it.");
  if (!active) {
    const [others] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(admins)
      .where(and(eq(admins.active, true), sql`${admins.id} <> ${target.id}`));
    if (!others?.n) throw badRequest("At least one admin must stay active.");
  }
  await setAdminActive(db, target.name, active);
  await logActivity(db, adminId, active ? "admin.enable" : "admin.disable", { type: "admin", id: target.id }, { name: target.name });
}

/** Signs out family devices (not admins): everyone, just download access, or share-link visitors. */
export async function revokeVisitorSessions(db: Db, adminId: string, scope: "visitors" | "download" | "share") {
  const scopes = scope === "visitors" ? (["view", "download", "share"] as const) : ([scope] as const);
  const revoked = await db
    .update(accessSessions)
    .set({ revokedAt: new Date() })
    .where(and(inArray(accessSessions.scope, [...scopes]), isNull(accessSessions.revokedAt)))
    .returning({ id: accessSessions.idHash });
  await logActivity(db, adminId, "sessions.revoke", undefined, { scope, count: revoked.length });
  return revoked.length;
}

export async function recentActivity(db: Db, limit = 50): Promise<ActivityDto[]> {
  const rows = await db
    .select({ log: adminActivityLogs, name: admins.name })
    .from(adminActivityLogs)
    .leftJoin(admins, eq(admins.id, adminActivityLogs.adminId))
    .orderBy(desc(adminActivityLogs.createdAt))
    .limit(limit);
  return rows.map(({ log, name }) => ({
    id: log.id,
    adminName: name,
    action: log.action,
    details: (log.details as Record<string, unknown> | null) ?? null,
    createdAt: log.createdAt.toISOString(),
  }));
}
