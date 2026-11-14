import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, not, or, sql, type SQL } from "drizzle-orm";
import {
  MAX_UPLOAD_BYTES,
  type PhotoDto,
  type PhotoPage,
  type TagRef,
  type TimelineSummary,
  bulkTagSchema,
  finaliseUploadSchema,
  photoListQuerySchema,
  updatePhotoSchema,
} from "@family-album/shared";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import {
  admins,
  categories,
  events,
  favourites,
  people,
  photoCategories,
  photoEvents,
  photoPeople,
  photoVariants,
  photos,
  shareLinkPhotos,
} from "../db/schema.js";
import type { ObjectStore } from "../lib/storage.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { ImageError, processImage } from "./images.js";
import { logActivity } from "./activity.js";

/** Viewing URLs are signed in fixed one-hour windows so browsers can cache them. */
const VIEW_URL_WINDOW_SECONDS = 3600;

type PhotoRow = typeof photos.$inferSelect;

// ---------------------------------------------------------------- dates

/** "2025-12-25" or "2025-12-25T14:30" → wall-clock Date stored as UTC (see images.ts). */
export function parseWallClock(value: string): Date {
  const iso = value.length === 10 ? `${value}T00:00:00Z` : `${value}${value.length === 16 ? ":00" : ""}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw badRequest("That date isn't valid.");
  return date;
}

const toWallClock = (d: Date | null) => (d ? d.toISOString().slice(0, 19) : null);

/**
 * Sort key: the capture date. Undated photos (often old scans) count as the oldest, so they
 * collect at the end of "newest first" instead of crowding the top on the day they're uploaded.
 */
export const sortDate = sql<Date>`coalesce(${photos.takenAt}, '0001-01-01T00:00:00Z'::timestamptz)`;

// ---------------------------------------------------------------- DTOs

export async function signedThumbUrl(storage: ObjectStore | null, key: string): Promise<string> {
  return storage ? storage.signedGetUrl(key, { windowSeconds: VIEW_URL_WINDOW_SECONDS }) : "";
}

async function tagsFor(
  db: Db,
  ids: string[],
): Promise<{ people: Map<string, TagRef[]>; categories: Map<string, TagRef[]>; events: Map<string, TagRef[]> }> {
  const group = (rows: { photoId: string; id: string; name: string; slug: string }[]) => {
    const map = new Map<string, TagRef[]>();
    for (const { photoId, ...ref } of rows) map.set(photoId, [...(map.get(photoId) ?? []), ref]);
    return map;
  };
  const [p, c, e] = await Promise.all([
    db
      .select({ photoId: photoPeople.photoId, id: people.id, name: people.name, slug: people.slug })
      .from(photoPeople)
      .innerJoin(people, eq(people.id, photoPeople.personId))
      .where(inArray(photoPeople.photoId, ids))
      .orderBy(asc(people.sortOrder), asc(people.name)),
    db
      .select({ photoId: photoCategories.photoId, id: categories.id, name: categories.name, slug: categories.slug })
      .from(photoCategories)
      .innerJoin(categories, eq(categories.id, photoCategories.categoryId))
      .where(inArray(photoCategories.photoId, ids))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ photoId: photoEvents.photoId, id: events.id, name: events.name, slug: events.slug })
      .from(photoEvents)
      .innerJoin(events, eq(events.id, photoEvents.eventId))
      .where(inArray(photoEvents.photoId, ids))
      .orderBy(desc(events.startsOn), asc(events.name)),
  ]);
  return { people: group(p), categories: group(c), events: group(e) };
}

export async function toPhotoDtos(db: Db, storage: ObjectStore | null, rows: PhotoRow[]): Promise<PhotoDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [variantRows, tags, favRows, uploaderRows] = await Promise.all([
    db.select().from(photoVariants).where(inArray(photoVariants.photoId, ids)),
    tagsFor(db, ids),
    db.select({ photoId: favourites.photoId }).from(favourites).where(inArray(favourites.photoId, ids)),
    db
      .select({ id: admins.id, name: admins.name })
      .from(admins)
      .where(
        inArray(
          admins.id,
          rows.map((r) => r.uploadedByAdminId).filter((v): v is string => Boolean(v)).concat(["00000000-0000-0000-0000-000000000000"]),
        ),
      ),
  ]);

  const variantKeys = new Map<string, Record<string, string>>();
  for (const v of variantRows) variantKeys.set(v.photoId, { ...variantKeys.get(v.photoId), [v.variant]: v.key });
  const favs = new Set(favRows.map((f) => f.photoId));
  const uploaders = new Map(uploaderRows.map((a) => [a.id, a.name]));

  return Promise.all(
    rows.map(async (r): Promise<PhotoDto> => {
      const keys = variantKeys.get(r.id);
      const urls =
        storage && keys?.thumb && keys.md && keys.lg
          ? {
              thumb: await signedThumbUrl(storage, keys.thumb),
              md: await signedThumbUrl(storage, keys.md),
              lg: await signedThumbUrl(storage, keys.lg),
            }
          : null;
      return {
        id: r.id,
        takenAt: toWallClock(r.takenAt),
        takenAtSource: r.takenAtSource,
        uploadedAt: r.uploadedAt.toISOString(),
        uploadedBy: r.uploadedByAdminId ? (uploaders.get(r.uploadedByAdminId) ?? null) : null,
        originalFilename: r.originalFilename,
        caption: r.caption,
        locationName: r.locationName,
        width: r.width,
        height: r.height,
        blurhash: r.blurhash,
        urls,
        people: tags.people.get(r.id) ?? [],
        categories: tags.categories.get(r.id) ?? [],
        events: tags.events.get(r.id) ?? [],
        isFavourite: favs.has(r.id),
        deletedAt: r.deletedAt?.toISOString() ?? null,
      };
    }),
  );
}

// ---------------------------------------------------------------- listing

export type ListQuery = z.output<typeof photoListQuerySchema>;

/** The sort key is carried as Postgres text so microsecond precision survives the round trip. */
function encodeCursor(sortKey: string, id: string) {
  return Buffer.from(JSON.stringify([sortKey, id])).toString("base64url");
}
function decodeCursor(cursor: string): [string, string] {
  try {
    const [d, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
    const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;
    if (!timestamp.test(d) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error();
    return [d, id];
  } catch {
    throw badRequest("Invalid cursor.");
  }
}

/** `exists (subquery)` — drizzle's exists() does not bracket raw SQL fragments. */
const existsSql = (subquery: SQL) => sql`exists (${subquery})`;

const hasPeople = existsSql(sql`select 1 from ${photoPeople} where ${photoPeople.photoId} = ${photos.id}`);
const hasCategories = existsSql(sql`select 1 from ${photoCategories} where ${photoCategories.photoId} = ${photos.id}`);
const hasEvents = existsSql(sql`select 1 from ${photoEvents} where ${photoEvents.photoId} = ${photos.id}`);

/** Restricts a listing to the photos hand-picked for a share link. */
export interface ListScope {
  shareLinkId?: string;
}

/** The WHERE conditions for a listing (everything except the cursor). */
function photoConditions(q: Omit<ListQuery, "sort" | "limit" | "cursor">, scope?: ListScope): SQL[] {
  const conditions: SQL[] = [eq(photos.status, "ready")];
  if (scope?.shareLinkId) {
    conditions.push(
      existsSql(
        sql`select 1 from ${shareLinkPhotos} where ${shareLinkPhotos.photoId} = ${photos.id} and ${shareLinkPhotos.shareLinkId} = ${scope.shareLinkId}`,
      ),
    );
  }
  conditions.push(q.deleted === "true" ? isNotNull(photos.deletedAt) : isNull(photos.deletedAt));
  if (q.personId) {
    conditions.push(
      existsSql(sql`select 1 from ${photoPeople} where ${photoPeople.photoId} = ${photos.id} and ${photoPeople.personId} = ${q.personId}`,
      ),
    );
  }
  if (q.categoryId) {
    conditions.push(
      existsSql(sql`select 1 from ${photoCategories} where ${photoCategories.photoId} = ${photos.id} and ${photoCategories.categoryId} = ${q.categoryId}`,
      ),
    );
  }
  if (q.eventId) {
    conditions.push(
      existsSql(sql`select 1 from ${photoEvents} where ${photoEvents.photoId} = ${photos.id} and ${photoEvents.eventId} = ${q.eventId}`,
      ),
    );
  }
  if (q.untagged === "true") conditions.push(not(or(hasPeople, hasCategories, hasEvents)!));
  if (q.favourites === "true") {
    conditions.push(existsSql(sql`select 1 from ${favourites} where ${favourites.photoId} = ${photos.id}`));
  }
  // Date filters use the capture date only (stored as wall-clock UTC, see parseWallClock).
  if (q.from) conditions.push(sql`${photos.takenAt} >= ${`${q.from}T00:00:00Z`}::timestamptz`);
  if (q.to) conditions.push(sql`${photos.takenAt} < (${`${q.to}T00:00:00Z`}::timestamptz + interval '1 day')`);
  if (q.undated === "true") conditions.push(isNull(photos.takenAt));
  return conditions;
}

export async function countPhotos(db: Db, q: Omit<ListQuery, "sort" | "limit" | "cursor">, scope?: ListScope) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(photos)
    .where(and(...photoConditions(q, scope)));
  return row?.n ?? 0;
}

/** Cursor-paginated photo listing with combinable filters. */
export async function listPhotos(db: Db, storage: ObjectStore | null, q: ListQuery, scope?: ListScope): Promise<PhotoPage> {
  const conditions = photoConditions(q, scope);
  const key = q.sort === "uploaded" ? sql<Date>`${photos.uploadedAt}` : sortDate;
  const ascending = q.sort === "oldest";
  if (q.cursor) {
    const [d, id] = decodeCursor(q.cursor);
    conditions.push(
      ascending
        ? sql`(${key}, ${photos.id}) > (${d}::timestamptz, ${id}::uuid)`
        : sql`(${key}, ${photos.id}) < (${d}::timestamptz, ${id}::uuid)`,
    );
  }

  const rows = await db
    .select({ photo: photos, sortKey: sql<string>`(${key})::text`.as("sort_key") })
    .from(photos)
    .where(and(...conditions))
    .orderBy(ascending ? asc(key) : desc(key), ascending ? asc(photos.id) : desc(photos.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    photos: await toPhotoDtos(
      db,
      storage,
      page.map((r) => r.photo),
    ),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.sortKey, last.photo.id) : null,
  };
}

/** Photo counts per capture month, newest first, plus the number of undated photos. */
export async function timelineSummary(db: Db): Promise<TimelineSummary> {
  const visible = and(eq(photos.status, "ready"), isNull(photos.deletedAt));
  const year = sql<number>`extract(year from ${photos.takenAt} at time zone 'UTC')::int`;
  const month = sql<number>`extract(month from ${photos.takenAt} at time zone 'UTC')::int`;
  const [months, [undated]] = await Promise.all([
    db
      .select({ year, month, count: sql<number>`count(*)::int` })
      .from(photos)
      .where(and(visible, isNotNull(photos.takenAt)))
      .groupBy(year, month)
      .orderBy(desc(year), desc(month)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(photos)
      .where(and(visible, isNull(photos.takenAt))),
  ]);
  return { months, undatedCount: undated?.count ?? 0 };
}

/** Favourites are one shared family list (no accounts), so anyone who can view can add. */
export async function setFavourite(db: Db, photoId: string, favourite: boolean): Promise<void> {
  const [row] = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.id, photoId), isNull(photos.deletedAt), eq(photos.status, "ready")))
    .limit(1);
  if (!row) throw notFound("Photo");
  if (favourite) await db.insert(favourites).values({ photoId }).onConflictDoNothing();
  else await db.delete(favourites).where(eq(favourites.photoId, photoId));
}

export async function getPhoto(db: Db, storage: ObjectStore | null, id: string, includeDeleted = false) {
  const [row] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, id), eq(photos.status, "ready"), includeDeleted ? undefined : isNull(photos.deletedAt)))
    .limit(1);
  if (!row) throw notFound("Photo");
  return (await toPhotoDtos(db, storage, [row]))[0]!;
}

// ---------------------------------------------------------------- tagging helpers

async function assertIdsExist(db: Db, table: typeof people | typeof categories | typeof events, ids: string[], label: string) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const found = await db.select({ id: table.id }).from(table).where(inArray(table.id, unique));
  if (found.length !== unique.length) throw badRequest(`One or more ${label} no longer exist. Refresh and try again.`);
}

async function validateTags(db: Db, t: { personIds?: string[]; categoryIds?: string[]; eventIds?: string[] }) {
  await Promise.all([
    assertIdsExist(db, people, t.personIds ?? [], "people"),
    assertIdsExist(db, categories, t.categoryIds ?? [], "categories"),
    assertIdsExist(db, events, t.eventIds ?? [], "events"),
  ]);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function addTags(
  tx: Tx | Db,
  photoIds: string[],
  t: { personIds?: string[]; categoryIds?: string[]; eventIds?: string[] },
) {
  const pairs = <T>(ids: string[] | undefined, make: (photoId: string, id: string) => T) =>
    photoIds.flatMap((p) => [...new Set(ids ?? [])].map((id) => make(p, id)));
  const pp = pairs(t.personIds, (photoId, personId) => ({ photoId, personId }));
  const pc = pairs(t.categoryIds, (photoId, categoryId) => ({ photoId, categoryId }));
  const pe = pairs(t.eventIds, (photoId, eventId) => ({ photoId, eventId }));
  if (pp.length) await tx.insert(photoPeople).values(pp).onConflictDoNothing();
  if (pc.length) await tx.insert(photoCategories).values(pc).onConflictDoNothing();
  if (pe.length) await tx.insert(photoEvents).values(pe).onConflictDoNothing();
}

// ---------------------------------------------------------------- uploads

export const UPLOAD_KEY_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

export async function presignUploads(storage: ObjectStore, files: { type: string }[]) {
  return Promise.all(
    files.map(async (f) => {
      const key = `uploads/${randomUUID()}.${UPLOAD_KEY_EXT[f.type]}`;
      return { key, url: await storage.signedPutUrl(key, f.type), contentType: f.type };
    }),
  );
}

/**
 * Turns a file the browser uploaded to `uploads/…` into a photo: validates and processes it,
 * stores the original + variants under the photo's id, records metadata and tags, and removes
 * the temporary upload.
 */
export async function finaliseUpload(
  db: Db,
  storage: ObjectStore,
  adminId: string,
  input: z.output<typeof finaliseUploadSchema>,
): Promise<PhotoDto> {
  const size = await storage.headObject(input.key);
  if (size === null) throw badRequest("The upload didn't arrive. Please try again.");
  if (size > MAX_UPLOAD_BYTES) {
    await storage.deleteObject(input.key);
    throw new HttpError(413, "That file is larger than 50 MB.");
  }
  await validateTags(db, input);

  let processed;
  try {
    processed = await processImage(await storage.getObject(input.key));
  } catch (err) {
    await storage.deleteObject(input.key).catch(() => undefined);
    if (err instanceof ImageError) throw new HttpError(422, err.message);
    throw err;
  }

  const id = randomUUID();
  const originalKey = `originals/${id}.${processed.display.ext}`;
  const archiveKey = processed.archive ? `originals/${id}-original.${processed.archive.ext}` : null;
  const variantKeys = processed.variants.map((v) => ({ ...v, key: `variants/${id}/${v.kind}.webp` }));
  const written: string[] = [];

  try {
    const put = async (key: string, body: Buffer, type: string) => {
      await storage.putObject(key, body, type);
      written.push(key);
    };
    await Promise.all([
      put(originalKey, processed.display.buffer, processed.display.mime),
      archiveKey && processed.archive ? put(archiveKey, processed.archive.buffer, processed.archive.mime) : null,
      ...variantKeys.map((v) => put(v.key, v.buffer, "image/webp")),
    ]);

    const manualDate = input.takenAt ? parseWallClock(input.takenAt) : null;
    await db.transaction(async (tx) => {
      await tx.insert(photos).values({
        id,
        originalKey,
        archiveKey,
        originalFilename: input.originalFilename,
        mimeType: processed.display.mime,
        width: processed.width,
        height: processed.height,
        bytes: processed.display.buffer.length,
        takenAt: manualDate ?? processed.takenAt,
        takenAtSource: manualDate ? "manual" : processed.takenAt ? "exif" : "unknown",
        uploadedByAdminId: adminId,
        caption: input.caption,
        locationName: input.locationName,
        latitude: processed.latitude,
        longitude: processed.longitude,
        blurhash: processed.blurhash,
        status: "ready",
      });
      await tx.insert(photoVariants).values(
        variantKeys.map((v) => ({
          photoId: id,
          variant: v.kind,
          key: v.key,
          width: v.width,
          height: v.height,
          bytes: v.buffer.length,
        })),
      );
      await addTags(tx, [id], input);
    });
  } catch (err) {
    await Promise.all(written.map((k) => storage.deleteObject(k).catch(() => undefined)));
    throw err;
  }

  await storage.deleteObject(input.key).catch(() => undefined);
  await logActivity(db, adminId, "photo.upload", { type: "photo", id }, { filename: input.originalFilename });
  return getPhoto(db, storage, id);
}

// ---------------------------------------------------------------- editing

export async function updatePhoto(
  db: Db,
  storage: ObjectStore | null,
  adminId: string,
  id: string,
  input: z.output<typeof updatePhotoSchema>,
): Promise<PhotoDto> {
  const [existing] = await db.select({ id: photos.id }).from(photos).where(eq(photos.id, id)).limit(1);
  if (!existing) throw notFound("Photo");
  await validateTags(db, input);

  const fields: Partial<typeof photos.$inferInsert> = {};
  if (input.caption !== undefined) fields.caption = input.caption;
  if (input.locationName !== undefined) fields.locationName = input.locationName;
  if (input.takenAt !== undefined) {
    fields.takenAt = input.takenAt ? parseWallClock(input.takenAt) : null;
    fields.takenAtSource = input.takenAt ? "manual" : "unknown";
  }

  await db.transaction(async (tx) => {
    if (Object.keys(fields).length) await tx.update(photos).set(fields).where(eq(photos.id, id));
    if (input.personIds) {
      await tx.delete(photoPeople).where(eq(photoPeople.photoId, id));
      await addTags(tx, [id], { personIds: input.personIds });
    }
    if (input.categoryIds) {
      await tx.delete(photoCategories).where(eq(photoCategories.photoId, id));
      await addTags(tx, [id], { categoryIds: input.categoryIds });
    }
    if (input.eventIds) {
      await tx.delete(photoEvents).where(eq(photoEvents.photoId, id));
      await addTags(tx, [id], { eventIds: input.eventIds });
    }
  });
  await logActivity(db, adminId, "photo.update", { type: "photo", id }, { fields: Object.keys(input) });
  return getPhoto(db, storage, id, true);
}

export async function bulkTag(db: Db, adminId: string, input: z.output<typeof bulkTagSchema>): Promise<void> {
  await validateTags(db, input);
  const found = await db.select({ id: photos.id }).from(photos).where(inArray(photos.id, input.photoIds));
  await addTags(
    db,
    found.map((f) => f.id),
    input,
  );
  await logActivity(db, adminId, "photo.bulk_tag", { type: "photo" }, { count: found.length });
}

/** Soft delete: hidden everywhere immediately, files kept for 30 days so it can be undone. */
export async function setPhotosDeleted(db: Db, adminId: string, photoIds: string[], deleted: boolean): Promise<number> {
  const result = await db
    .update(photos)
    .set({ deletedAt: deleted ? new Date() : null })
    .where(and(inArray(photos.id, photoIds), deleted ? isNull(photos.deletedAt) : isNotNull(photos.deletedAt)))
    .returning({ id: photos.id });
  await logActivity(db, adminId, deleted ? "photo.delete" : "photo.restore", { type: "photo" }, {
    photoIds: result.map((r) => r.id),
  });
  return result.length;
}
