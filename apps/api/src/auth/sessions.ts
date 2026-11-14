import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accessCodes, accessSessions, admins } from "../db/schema.js";
import { generateToken, sha256 } from "../lib/crypto.js";

export type SessionScope = "view" | "download" | "admin" | "share";

/** Re-extend sliding sessions at most once per hour to avoid a write on every request. */
const SLIDE_INTERVAL_MS = 60 * 60 * 1000;

export interface NewSession {
  scope: SessionScope;
  codeVersion: number;
  ttlMs: number;
  adminId?: string;
  shareLinkId?: string;
  ipHash: string;
  userAgent: string | undefined;
}

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(db: Db, s: NewSession): Promise<string> {
  const token = generateToken();
  await db.insert(accessSessions).values({
    idHash: sha256(token),
    scope: s.scope,
    codeVersion: s.codeVersion,
    adminId: s.adminId ?? null,
    shareLinkId: s.shareLinkId ?? null,
    expiresAt: new Date(Date.now() + s.ttlMs),
    ipHash: s.ipHash,
    userAgent: s.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export interface ResolvedSession {
  idHash: string;
  admin: { id: string; name: string } | null;
  shareLinkId: string | null;
}

/**
 * Returns the session if it is unexpired, unrevoked, of the right scope, and was created
 * with the *current* version of its code (so rotating a code signs everyone out).
 */
export async function resolveSession(
  db: Db,
  token: string | undefined,
  scope: SessionScope,
  slideTtlMs?: number,
): Promise<ResolvedSession | null> {
  if (!token || token.length > 100) return null;
  const idHash = sha256(token);
  const now = new Date();

  const [row] = await db
    .select()
    .from(accessSessions)
    .where(
      and(
        eq(accessSessions.idHash, idHash),
        eq(accessSessions.scope, scope),
        isNull(accessSessions.revokedAt),
        gt(accessSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) return null;

  let admin: ResolvedSession["admin"] = null;
  if (scope === "admin") {
    if (!row.adminId) return null;
    const [a] = await db.select().from(admins).where(eq(admins.id, row.adminId)).limit(1);
    if (!a || !a.active || a.codeVersion !== row.codeVersion) return null;
    admin = { id: a.id, name: a.name };
  } else if (scope === "share") {
    // Validity of the link itself (revoked/expired) is checked by the caller.
    if (!row.shareLinkId) return null;
  } else {
    const [code] = await db.select().from(accessCodes).where(eq(accessCodes.scope, scope)).limit(1);
    if (!code || code.version !== row.codeVersion) return null;
  }

  if (slideTtlMs && now.getTime() - row.lastSeenAt.getTime() > SLIDE_INTERVAL_MS) {
    await db
      .update(accessSessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + slideTtlMs) })
      .where(eq(accessSessions.idHash, idHash));
  }

  return { idHash, admin, shareLinkId: row.shareLinkId };
}

export async function revokeSession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db
    .update(accessSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessSessions.idHash, sha256(token)), isNull(accessSessions.revokedAt)));
}

/** Housekeeping: drop sessions that expired more than a week ago. */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(accessSessions).where(lt(accessSessions.expiresAt, new Date(Date.now() - 7 * 24 * 3600 * 1000)));
}
