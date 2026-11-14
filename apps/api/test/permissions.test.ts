import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { PersonDto, PhotoDto, PhotoPage } from "@family-album/shared";
import { downloadAuditLogs, photos, shareLinks } from "../src/db/schema.js";
import { addAdmin, setSharedCode } from "../src/services/codes.js";
import { purgeDeletedPhotos } from "../src/services/purge.js";
import { MemoryStore } from "./memory-store.js";
import { setupTestApp } from "./helpers.js";

const store = new MemoryStore();
const t = setupTestApp(store);

const VIEW = "maple-river-otter-42";
const DOWNLOAD = "amber-coast-lily-17";
const MUM = "fern-harbor-moss-pine-55";
const DAD = "cedar-lagoon-wren-tide-31";

let mum: ReturnType<typeof t.browser>;
let viewer: ReturnType<typeof t.browser>;
let people: Record<string, PersonDto>;

async function upload(extra: Record<string, unknown> = {}, name = "IMG_0001.HEIC.jpg"): Promise<PhotoDto> {
  const body = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#996655" } }).jpeg().toBuffer();
  const presign = await mum.post("/api/admin/uploads/presign", { files: [{ name: "a.jpg", type: "image/jpeg", size: body.length }] });
  const { key } = presign.body.uploads[0];
  await store.putObject(key, body, "image/jpeg");
  const res = await mum.post("/api/admin/photos", { key, originalFilename: name, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

beforeEach(async () => {
  await t.resetAll();
  store.objects.clear();
  await setSharedCode(t.db, "view", VIEW);
  await setSharedCode(t.db, "download", DOWNLOAD);
  await addAdmin(t.db, "Mum", MUM);
  await addAdmin(t.db, "Dad", DAD);
  mum = t.browser();
  viewer = t.browser();
  await mum.post("/api/access/admin", { code: MUM });
  await viewer.post("/api/access/view", { code: VIEW });
  people = Object.fromEntries(((await viewer.get("/api/people")).body as PersonDto[]).map((p) => [p.slug, p]));
});

afterAll(async () => {
  await t.pool.end();
});

describe("downloads", () => {
  it("are refused with only the viewing code, and allowed after the download code", async () => {
    const photo = await upload();
    expect((await viewer.get(`/api/downloads/photos/${photo.id}`)).status).toBe(403);

    await viewer.post("/api/access/download", { code: DOWNLOAD });
    const res = await viewer.get(`/api/downloads/photos/${photo.id}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain(`originals/${photo.id}.jpg`);
    expect(res.headers["cache-control"]).toBe("no-store");

    const [log] = await t.db.select().from(downloadAuditLogs);
    expect(log).toMatchObject({ kind: "single", photoId: photo.id, adminId: null, photoCount: 1 });
  });

  it("are never available to someone with no access", async () => {
    const photo = await upload();
    expect((await t.browser().get(`/api/downloads/photos/${photo.id}`)).status).toBe(403);
  });

  it("are allowed for admins without the download code, and logged with their name", async () => {
    const photo = await upload();
    expect((await mum.get(`/api/downloads/photos/${photo.id}`)).status).toBe(200);
    const logs = (await mum.get("/api/admin/downloads")).body;
    expect(logs[0].who).toBe("Mum (admin)");
    expect((await viewer.get("/api/admin/downloads")).status).toBe(403);
  });

  it("refuse deleted photos", async () => {
    const photo = await upload();
    await mum.post("/api/admin/photos/bulk-delete", { photoIds: [photo.id] });
    expect((await mum.get(`/api/downloads/photos/${photo.id}`)).status).toBe(404);
  });

  it("stream a ZIP through a one-time token bound to the session", async () => {
    const a = await upload({}, "beach.jpg");
    const b = await upload({}, "beach.jpg");
    await viewer.post("/api/access/download", { code: DOWNLOAD });

    const start = await viewer.post("/api/downloads/zip", { photoIds: [a.id, b.id] });
    expect(start.status).toBe(200);
    const url = start.body.url as string;

    // Another browser can't use the token.
    const other = t.browser();
    await other.post("/api/access/view", { code: VIEW });
    await other.post("/api/access/download", { code: DOWNLOAD });
    expect((await other.get(url)).status).toBe(403);

    // That attempt used it up, so start again for the real download.
    const again = await viewer.post("/api/downloads/zip", { photoIds: [a.id, b.id] });
    const zip = await viewer.agent.get(again.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(zip.status).toBe(200);
    expect(zip.headers["content-type"]).toBe("application/zip");
    const body = zip.body as Buffer;
    expect(body.subarray(0, 2).toString()).toBe("PK");
    // Duplicate names are made unique inside the ZIP.
    expect(body.includes(Buffer.from("beach.jpg"))).toBe(true);
    expect(body.includes(Buffer.from("beach (2).jpg"))).toBe(true);

    // Tokens are single-use.
    expect((await viewer.get(again.body.url)).status).toBe(403);
  });

  it("limit the size of a ZIP", async () => {
    await viewer.post("/api/access/download", { code: DOWNLOAD });
    const ids = Array.from({ length: 201 }, () => crypto.randomUUID());
    expect((await viewer.post("/api/downloads/zip", { photoIds: ids })).status).toBe(400);
  });
});

describe("share links", () => {
  async function shareEvent() {
    const event = (await mum.post("/api/admin/events", { name: "Christmas 2025" })).body;
    const inEvent = await upload({ eventIds: [event.id], personIds: [people.dad!.id] });
    const outside = await upload();
    const link = await mum.post("/api/admin/share-links", {
      label: "Christmas for Grandma",
      targetType: "event",
      targetId: event.id,
      expiresInDays: 30,
    });
    expect(link.status).toBe(201);
    return { event, inEvent, outside, link: link.body };
  }

  it("can only be created by admins", async () => {
    const res = await viewer.post("/api/admin/share-links", { label: "x", targetType: "selection", photoIds: [], expiresInDays: null });
    expect(res.status).toBe(403);
  });

  it("show only the shared photos, without tags, and nothing else in the album", async () => {
    const { inEvent, outside, link } = await shareEvent();
    const guest = t.browser();
    const opened = await guest.post("/api/access/share", { token: link.path.split("/").pop() });
    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({ view: false, download: false, admin: null, share: true });

    const info = (await guest.get("/api/share")).body;
    // Visitors see the event's name, never the admin-only link label.
    expect(info).toMatchObject({ title: "Christmas 2025", photoCount: 1 });
    expect(JSON.stringify(info)).not.toContain("Grandma");
    const page = (await guest.get("/api/share/photos")).body as PhotoPage;
    expect(page.photos.map((p) => p.id)).toEqual([inEvent.id]);
    expect(page.photos[0]!.people).toEqual([]);
    expect(page.photos[0]!.uploadedBy).toBeNull();

    // The rest of the album stays closed.
    expect((await guest.get("/api/photos")).status).toBe(401);
    expect((await guest.get(`/api/photos/${outside.id}`)).status).toBe(401);
    expect((await guest.get("/api/people")).status).toBe(401);
    expect((await guest.agent.put(`/api/photos/${inEvent.id}/favourite`).set("x-family-album", "1")).status).toBe(401);
    // …and downloads are never granted through a link, even with the download code.
    expect((await guest.get(`/api/downloads/photos/${inEvent.id}`)).status).toBe(403);
    expect((await guest.post("/api/access/download", { code: DOWNLOAD })).status).toBe(401);
  });

  it("share a hand-picked selection", async () => {
    const a = await upload();
    await upload();
    const link = (await mum.post("/api/admin/share-links", { label: "Two for Auntie", targetType: "selection", photoIds: [a.id], expiresInDays: null })).body;
    expect(link.targetName).toBe("1 selected photo");
    const guest = t.browser();
    await guest.post("/api/access/share", { token: link.path.split("/").pop() });
    expect(((await guest.get("/api/share/photos")).body as PhotoPage).photos.map((p) => p.id)).toEqual([a.id]);
  });

  it("stop working immediately when revoked, including for people already looking", async () => {
    const { link } = await shareEvent();
    const token = link.path.split("/").pop();
    const guest = t.browser();
    await guest.post("/api/access/share", { token });
    expect((await guest.get("/api/share/photos")).status).toBe(200);

    expect((await mum.post(`/api/admin/share-links/${link.id}/revoke`)).status).toBe(204);
    expect((await guest.get("/api/share/photos")).status).toBe(401);
    expect((await t.browser().post("/api/access/share", { token })).status).toBe(410);
    expect((await mum.get("/api/admin/share-links")).body[0].status).toBe("revoked");
  });

  it("stop working when they expire", async () => {
    const { link } = await shareEvent();
    const guest = t.browser();
    await guest.post("/api/access/share", { token: link.path.split("/").pop() });
    await t.db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, link.id));
    expect((await guest.get("/api/share/photos")).status).toBe(401);
    expect((await mum.get("/api/admin/share-links")).body[0].status).toBe("expired");
  });

  it("count unknown tokens as failed attempts but not expired ones", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await viewer.post("/api/access/share", { token: `made-up-token-number-${i}-xxxxxxxx` })).status).toBe(404);
    }
    expect((await viewer.post("/api/access/share", { token: "made-up-token-number-6-xxxxxxxx" })).status).toBe(429);
  });

  it("only store a hash of the token", async () => {
    const { link } = await shareEvent();
    const token = link.path.split("/").pop();
    const [row] = await t.db.select().from(shareLinks);
    expect(row!.tokenHash).not.toBe(token);
    expect((await mum.get("/api/admin/share-links")).body[0].path).toBeUndefined();
  });
});

describe("code and admin management", () => {
  it("is admin-only", async () => {
    expect((await viewer.get("/api/admin/settings")).status).toBe(403);
    expect((await viewer.post("/api/admin/codes/view", {})).status).toBe(403);
    expect((await viewer.post("/api/admin/admins", { name: "Hacker" })).status).toBe(403);
  });

  it("rotates the viewing code, returning it once and signing out existing viewers", async () => {
    const res = await mum.post("/api/admin/codes/view", {});
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
    expect((await viewer.get("/api/access/me")).body.view).toBe(false);
    expect((await t.browser().post("/api/access/view", { code: VIEW })).status).toBe(401);
    expect((await t.browser().post("/api/access/view", { code: res.body.code })).status).toBe(200);
    const settings = (await mum.get("/api/admin/settings")).body;
    expect(settings.codes.view.rotatedAt).toBeTruthy();
    expect(JSON.stringify(settings)).not.toContain(res.body.code);
  });

  it("accepts a chosen code but enforces the rules", async () => {
    expect((await mum.post("/api/admin/codes/download", { code: "short" })).status).toBe(400);
    expect((await mum.post("/api/admin/codes/download", { code: VIEW })).status).toBe(400);
    expect((await mum.post("/api/admin/codes/download", { code: "our new download words" })).body.code).toBe("our new download words");
  });

  it("adds admins, resets their codes, and won't let you lock yourself out", async () => {
    const added = await mum.post("/api/admin/admins", { name: "Sam" });
    expect(added.status).toBe(201);
    const settings = (await mum.get("/api/admin/settings")).body;
    const me = settings.admins.find((a: { name: string }) => a.name === "Mum");
    const sam = settings.admins.find((a: { name: string }) => a.name === "Sam");
    expect(me.isYou).toBe(true);

    expect((await mum.patch(`/api/admin/admins/${me.id}`, { active: false })).status).toBe(400);

    const sealBrowser = t.browser();
    expect((await sealBrowser.post("/api/access/admin", { code: added.body.code })).status).toBe(200);
    const reset = await mum.post(`/api/admin/admins/${sam.id}/reset-code`, {});
    expect((await sealBrowser.get("/api/access/me")).body.admin).toBeNull();
    expect((await t.browser().post("/api/access/admin", { code: reset.body.code })).status).toBe(200);
  });

  it("signs out every family device without touching admins", async () => {
    const res = await mum.post("/api/admin/sessions/revoke", { scope: "visitors" });
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect((await viewer.get("/api/access/me")).body.view).toBe(false);
    expect((await mum.get("/api/access/me")).body.admin.name).toBe("Mum");
  });

  it("logs admin actions for the activity list", async () => {
    await mum.post("/api/admin/codes/view", {});
    const activity = (await mum.get("/api/admin/activity")).body;
    expect(activity[0]).toMatchObject({ adminName: "Mum", action: "code.rotate_view" });
  });
});

describe("permanent removal after 30 days", () => {
  it("deletes files and rows only for photos deleted more than 30 days ago", async () => {
    const old = await upload();
    const recent = await upload();
    await mum.post("/api/admin/photos/bulk-delete", { photoIds: [old.id, recent.id] });
    await t.db.update(photos).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(photos.id, old.id));

    expect(await purgeDeletedPhotos(t.db, store)).toBe(1);
    expect(store.keys().some((k) => k.includes(old.id))).toBe(false);
    expect(store.keys().some((k) => k.includes(recent.id))).toBe(true);
    const remaining = await t.db.select({ id: photos.id }).from(photos);
    expect(remaining.map((r) => r.id)).toEqual([recent.id]);
  });
});

describe("hardening", () => {
  it("rejects requests without cookies on every protected area", async () => {
    for (const path of ["/api/photos", "/api/timeline", "/api/share", "/api/admin/settings", "/api/downloads/photos/x"]) {
      const res = await request(t.app).get(path);
      expect([401, 403]).toContain(res.status);
    }
  });
});
