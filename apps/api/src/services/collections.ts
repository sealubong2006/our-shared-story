import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  type CategoryDto,
  type EventDto,
  type PersonDto,
  type TagRef,
  createCollectionSchema,
  createEventSchema,
  updateCollectionSchema,
  updateEventSchema,
} from "@family-album/shared";
import type { Db } from "../db/client.js";
import {
  categories,
  eventCategories,
  eventPeople,
  events,
  people,
  photoCategories,
  photoEvents,
  photoPeople,
  photoVariants,
  photos,
} from "../db/schema.js";
import type { ObjectStore } from "../lib/storage.js";
import { badRequest, notFound } from "../lib/errors.js";
import { logActivity } from "./activity.js";
import { signedThumbUrl, sortDate } from "./photos.js";

/**
 * People, categories and events share the same shape: a named collection that photos are
 * tagged into (many-to-many), with an optional cover photo.
 */
type Kind = "person" | "category" | "event";

const KINDS = {
  person: { table: people, join: photoPeople, joinCol: photoPeople.personId, cover: people.profilePhotoId },
  category: { table: categories, join: photoCategories, joinCol: photoCategories.categoryId, cover: categories.coverPhotoId },
  event: { table: events, join: photoEvents, joinCol: photoEvents.eventId, cover: events.coverPhotoId },
} as const;

const LABEL: Record<Kind, string> = { person: "Person", category: "Category", event: "Event" };

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

async function uniqueSlug(db: Db, kind: Kind, name: string, exceptId?: string): Promise<string> {
  const { table } = KINDS[kind];
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [clash] = await db
      .select({ id: table.id })
      .from(table)
      .where(exceptId ? and(eq(table.slug, slug), ne(table.id, exceptId)) : eq(table.slug, slug))
      .limit(1);
    if (!clash) return slug;
  }
}

/** Visible, ready photo ids in a collection, newest first. */
async function visiblePhotoIds(db: Db, kind: Kind, id: string, limit: number): Promise<string[]> {
  const { join, joinCol } = KINDS[kind];
  const rows = await db
    .select({ id: photos.id })
    .from(join)
    .innerJoin(photos, eq(photos.id, join.photoId))
    .where(and(eq(joinCol, id), isNull(photos.deletedAt), eq(photos.status, "ready")))
    .orderBy(desc(sortDate))
    .limit(limit);
  return rows.map((r) => r.id);
}

async function counts(db: Db, kind: Kind): Promise<Map<string, number>> {
  const { join, joinCol } = KINDS[kind];
  const rows = await db
    .select({ id: joinCol, count: sql<number>`count(*)::int` })
    .from(join)
    .innerJoin(photos, eq(photos.id, join.photoId))
    .where(and(isNull(photos.deletedAt), eq(photos.status, "ready")))
    .groupBy(joinCol);
  return new Map(rows.map((r) => [r.id, r.count]));
}

/** Cover first (if still visible), then the latest photos — up to three thumbnails. */
async function previewUrls(db: Db, storage: ObjectStore | null, kind: Kind, id: string, coverId: string | null) {
  const latest = await visiblePhotoIds(db, kind, id, 3);
  const ids = coverId && latest.length ? [coverId, ...latest.filter((p) => p !== coverId)].slice(0, 3) : latest;
  if (ids.length === 0 || !storage) return [];
  const thumbs = await db
    .select({ photoId: photoVariants.photoId, key: photoVariants.key })
    .from(photoVariants)
    .innerJoin(photos, eq(photos.id, photoVariants.photoId))
    .where(and(inArray(photoVariants.photoId, ids), eq(photoVariants.variant, "thumb"), isNull(photos.deletedAt)));
  const byId = new Map(thumbs.map((t) => [t.photoId, t.key]));
  return Promise.all(ids.filter((p) => byId.has(p)).map((p) => signedThumbUrl(storage, byId.get(p)!)));
}

// ---------------------------------------------------------------- listing

export async function listPeople(db: Db, storage: ObjectStore | null): Promise<PersonDto[]> {
  const [rows, countMap] = await Promise.all([
    db.select().from(people).orderBy(asc(people.sortOrder), asc(people.name)),
    counts(db, "person"),
  ]);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      isCollection: r.isCollection,
      photoCount: countMap.get(r.id) ?? 0,
      coverPhotoId: r.profilePhotoId,
      previewUrls: await previewUrls(db, storage, "person", r.id, r.profilePhotoId),
    })),
  );
}

