import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { EventDto, PersonDto, PhotoDto, PhotoPage, TimelineSummary } from "@family-album/shared";
import { addAdmin, setSharedCode } from "../src/services/codes.js";
import { MemoryStore } from "./memory-store.js";
import { setupTestApp } from "./helpers.js";
import { seed } from "../src/db/seed.js";

const store = new MemoryStore();
const t = setupTestApp(store);

let admin: ReturnType<typeof t.browser>;
let viewer: ReturnType<typeof t.browser>;
let people: Record<string, PersonDto>;

async function jpeg(date?: string) {
  let img = sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 140, b: 160 } } });
  if (date) img = img.withExif({ IFD2: { DateTimeOriginal: date } });
  return img.jpeg().toBuffer();
}

async function upload(date?: string, extra: Record<string, unknown> = {}): Promise<PhotoDto> {
  const body = await jpeg(date);
  const presign = await admin.post("/api/admin/uploads/presign", { files: [{ name: "p.jpg", type: "image/jpeg", size: body.length }] });
  const { key } = presign.body.uploads[0];
  await store.putObject(key, body, "image/jpeg");
  const res = await admin.post("/api/admin/photos", { key, originalFilename: "p.jpg", ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

beforeEach(async () => {
  await t.resetAll();
  store.objects.clear();
  await setSharedCode(t.db, "view", "maple-river-otter-42");
  await addAdmin(t.db, "Dad", "cedar-lagoon-wren-tide-31");
  admin = t.browser();
  viewer = t.browser();
  await admin.post("/api/access/admin", { code: "cedar-lagoon-wren-tide-31" });
  await viewer.post("/api/access/view", { code: "maple-river-otter-42" });
  people = Object.fromEntries(((await viewer.get("/api/people")).body as PersonDto[]).map((p) => [p.slug, p]));
});

afterAll(async () => {
  await t.pool.end();
});

describe("favourites (one shared family list)", () => {
  it("lets any viewer add and remove favourites, shown to everyone", async () => {
    const photo = await upload();
    const res = await viewer.agent.put(`/api/photos/${photo.id}/favourite`).set("x-family-album", "1");
    expect(res.status).toBe(204);

    const list = (await admin.get("/api/photos?favourites=true")).body as PhotoPage;
    expect(list.photos.map((p) => p.id)).toEqual([photo.id]);
    expect(list.photos[0]!.isFavourite).toBe(true);

    await viewer.agent.delete(`/api/photos/${photo.id}/favourite`).set("x-family-album", "1");
    expect((await viewer.get("/api/photos?favourites=true")).body.photos).toHaveLength(0);
  });

  it("requires viewing access and the CSRF header", async () => {
    const photo = await upload();
    expect((await t.browser().agent.put(`/api/photos/${photo.id}/favourite`).set("x-family-album", "1")).status).toBe(401);
    expect((await viewer.agent.put(`/api/photos/${photo.id}/favourite`)).status).toBe(403);
  });

  it("cannot favourite a deleted photo", async () => {
    const photo = await upload();
    await admin.post("/api/admin/photos/bulk-delete", { photoIds: [photo.id] });
    expect((await viewer.agent.put(`/api/photos/${photo.id}/favourite`).set("x-family-album", "1")).status).toBe(404);
  });
});

describe("date filters and timeline", () => {
  beforeEach(async () => {
    await upload("2024:12:24 20:00:00");
    await upload("2024:12:25 09:00:00");
    await upload("2025:01:01 00:30:00");
    await upload(); // undated
  });

  it("filters by year, month and specific day using the capture date", async () => {
    const year = (await viewer.get("/api/photos?from=2024-01-01&to=2024-12-31")).body as PhotoPage;
    expect(year.photos.map((p) => p.takenAt)).toEqual(["2024-12-25T09:00:00", "2024-12-24T20:00:00"]);
    const day = (await viewer.get("/api/photos?from=2024-12-25&to=2024-12-25")).body as PhotoPage;
    expect(day.photos.map((p) => p.takenAt)).toEqual(["2024-12-25T09:00:00"]);
    const undated = (await viewer.get("/api/photos?undated=true")).body as PhotoPage;
    expect(undated.photos).toHaveLength(1);
    expect(undated.photos[0]!.takenAt).toBeNull();
  });

  it("puts undated photos last when newest-first, and first when oldest-first", async () => {
    const newest = (await viewer.get("/api/photos?limit=2")).body as PhotoPage;
    expect(newest.photos[0]!.takenAt).toBe("2025-01-01T00:30:00");
    const rest = (await viewer.get(`/api/photos?limit=10&cursor=${newest.nextCursor}`)).body as PhotoPage;
    expect(rest.photos.map((p) => p.takenAt)).toEqual(["2024-12-24T20:00:00", null]);
    const oldest = (await viewer.get("/api/photos?sort=oldest")).body as PhotoPage;
    expect(oldest.photos[0]!.takenAt).toBeNull();
  });

  it("summarises photo counts per month, newest first", async () => {
    const summary = (await viewer.get("/api/timeline")).body as TimelineSummary;
    expect(summary.months).toEqual([
      { year: 2025, month: 1, count: 1 },
      { year: 2024, month: 12, count: 2 },
    ]);
    expect(summary.undatedCount).toBe(1);
  });

  it("rejects malformed dates", async () => {
    expect((await viewer.get("/api/photos?from=25-12-2024")).status).toBe(400);
  });
});

describe("events", () => {
  it("lists people tagged in an event's photos as well as those linked by hand", async () => {
    const event = (await admin.post("/api/admin/events", { name: "Christmas 2024", personIds: [people.dad!.id] })).body;
    await upload("2024:12:25 09:00:00", { eventIds: [event.id], personIds: [people.brother!.id] });
    const [e] = (await viewer.get("/api/events")).body as EventDto[];
    expect(e!.people.map((p) => p.slug)).toEqual(["dad"]);
    expect(e!.taggedPeople.map((p) => p.slug)).toEqual(["brother"]);
  });
});

describe("starter people and editing", () => {
  it("starts with generic placeholder people, in order", () => {
    expect(Object.keys(people)).toEqual(["family", "dad", "mum", "brother", "sister", "me"]);
  });

  it("renaming a placeholder gives it the real name and page address", async () => {
    const res = await admin.patch(`/api/admin/people/${people.sister!.id}`, { name: "Rosie" });
    expect(res.status).toBe(204);
    const after = (await viewer.get("/api/people")).body as PersonDto[];
    expect(after.find((p) => p.id === people.sister!.id)).toMatchObject({ name: "Rosie", slug: "rosie" });
  });

  it("re-running the starter data (every deploy) never brings back a deleted person", async () => {
    expect((await admin.delete(`/api/admin/people/${people.brother!.id}`)).status).toBe(204);
    await seed(t.db);
    const after = (await viewer.get("/api/people")).body as PersonDto[];
    expect(after.map((p) => p.slug)).not.toContain("brother");
  });
});
