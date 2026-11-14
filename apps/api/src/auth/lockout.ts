import { and, desc, eq, gt, lt } from "drizzle-orm";
import { LOCKOUT } from "../config.js";
import type { Db } from "../db/client.js";
import { failedAttempts } from "../db/schema.js";
import type { SessionScope } from "./sessions.js";

/**
 * Returns the number of seconds this IP must wait before trying another code, or 0.
 * Failures are counted per IP across all code types, and are deliberately *not* cleared by a
 * successful entry — otherwise someone with the viewing code could interleave correct
 * viewing-code entries with admin-code guesses forever.
 */
export async function lockoutSeconds(db: Db, ipHash: string): Promise<number> {
  const now = Date.now();
  const windows = [
    { ms: LOCKOUT.shortWindowMs, max: LOCKOUT.shortMaxFailures },
    { ms: LOCKOUT.longWindowMs, max: LOCKOUT.longMaxFailures },
  ];

  let wait = 0;
  for (const w of windows) {
    const recent = await db
      .select({ at: failedAttempts.attemptedAt })
      .from(failedAttempts)
      .where(and(eq(failedAttempts.ipHash, ipHash), gt(failedAttempts.attemptedAt, new Date(now - w.ms))))
      .orderBy(desc(failedAttempts.attemptedAt))
      .limit(w.max);
    if (recent.length >= w.max) {
      // Locked until the oldest of the last `max` failures leaves the window.
      const oldest = recent[recent.length - 1]!.at.getTime();
      wait = Math.max(wait, Math.ceil((oldest + w.ms - now) / 1000));
    }
  }
  return wait;
}

export async function recordFailure(db: Db, ipHash: string, scope: SessionScope): Promise<void> {
  await db.insert(failedAttempts).values({ ipHash, scope });
  // Opportunistic cleanup of anything older than the longest window.
  await db.delete(failedAttempts).where(lt(failedAttempts.attemptedAt, new Date(Date.now() - LOCKOUT.longWindowMs)));
}