export async function listCategories(db: Db, storage: ObjectStore | null): Promise<CategoryDto[]> {
  const [rows, countMap] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    counts(db, "category"),
  ]);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      photoCount: countMap.get(r.id) ?? 0,
      coverPhotoId: r.coverPhotoId,
      previewUrls: await previewUrls(db, storage, "category", r.id, r.coverPhotoId),
    })),
  );
}

export async function listEvents(db: Db, storage: ObjectStore | null): Promise<EventDto[]> {
  const [rows, countMap, ep, ec, tagged] = await Promise.all([
    db.select().from(events).orderBy(sql`${events.startsOn} desc nulls last`, asc(events.name)),
    counts(db, "event"),
    db
      .select({ eventId: eventPeople.eventId, id: people.id, name: people.name, slug: people.slug })
      .from(eventPeople)
      .innerJoin(people, eq(people.id, eventPeople.personId))
      .orderBy(asc(people.sortOrder)),
    db
      .select({ eventId: eventCategories.eventId, id: categories.id, name: categories.name, slug: categories.slug })
      .from(eventCategories)
      .innerJoin(categories, eq(categories.id, eventCategories.categoryId))
      .orderBy(asc(categories.sortOrder)),
    // People tagged in each event's (visible) photos.
    db
      .selectDistinct({
        eventId: photoEvents.eventId,
        id: people.id,
        name: people.name,
        slug: people.slug,
        sortOrder: people.sortOrder,
      })
      .from(photoEvents)
      .innerJoin(photos, and(eq(photos.id, photoEvents.photoId), isNull(photos.deletedAt), eq(photos.status, "ready")))
      .innerJoin(photoPeople, eq(photoPeople.photoId, photoEvents.photoId))
      .innerJoin(people, eq(people.id, photoPeople.personId))
      .orderBy(asc(people.sortOrder)),
  ]);
  const group = (list: (TagRef & { eventId: string })[]) => {
    const m = new Map<string, TagRef[]>();
    for (const { eventId, ...ref } of list) m.set(eventId, [...(m.get(eventId) ?? []), ref]);
    return m;
  };
  const peopleBy = group(ep);
  const categoriesBy = group(ec);
  const taggedBy = group(tagged.map(({ sortOrder: _s, ...t }) => t));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      people: peopleBy.get(r.id) ?? [],
      taggedPeople: taggedBy.get(r.id) ?? [],
      categories: categoriesBy.get(r.id) ?? [],
      photoCount: countMap.get(r.id) ?? 0,
      coverPhotoId: r.coverPhotoId,
      previewUrls: await previewUrls(db, storage, "event", r.id, r.coverPhotoId),
    })),
  );
}

// ---------------------------------------------------------------- create / update / delete

async function assertCoverBelongs(db: Db, kind: Kind, id: string, coverPhotoId: string | null | undefined) {
  if (!coverPhotoId) return;
  const { join, joinCol } = KINDS[kind];
  const [row] = await db
    .select({ id: join.photoId })
    .from(join)
    .where(and(eq(join.photoId, coverPhotoId), eq(joinCol, id)))
    .limit(1);
  if (!row) throw badRequest("The cover photo must be one of this collection's photos.");
}

async function setEventLinks(db: Db, eventId: string, personIds?: string[], categoryIds?: string[]) {
  if (personIds) {
    await db.delete(eventPeople).where(eq(eventPeople.eventId, eventId));
    const unique = [...new Set(personIds)];
    if (unique.length) {
      const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, unique));
      if (found.length !== unique.length) throw badRequest("One or more people no longer exist.");
      await db.insert(eventPeople).values(unique.map((personId) => ({ eventId, personId })));
    }
  }
  if (categoryIds) {
    await db.delete(eventCategories).where(eq(eventCategories.eventId, eventId));
    const unique = [...new Set(categoryIds)];
    if (unique.length) {
      const found = await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, unique));
      if (found.length !== unique.length) throw badRequest("One or more categories no longer exist.");
      await db.insert(eventCategories).values(unique.map((categoryId) => ({ eventId, categoryId })));
    }
  }
}

