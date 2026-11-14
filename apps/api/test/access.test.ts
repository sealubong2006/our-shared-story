import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { accessSessions, adminActivityLogs, failedAttempts } from "../src/db/schema.js";
import { addAdmin, resetAdminCode, setAdminActive, setSharedCode } from "../src/services/codes.js";
import { setupTestApp } from "./helpers.js";

const VIEW_CODE = "maple-river-otter-42";
const DOWNLOAD_CODE = "amber-coast-lily-17";
const MUM_CODE = "fern-harbor-moss-pine-55";
const DAD_CODE = "cedar-lagoon-wren-tide-31";

const t = setupTestApp();

beforeEach(async () => {
  await t.reset();
  await setSharedCode(t.db, "view", VIEW_CODE);
  await setSharedCode(t.db, "download", DOWNLOAD_CODE);
  await addAdmin(t.db, "Mum", MUM_CODE);
  await addAdmin(t.db, "Dad", DAD_CODE);
});

afterAll(async () => {
  await t.pool.end();
});

describe("viewing access", () => {
  it("starts with no access", async () => {
    const res = await t.browser().get("/api/access/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ view: false, download: false, admin: null, share: false });
  });

  it("rejects a wrong code without setting a cookie", async () => {
    const res = await t.browser().post("/api/access/view", { code: "wrong-code-entirely" });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("grants view (but not download) for the viewing code, via an HttpOnly cookie", async () => {
    const b = t.browser();
    const res = await b.post("/api/access/view", { code: VIEW_CODE });
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/fa_view=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await b.get("/api/access/me");
    expect(me.body).toEqual({ view: true, download: false, admin: null, share: false });
  });

  it("accepts codes regardless of case and spacing", async () => {
    const res = await t.browser().post("/api/access/view", { code: "  Maple River Otter 42 " });
    expect(res.status).toBe(200);
  });

  it("does not accept the download or an admin code as a viewing code", async () => {
    expect((await t.browser().post("/api/access/view", { code: DOWNLOAD_CODE })).status).toBe(401);
    expect((await t.browser().post("/api/access/view", { code: MUM_CODE })).status).toBe(401);
  });

  it("validates the request body", async () => {
    const res = await t.browser().post("/api/access/view", {});
    expect(res.status).toBe(400);
  });
});

describe("download access", () => {
  it("requires viewing access first", async () => {
    const res = await t.browser().post("/api/access/download", { code: DOWNLOAD_CODE });
    expect(res.status).toBe(401);
  });

  it("is granted separately with the download code", async () => {
    const b = t.browser();
    await b.post("/api/access/view", { code: VIEW_CODE });
    expect((await b.post("/api/access/download", { code: VIEW_CODE })).status).toBe(401);
    const res = await b.post("/api/access/download", { code: DOWNLOAD_CODE });
    expect(res.status).toBe(200);
    expect((await b.get("/api/access/me")).body).toEqual({ view: true, download: true, admin: null, share: false });
  });
});

describe("admin access", () => {
  it("identifies which admin entered their code", async () => {
    const b = t.browser();
    const res = await b.post("/api/access/admin", { code: DAD_CODE });
    expect(res.status).toBe(200);
    const me = await b.get("/api/access/me");
    expect(me.body.admin.name).toBe("Dad");
    expect(me.body.view).toBe(true);
    expect(me.body.download).toBe(true);

    const log = await t.db.select().from(adminActivityLogs);
    expect(log).toHaveLength(1);
    expect(log[0]!.action).toBe("sign_in");
  });

  it("rejects the viewing code as an admin code", async () => {
    expect((await t.browser().post("/api/access/admin", { code: VIEW_CODE })).status).toBe(401);
  });

  it("refuses duplicate admin codes", async () => {
    await expect(addAdmin(t.db, "Sam", MUM_CODE)).rejects.toThrow(/already used/);
    await expect(addAdmin(t.db, "Sam", VIEW_CODE)).rejects.toThrow(/same as the view code/);
  });

  it("signs an admin out when their code is reset, without affecting other admins", async () => {
    const mum = t.browser();
    const dad = t.browser();
    await mum.post("/api/access/admin", { code: MUM_CODE });
    await dad.post("/api/access/admin", { code: DAD_CODE });

    await resetAdminCode(t.db, "Mum", "new-code-for-mum-99");

    expect((await mum.get("/api/access/me")).body.admin).toBeNull();
    expect((await dad.get("/api/access/me")).body.admin.name).toBe("Dad");
    expect((await t.browser().post("/api/access/admin", { code: MUM_CODE })).status).toBe(401);
    expect((await t.browser().post("/api/access/admin", { code: "new-code-for-mum-99" })).status).toBe(200);
  });

  it("blocks a disabled admin immediately", async () => {
    const mum = t.browser();
    await mum.post("/api/access/admin", { code: MUM_CODE });
    await setAdminActive(t.db, "Mum", false);
    expect((await mum.get("/api/access/me")).body.admin).toBeNull();
    expect((await t.browser().post("/api/access/admin", { code: MUM_CODE })).status).toBe(401);
  });
});

describe("code rotation and sign-out", () => {
  it("rotating the viewing code signs out every existing viewer", async () => {
    const b = t.browser();
    await b.post("/api/access/view", { code: VIEW_CODE });
    await setSharedCode(t.db, "view", "brand-new-view-code-12");
    expect((await b.get("/api/access/me")).body.view).toBe(false);
  });

  it("sign-out revokes the session on the server, not just the cookie", async () => {
    const b = t.browser();
    const res = await b.post("/api/access/view", { code: VIEW_CODE });
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;

    await b.post("/api/access/sign-out", { scope: "all" });
    expect((await b.get("/api/access/me")).body.view).toBe(false);

    // Replaying the old cookie must not work either.
    const replay = await request(t.app).get("/api/access/me").set("Cookie", cookie);
    expect(replay.body.view).toBe(false);
    const sessions = await t.db.select().from(accessSessions);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it("admin sign-out keeps the separate viewing session", async () => {
    const b = t.browser();
    await b.post("/api/access/view", { code: VIEW_CODE });
    await b.post("/api/access/admin", { code: MUM_CODE });
    await b.post("/api/access/sign-out", { scope: "admin" });
    expect((await b.get("/api/access/me")).body).toEqual({ view: true, download: false, admin: null, share: false });
  });

  it("ignores forged session cookies", async () => {
    const res = await request(t.app).get("/api/access/me").set("Cookie", "fa_admin=forged; fa_view=forged");
    expect(res.body).toEqual({ view: false, download: false, admin: null, share: false });
  });
});

describe("brute-force protection", () => {
  it("locks out after 5 wrong attempts, even for a correct code, and across code types", async () => {
    const b = t.browser();
    for (let i = 0; i < 5; i++) {
      expect((await b.post("/api/access/admin", { code: `guess-number-${i}` })).status).toBe(401);
    }
    const locked = await b.post("/api/access/view", { code: VIEW_CODE });
    expect(locked.status).toBe(429);
    expect(locked.body.retryAfter).toBeGreaterThan(0);
    expect(locked.headers["retry-after"]).toBeDefined();
  });

  it("does not reset the failure count after a successful entry", async () => {
    const b = t.browser();
    for (let i = 0; i < 4; i++) await b.post("/api/access/admin", { code: `guess-number-${i}` });
    expect((await b.post("/api/access/view", { code: VIEW_CODE })).status).toBe(200);
    await b.post("/api/access/admin", { code: "guess-number-5" });
    expect((await b.post("/api/access/admin", { code: MUM_CODE })).status).toBe(429);
  });

  it("unlocks once the window has passed", async () => {
    const b = t.browser();
    for (let i = 0; i < 5; i++) await b.post("/api/access/view", { code: `guess-number-${i}` });
    // Age the failures beyond the 15-minute window.
    await t.db.update(failedAttempts).set({ attemptedAt: new Date(Date.now() - 16 * 60 * 1000) });
    expect((await b.post("/api/access/view", { code: VIEW_CODE })).status).toBe(200);
  });

  it("stores only hashed IPs and hashed session tokens", async () => {
    const b = t.browser();
    const res = await b.post("/api/access/view", { code: VIEW_CODE });
    const token = String(res.headers["set-cookie"]).match(/fa_view=([^;]+)/)![1]!;
    const [row] = await t.db.select().from(accessSessions);
    expect(row!.idHash).not.toBe(token);
    expect(row!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    const byToken = await t.db.select().from(accessSessions).where(eq(accessSessions.idHash, token));
    expect(byToken).toHaveLength(0);
  });
});

describe("request hardening", () => {
  it("rejects state-changing requests without the CSRF header", async () => {
    const res = await request(t.app).post("/api/access/view").send({ code: VIEW_CODE });
    expect(res.status).toBe(403);
  });

  it("returns 503 before any viewing code has been set", async () => {
    await t.reset();
    const res = await t.browser().post("/api/access/view", { code: VIEW_CODE });
    expect(res.status).toBe(503);
  });
});
