import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  CreatedShareLink,
  PhotoPage,
  SharedCollectionInfo,
  ShareLinkDto,
  createShareLinkSchema,
} from "@family-album/shared";
import type { Db } from "../db/client.js";
import { accessSessions, admins, categories, events, people, photos, shareLinkPhotos, shareLinks } from "../db/schema.js";
import { generateToken, sha256 } from "../lib/crypto.js";
import type { ObjectStore } from "../lib/storage.js";
import { badRequest, notFound } from "../lib/errors.js";
import { logActivity } from "./activity.js";
import { countPhotos, listPhotos } from "./photos.js";

type ShareLink = typeof shareLinks.$inferSelect;

/** Share sessions last a week at most, and never beyond the link's own expiry. */
export const SHARE_SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const isLive = (link: ShareLink, now = new Date()) => !link.revokedAt && (!link.expiresAt || link.expiresAt > now);

function status(link: ShareLink): ShareLinkDto["status"] {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && link.expiresAt <= new Date()) return "expired";
  return "active";
}

const TARGET_TABLE = { event: events, category: categories, person: people } as const;

async function targetNames(db: Db, links: ShareLink[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const type of ["event", "category", "person"] as const) {
    const ids = links.filter((l) => l.targetType === type && l.targetId).map((l) => l.targetId!);
    if (!ids.length) continue;
    const table = TARGET_TABLE[type];
    for (const row of await db.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, ids))) {
      names.set(row.id, row.name);
    }
  }
  const selections = links.filter((l) => l.targetType === "selection").map((l) => l.id);
  if (selections.length) {
    const counts = await db
      .select({ id: shareLinkPhotos.shareLinkId, n: sql<number>`count(*)::int` })
      .from(shareLinkPhotos)
      .where(inArray(shareLinkPhotos.shareLinkId, selections))
      .groupBy(shareLinkPhotos.shareLinkId);
    for (const c of counts) names.set(c.id, `${c.n} selected photo${c.n === 1 ? "" : "s"}`);
  }
  return names;
}

export async function listShareLinks(db: Db): Promise<ShareLinkDto[]> {
  const rows = await db
    .select({ link: shareLinks, createdBy: admins.name })
    .from(shareLinks)
    .leftJoin(admins, eq(admins.id, shareLinks.createdByAdminId))
    .orderBy(desc(shareLinks.createdAt));
  const names = await targetNames(
    db,
    rows.map((r) => r.link),
  );
  return rows.map(({ link, createdBy }) => ({
    id: link.id,
    label: link.label,
    targetType: link.targetType,
    targetName: names.get(link.targetId ?? link.id) ?? "(deleted)",
    status: status(link),
    expiresAt: link.expiresAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    createdBy,
  }));
}

export async function createShareLink(
  db: Db,
  adminId: string,
  input: z.output<typeof createShareLinkSchema>,
): Promise<CreatedShareLink> {
  if (input.targetType !== "selection") {
    const table = TARGET_TABLE[input.targetType];
    const [target] = await db.select({ id: table.id }).from(table).where(eq(table.id, input.targetId!)).limit(1);
    if (!target) throw badRequest("That no longer exists. Refresh and try again.");
  }
  const photoIds = [...new Set(input.photoIds ?? [])];
  if (input.targetType === "selection") {
    const found = await db
      .select({ id: photos.id })
      .from(photos)
      .where(and(inArray(photos.id, photoIds), isNull(photos.deletedAt)));
    if (found.length !== photoIds.length) throw badRequest("Some of those photos no longer exist.");
  }

  const token = generateToken();
  const link = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(shareLinks)
      .values({
        tokenHash: sha256(token),
        label: input.label,
        targetType: input.targetType,
        targetId: input.targetType === "selection" ? null : input.targetId!,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
        createdByAdminId: adminId,
      })
      .returning();
    if (photoIds.length) {
      await tx.insert(shareLinkPhotos).values(photoIds.map((photoId) => ({ shareLinkId: created!.id, photoId })));
    }
    return created!;
  });
  await logActivity(db, adminId, "share.create", { type: "share_link", id: link.id }, { label: input.label });
  const [dto] = (await listShareLinks(db)).filter((l) => l.id === link.id);
  return { ...dto!, path: `/s/${token}` };
}

/** Revoking also ends every session opened from the link, immediately. */
export async function revokeShareLink(db: Db, adminId: string, id: string): Promise<void> {
  const [link] = await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, id), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id, label: shareLinks.label });
  if (!link) throw notFound("Share link");
  await db.update(accessSessions).set({ revokedAt: new Date() }).where(eq(accessSessions.shareLinkId, id));
  await logActivity(db, adminId, "share.revoke", { type: "share_link", id }, { label: link.label });
}

/** Looks up a link by its token: the link if usable, "gone" if revoked/expired, null if unknown. */
export async function findShareLink(db: Db, token: string): Promise<ShareLink | "gone" | null> {
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, sha256(token))).limit(1);
  if (!link) return null;
  return isLive(link) ? link : "gone";
}

/** The share link behind a session, if both are still valid. */
export async function liveLinkById(db: Db, id: string): Promise<ShareLink | null> {
  const now = new Date();
  const [link] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.id, id), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now))))
    .limit(1);
  return link ?? null;
}

/** Only the photos the link covers — nothing else in the album is reachable. */
export async function listSharedPhotos(
  db: Db,
  storage: ObjectStore | null,
  link: ShareLink,
  cursor: string | undefined,
): Promise<PhotoPage> {
  const { filter, scope } = linkFilter(link);
  const page = await listPhotos(db, storage, { ...filter, sort: "oldest", limit: 60, cursor }, scope);
  // Visitors through a link see the photos, not who uploaded them or the family's tags.
  return {
    ...page,
    photos: page.photos.map((p) => ({ ...p, uploadedBy: null, people: [], categories: [], events: [], isFavourite: false })),
  };
}

/** Filter for the photos a link covers (by collection, or by its hand-picked list). */
function linkFilter(link: ShareLink) {
  const filter =
    link.targetType === "event"
      ? { eventId: link.targetId! }
      : link.targetType === "category"
        ? { categoryId: link.targetId! }
        : link.targetType === "person"
          ? { personId: link.targetId! }
          : {};
  const scope = link.targetType === "selection" ? { shareLinkId: link.id } : undefined;
  return { filter, scope };
}

export async function sharedInfo(db: Db, link: ShareLink): Promise<SharedCollectionInfo> {
  const { filter, scope } = linkFilter(link);
  const title =
    link.targetType === "selection"
      ? "Photos shared with you"
      : ((await targetNames(db, [link])).get(link.targetId!) ?? "Shared photos");
  return {
    title,
    photoCount: await countPhotos(db, filter, scope),
    expiresAt: link.expiresAt?.toISOString() ?? null,
  };
}