function assertDateOrder(startsOn: string | null | undefined, endsOn: string | null | undefined) {
  if (startsOn && endsOn && endsOn < startsOn) throw badRequest("The end date is before the start date.");
}

export async function createCollection(
  db: Db,
  adminId: string,
  kind: "person" | "category",
  input: z.output<typeof createCollectionSchema>,
): Promise<TagRef> {
  const { table } = KINDS[kind];
  const slug = await uniqueSlug(db, kind, input.name);
  const [maxOrder] = await db.select({ max: sql<number>`coalesce(max(${table.sortOrder}), 0)::int` }).from(table);
  const [row] = await db
    .insert(table)
    .values({ name: input.name, slug, description: input.description, sortOrder: (maxOrder?.max ?? 0) + 1 })
    .returning({ id: table.id, name: table.name, slug: table.slug });
  await logActivity(db, adminId, `${kind}.create`, { type: kind, id: row!.id }, { name: input.name });
  return row!;
}

export async function createEvent(db: Db, adminId: string, input: z.output<typeof createEventSchema>): Promise<TagRef> {
  assertDateOrder(input.startsOn, input.endsOn);
  const slug = await uniqueSlug(db, "event", input.name);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(events)
      .values({ name: input.name, slug, description: input.description, startsOn: input.startsOn, endsOn: input.endsOn })
      .returning({ id: events.id, name: events.name, slug: events.slug });
    await setEventLinks(tx as unknown as Db, created!.id, input.personIds, input.categoryIds);
    return created!;
  });
  await logActivity(db, adminId, "event.create", { type: "event", id: row.id }, { name: input.name });
  return row;
}

export async function updateCollection(
  db: Db,
  adminId: string,
  kind: "person" | "category",
  id: string,
  input: z.output<typeof updateCollectionSchema>,
): Promise<void> {
  const { table } = KINDS[kind];
  const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!existing) throw notFound(LABEL[kind]);
  await assertCoverBelongs(db, kind, id, input.coverPhotoId);

  const fields: Record<string, unknown> = {};
  if (input.name !== undefined) {
    fields.name = input.name;
    fields.slug = await uniqueSlug(db, kind, input.name, id);
  }
  if (input.description !== undefined) fields.description = input.description;
  if (input.coverPhotoId !== undefined) fields[kind === "person" ? "profilePhotoId" : "coverPhotoId"] = input.coverPhotoId;
  if (Object.keys(fields).length) await db.update(table).set(fields).where(eq(table.id, id));
  await logActivity(db, adminId, `${kind}.update`, { type: kind, id }, { fields: Object.keys(input) });
}

export async function updateEvent(db: Db, adminId: string, id: string, input: z.output<typeof updateEventSchema>) {
  const [existing] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!existing) throw notFound("Event");
  await assertCoverBelongs(db, "event", id, input.coverPhotoId);
  assertDateOrder(
    input.startsOn !== undefined ? input.startsOn : existing.startsOn,
    input.endsOn !== undefined ? input.endsOn : existing.endsOn,
  );

  const fields: Partial<typeof events.$inferInsert> = {};
  if (input.name !== undefined) {
    fields.name = input.name;
    fields.slug = await uniqueSlug(db, "event", input.name, id);
  }
  if (input.description !== undefined) fields.description = input.description;
  if (input.coverPhotoId !== undefined) fields.coverPhotoId = input.coverPhotoId;
  if (input.startsOn !== undefined) fields.startsOn = input.startsOn;
  if (input.endsOn !== undefined) fields.endsOn = input.endsOn;

  await db.transaction(async (tx) => {
    if (Object.keys(fields).length) await tx.update(events).set(fields).where(eq(events.id, id));
    await setEventLinks(tx as unknown as Db, id, input.personIds, input.categoryIds);
  });
  await logActivity(db, adminId, "event.update", { type: "event", id }, { fields: Object.keys(input) });
}

/** Removes the collection and its tags. The photos themselves are never deleted. */
export async function deleteCollection(db: Db, adminId: string, kind: Kind, id: string): Promise<void> {
  const { table } = KINDS[kind];
  const [row] = await db.delete(table).where(eq(table.id, id)).returning({ name: table.name });
  if (!row) throw notFound(LABEL[kind]);
  await logActivity(db, adminId, `${kind}.delete`, { type: kind, id }, { name: row.name });
}
