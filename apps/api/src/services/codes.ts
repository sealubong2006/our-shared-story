import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accessCodes, accessSessions, admins } from "../db/schema.js";
import { hashCode, normaliseCode, verifyCode } from "../lib/crypto.js";

export const MIN_CODE_LENGTH = 8;

export class CodeError extends Error {}

function assertStrongEnough(code: string) {
  if (normaliseCode(code).length < MIN_CODE_LENGTH) {
    throw new CodeError(`Codes must be at least ${MIN_CODE_LENGTH} characters.`);
  }
}

/** Every code in use must be distinct, because an admin is identified by their code alone. */
async function assertUnused(db: Db, code: string, exceptAdminId?: string) {
  const [allAdmins, shared] = await Promise.all([db.select().from(admins), db.select().from(accessCodes)]);
  for (const a of allAdmins) {
    if (a.id !== exceptAdminId && (await verifyCode(code, a.codeHash))) {
      throw new CodeError("That code is already used by another admin. Choose a different one.");
    }
  }
  for (const s of shared) {
    if (await verifyCode(code, s.codeHash)) {
      throw new CodeError(`That code is the same as the ${s.scope} code. Choose a different one.`);
    }
  }
}

/**
 * Sets or rotates the shared viewing/download code. Rotating bumps the version,
 * which immediately signs out every session created with the old code.
 */
export async function setSharedCode(db: Db, scope: "view" | "download", code: string): Promise<void> {
  assertStrongEnough(code);
  const other = await db.select().from(accessCodes);
  for (const s of other) {
    if (s.scope !== scope && (await verifyCode(code, s.codeHash))) {
      throw new CodeError("The viewing and download codes must be different.");
    }
  }
  const allAdmins = await db.select().from(admins);
  for (const a of allAdmins) {
    if (await verifyCode(code, a.codeHash)) throw new CodeError("That code is already used by an admin.");
  }

  const codeHash = await hashCode(code);
  await db
    .insert(accessCodes)
    .values({ scope, codeHash })
    .onConflictDoUpdate({
      target: accessCodes.scope,
      set: { codeHash, version: sql`${accessCodes.version} + 1`, rotatedAt: new Date() },
    });
}

export async function addAdmin(db: Db, name: string, code: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new CodeError("Admin name is required.");
  assertStrongEnough(code);
  const [existing] = await db.select().from(admins).where(eq(admins.name, trimmed)).limit(1);
  if (existing) throw new CodeError(`An admin called "${trimmed}" already exists.`);
  await assertUnused(db, code);
  const [row] = await db
    .insert(admins)
    .values({ name: trimmed, codeHash: await hashCode(code) })
    .returning({ id: admins.id, name: admins.name });
  return row!;
}

async function findAdmin(db: Db, name: string) {
  const [a] = await db.select().from(admins).where(eq(admins.name, name.trim())).limit(1);
  if (!a) throw new CodeError(`No admin called "${name}".`);
  return a;
}

/** New code for an admin; their existing sessions stop working. */
export async function resetAdminCode(db: Db, name: string, code: string): Promise<void> {
  assertStrongEnough(code);
  const a = await findAdmin(db, name);
  await assertUnused(db, code, a.id);
  await db
    .update(admins)
    .set({ codeHash: await hashCode(code), codeVersion: a.codeVersion + 1 })
    .where(eq(admins.id, a.id));
}

export async function setAdminActive(db: Db, name: string, active: boolean): Promise<void> {
  const a = await findAdmin(db, name);
  await db.update(admins).set({ active }).where(eq(admins.id, a.id));
  if (!active) {
    await db.update(accessSessions).set({ revokedAt: new Date() }).where(eq(accessSessions.adminId, a.id));
  }
}

export async function listAdmins(db: Db) {
  return db
    .select({ name: admins.name, active: admins.active, createdAt: admins.createdAt })
    .from(admins)
    .orderBy(asc(admins.name));
}

/** Finds the active admin whose code matches, or null. Checks every admin to keep timing uniform. */
export async function findAdminByCode(db: Db, code: string) {
  const candidates = await db.select().from(admins).where(eq(admins.active, true));
  let match: (typeof candidates)[number] | null = null;
  for (const a of candidates) {
    if ((await verifyCode(code, a.codeHash)) && !match) match = a;
  }
  return match;
}
