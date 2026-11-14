import type { Db } from "../db/client.js";
import { adminActivityLogs } from "../db/schema.js";

/** Records who did what in the admin area ("Mum deleted 3 photos"). */
export async function logActivity(
  db: Db,
  adminId: string,
  action: string,
  target?: { type: string; id?: string | null },
  details?: Record<string, unknown>,
): Promise<void> {
  await db.insert(adminActivityLogs).values({
    adminId,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    details: details ?? null,
  });
}
