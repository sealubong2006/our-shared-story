import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { PersonDto, PhotoDto, PhotoPage } from "@family-album/shared";
import { addAdmin, setSharedCode } from "../src/services/codes.js";
import { parseExifDate, sniffFormat } from "../src/services/images.js";
import { slugify } from "../src/services/collections.js";
import { MemoryStore } from "./memory-store.js";
import { setupTestApp } from "./helpers.js";

const store = new MemoryStore();
const t = setupTestApp(store);

const VIEW_CODE = "maple-river-otter-42";
const MUM_CODE = "fern-harbor-moss-pine-55";

/** A real JPEG with an EXIF capture date, optionally rotated via the EXIF orientation flag. */
async function makeJpeg(opts: { date?: string; orientation?: number; width?: number; height?: number } = {}) {
  let img = sharp({
    create: { width: opts.width ?? 600, height: opts.height ?? 400, channels: 3, background: { r: 180, g: 120, b: 90 } },
  });
  if (opts.date) img = img.withExif({ IFD2: { DateTimeOriginal: opts.date } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.jpeg().toBuffer();
}

let admin: ReturnType<typeof t.browser>;
let viewer: ReturnType<typeof t.browser>;
let peopleBySlug: Record<string, PersonDto>;

beforeEach(async () => {
  await t.resetAll();
  store.objects.clear();
  await setSharedCode(t.db, "view", VIEW_CODE);
  await addAdmin(t.db, "Mum", MUM_CODE);
  admin = t.browser();
  viewer = t.browser();
  await admin.post("/api/access/admin", { code: MUM_CODE });
  await viewer.post("/api/access/view", { code: VIEW_CODE });
  const people = (await viewer.get("/api/people")).body as PersonDto[];
  peopleBySlug = Object.fromEntries(people.map((p) => [p.slug, p]));
});

afterAll(async () => {
  await t.pool.end();
});

/** Presign → "browser upload" into the memory store → finalise. */
async function upload(body: Buffer, extra: Record<string, unknown> = {}, type = "image/jpeg") {
  const presign = await admin.post("/api/admin/uploads/presign", {
    files: [{ name: "photo.jpg", type, size: body.length }],
  });
  expect(presign.status).toBe(200);
  const { key } = presign.body.uploads[0];
  await store.putObject(key, body, type);
  return admin.post("/api/admin/photos", { key, originalFilename: "IMG_0001.jpg", ...extra });
}

describe("helpers", () => {
  it("parses EXIF dates as wall-clock time and rejects unset camera clocks", () => {
    expect(parseExifDate("2023:07:14 15:22:10")?.toISOString()).toBe("2023-07-14T15:22:10.000Z");
    expect(parseExifDate("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDate(undefined)).toBeNull();
  });

  it("identifies file types from their bytes, not their names", async () => {
    expect(sniffFormat(await makeJpeg())).toBe("jpeg");
    expect(sniffFormat(Buffer.from("definitely not an image"))).toBeNull();
    const heicHeader = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(sniffFormat(heicHeader)).toBe("heic");
  });

  it("makes readable slugs", () => {
    expect(slugify("Mum's Birthday 2026")).toBe("mums-birthday-2026");
    expect(slugify("Crème Brûlée!")).toBe("creme-brulee");
  });
});

describe("uploading", () => {
  it("is admin-only", async () => {
    const res = await viewer.post("/api/admin/uploads/presign", { files: [{ name: "a.jpg", type: "image/jpeg", size: 10 }] });
    expect(res.status).toBe(403);
  });

  it("rejects unsupported types and oversized files before upload", async () => {
    const gif = await admin.post("/api/admin/uploads/presign", { files: [{ name: "a.gif", type: "image/gif", size: 10 }] });
    expect(gif.status).toBe(400);
    const huge = await admin.post("/api/admin/uploads/presign", {
      files: [{ name: "a.jpg", type: "image/jpeg", size: 60 * 1024 * 1024 }],
    });
    expect(huge.status).toBe(400);
  });

  it("stores the original and three variants, reads the EXIF date, and removes the temporary upload", async () => {
    const res = await upload(await makeJpeg({ date: "2023:07:14 15:22:10" }));
    expect(res.status).toBe(201);
    const photo = res.body as PhotoDto;
    expect(photo.takenAt).toBe("2023-07-14T15:22:10");
    expect(photo.takenAtSource).toBe("exif");
    expect(photo.uploadedBy).toBe("Mum");
    expect(photo.width).toBe(600);
    expect(photo.blurhash).toBeTruthy();
    expect(photo.urls?.thumb).toMatch(/variants\/.+\/thumb\.webp/);

    expect(store.keys("uploads/")).toEqual([]);
    expect(store.keys("originals/")).toEqual([`originals/${photo.id}.jpg`]);
    expect(store.keys(`variants/${photo.id}/`)).toHaveLength(3);
    const thumb = await sharp(store.objects.get(`variants/${photo.id}/thumb.webp`)!.body).metadata();
    expect(thumb.format).toBe("webp");
    expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(480);
  });

  it("respects the EXIF orientation when recording dimensions", async () => {
    const res = await upload(await makeJpeg({ orientation: 6 }));
    expect(res.body.width).toBe(400);
    expect(res.body.height).toBe(600);
  });

  it("lets the uploader set the date manually, overriding EXIF", async () => {
    const res = await upload(await makeJpeg({ date: "2023:07:14 15:22:10" }), { takenAt: "2025-12-25" });
    expect(res.body.takenAt).toBe("2025-12-25T00:00:00");
    expect(res.body.takenAtSource).toBe("manual");
  });

  it("records an unknown date when there is no EXIF", async () => {
    const res = await upload(await makeJpeg());
    expect(res.body.takenAt).toBeNull();
    expect(res.body.takenAtSource).toBe("unknown");
  });

  it("rejects files that aren't really images and cleans up", async () => {
    const res = await upload(Buffer.from("this is a text file pretending to be a jpeg"));
    expect(res.status).toBe(422);
    expect(store.keys()).toEqual([]);
  });

  it("refuses to finalise a key that was never uploaded", async () => {
    const res = await admin.post("/api/admin/photos", {
      key: "uploads/00000000-0000-4000-8000-000000000000.jpg",
      originalFilename: "x.jpg",
    });
    expect(res.status).toBe(400);
  });

  it("refuses keys outside the uploads area", async () => {
    const res = await admin.post("/api/admin/photos", { key: "originals/secret.jpg", originalFilename: "x.jpg" });
    expect(res.status).toBe(400);
  });
});

describe("tagging", () => {
  it("shows one photo in every tagged person's profile without duplicating the file", async () => {
    const { dad, brother, family } = peopleBySlug;
    const res = await upload(await makeJpeg(), { personIds: [dad!.id, brother!.id, family!.id] });
    expect(res.body.people.map((p: { slug: string }) => p.slug).sort()).toEqual(["brother", "dad", "family"]);

    for (const person of [dad!, brother!, family!]) {
      const page = (await viewer.get(`/api/photos?personId=${person.id}`)).body as PhotoPage;
      expect(page.photos.map((p) => p.id)).toEqual([res.body.id]);
    }
    const mePerson = (await viewer.get(`/api/photos?personId=${peopleBySlug.me!.id}`)).body as PhotoPage;
    expect(mePerson.photos).toHaveLength(0);
    expect(store.keys("originals/")).toHaveLength(1);

    const people = (await viewer.get("/api/people")).body as PersonDto[];
    expect(people.find((p) => p.slug === "dad")!.photoCount).toBe(1);
    expect(people.find((p) => p.slug === "dad")!.previewUrls).toHaveLength(1);
  });

  it("combines filters and finds untagged photos", async () => {
    const travel = (await viewer.get("/api/categories")).body.find((c: { slug: string }) => c.slug === "travel");
    const a = await upload(await makeJpeg(), { personIds: [peopleBySlug.me!.id], categoryIds: [travel.id] });
    await upload(await makeJpeg(), { personIds: [peopleBySlug.me!.id] });
    const untagged = await upload(await makeJpeg());

    const both = (await viewer.get(`/api/photos?personId=${peopleBySlug.me!.id}&categoryId=${travel.id}`)).body;
    expect(both.photos.map((p: PhotoDto) => p.id)).toEqual([a.body.id]);
    const queue = (await viewer.get("/api/photos?untagged=true")).body;
    expect(queue.photos.map((p: PhotoDto) => p.id)).toEqual([untagged.body.id]);
  });

  it("replaces tags and metadata on edit, and only for admins", async () => {
    const res = await upload(await makeJpeg(), { personIds: [peopleBySlug.dad!.id] });
    const id = res.body.id;
    expect((await viewer.patch(`/api/admin/photos/${id}`, { caption: "hack" })).status).toBe(403);

    const edited = await admin.patch(`/api/admin/photos/${id}`, {
      caption: "Christmas morning",
      takenAt: "2025-12-25T08:15",
      personIds: [peopleBySlug["mum"]!.id],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.caption).toBe("Christmas morning");
    expect(edited.body.takenAt).toBe("2025-12-25T08:15:00");
    expect(edited.body.people.map((p: { slug: string }) => p.slug)).toEqual(["mum"]);
  });

  it("bulk-tags several photos at once", async () => {
    const a = await upload(await makeJpeg());
    const b = await upload(await makeJpeg());
    const res = await admin.post("/api/admin/photos/bulk-tag", {
      photoIds: [a.body.id, b.body.id],
      personIds: [peopleBySlug.family!.id],
    });
    expect(res.status).toBe(204);
    const page = (await viewer.get(`/api/photos?personId=${peopleBySlug.family!.id}`)).body;
    expect(page.photos).toHaveLength(2);
  });

  it("rejects tags that don't exist", async () => {
    const res = await upload(await makeJpeg(), { personIds: ["00000000-0000-4000-8000-000000000000"] });
    expect(res.status).toBe(400);
  });
});

describe("listing", () => {
  it("paginates with a cursor without repeating or skipping photos", async () => {
    for (const d of ["2020:01:01 10:00:00", "2021:01:01 10:00:00", "2022:01:01 10:00:00"]) {
      await upload(await makeJpeg({ date: d }));
    }
    const first = (await viewer.get("/api/photos?limit=2")).body as PhotoPage;
    expect(first.photos.map((p) => p.takenAt!.slice(0, 4))).toEqual(["2022", "2021"]);
    expect(first.nextCursor).toBeTruthy();
    const second = (await viewer.get(`/api/photos?limit=2&cursor=${first.nextCursor}`)).body as PhotoPage;
    expect(second.photos.map((p) => p.takenAt!.slice(0, 4))).toEqual(["2020"]);
    expect(second.nextCursor).toBeNull();

    const oldest = (await viewer.get("/api/photos?sort=oldest")).body as PhotoPage;
    expect(oldest.photos.map((p) => p.takenAt!.slice(0, 4))).toEqual(["2020", "2021", "2022"]);
  });

  it("requires viewing access", async () => {
    expect((await t.browser().get("/api/photos")).status).toBe(401);
    expect((await t.browser().get("/api/people")).status).toBe(401);
  });

  it("rejects a tampered cursor", async () => {
    expect((await viewer.get("/api/photos?cursor=bm9wZQ")).status).toBe(400);
  });
});

describe("deleting", () => {
  it("soft-deletes so photos can be restored, and keeps the files", async () => {
    const res = await upload(await makeJpeg(), { personIds: [peopleBySlug.dad!.id] });
    const id = res.body.id;
    expect((await viewer.post("/api/admin/photos/bulk-delete", { photoIds: [id] })).status).toBe(403);

    expect((await admin.post("/api/admin/photos/bulk-delete", { photoIds: [id] })).body.count).toBe(1);
    expect((await viewer.get("/api/photos")).body.photos).toHaveLength(0);
    expect((await viewer.get(`/api/photos/${id}`)).status).toBe(404);
    expect((await viewer.get("/api/people")).body.find((p: PersonDto) => p.slug === "dad").photoCount).toBe(0);
    expect((await viewer.get("/api/photos?deleted=true")).status).toBe(403);
    expect((await admin.get("/api/photos?deleted=true")).body.photos).toHaveLength(1);
    expect(store.keys("originals/")).toHaveLength(1);

    await admin.post("/api/admin/photos/bulk-restore", { photoIds: [id] });
    expect((await viewer.get("/api/photos")).body.photos).toHaveLength(1);
  });
});

describe("people, categories and events", () => {
  it("creates people with unique slugs, inline from the tag picker", async () => {
    const a = await admin.post("/api/admin/people", { name: "Grandma Ruth" });
    const b = await admin.post("/api/admin/people", { name: "Grandma Ruth" });
    expect(a.status).toBe(201);
    expect(a.body.slug).toBe("grandma-ruth");
    expect(b.body.slug).toBe("grandma-ruth-2");
    expect((await viewer.post("/api/admin/people", { name: "Nope" })).status).toBe(403);
  });

  it("only allows a cover photo that belongs to the collection", async () => {
    const tagged = await upload(await makeJpeg(), { personIds: [peopleBySlug.me!.id] });
    const other = await upload(await makeJpeg());
    const sealId = peopleBySlug.me!.id;
    expect((await admin.patch(`/api/admin/people/${sealId}`, { coverPhotoId: other.body.id })).status).toBe(400);
    expect((await admin.patch(`/api/admin/people/${sealId}`, { coverPhotoId: tagged.body.id })).status).toBe(204);
    const mePerson = (await viewer.get("/api/people")).body.find((p: PersonDto) => p.slug === "me");
    expect(mePerson.coverPhotoId).toBe(tagged.body.id);
  });

  it("deleting a category removes the tag but never the photos", async () => {
    const travel = (await viewer.get("/api/categories")).body.find((c: { slug: string }) => c.slug === "travel");
    const photo = await upload(await makeJpeg(), { categoryIds: [travel.id] });
    expect((await admin.delete(`/api/admin/categories/${travel.id}`)).status).toBe(204);
    const after = (await viewer.get(`/api/photos/${photo.body.id}`)).body as PhotoDto;
    expect(after.categories).toEqual([]);
    expect(store.keys("originals/")).toHaveLength(1);
  });

  it("creates events with dates, people and categories, and validates the date order", async () => {
    const bad = await admin.post("/api/admin/events", { name: "Trip", startsOn: "2026-06-10", endsOn: "2026-06-01" });
    expect(bad.status).toBe(400);

    const created = await admin.post("/api/admin/events", {
      name: "Scotland Trip 2026",
      startsOn: "2026-06-01",
      endsOn: "2026-06-10",
      personIds: [peopleBySlug.dad!.id, peopleBySlug.me!.id],
    });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe("scotland-trip-2026");
    await upload(await makeJpeg(), { eventIds: [created.body.id] });

    const [event] = (await viewer.get("/api/events")).body;
    expect(event.startsOn).toBe("2026-06-01");
    expect(event.people.map((p: { slug: string }) => p.slug)).toEqual(["dad", "me"]);
    expect(event.photoCount).toBe(1);
  });

  it("records admin activity", async () => {
    await upload(await makeJpeg());
    await admin.post("/api/admin/people", { name: "Uncle Tom" });
    const { rows } = await t.pool.query("select action from admin_activity_logs order by created_at");
    expect(rows.map((r: { action: string }) => r.action)).toEqual(["sign_in", "photo.upload", "person.create"]);
  });
});
