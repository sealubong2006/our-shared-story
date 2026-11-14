import { Router, type CookieOptions, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { codeEntrySchema, shareTokenSchema, type AccessState } from "@family-album/shared";
import { SESSION_TTL_MS, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { accessCodes, adminActivityLogs } from "../db/schema.js";
import { hashIp, verifyCode } from "../lib/crypto.js";
import { lockoutSeconds, recordFailure } from "../auth/lockout.js";
import { COOKIES, requireView } from "../auth/middleware.js";
import { createSession, revokeSession, type SessionScope } from "../auth/sessions.js";
import { findAdminByCode } from "../services/codes.js";
import { SHARE_SESSION_MAX_MS, findShareLink } from "../services/sharing.js";

const WRONG_CODE = "That code isn't right. Please check it and try again.";

export function accessRouter(db: Db, config: Config): Router {
  const router = Router();

  // Coarse in-memory limit in front of the database-backed lockout.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.ACCESS_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait a few minutes and try again." },
  });

  const cookieOptions = (maxAge: number): CookieOptions => ({
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  const state = (req: Request, patch: Partial<AccessState> = {}): AccessState => ({
    view: req.access.view,
    download: req.access.download,
    admin: req.access.admin,
    share: req.access.share,
    ...patch,
  });

  /** Shared flow: lockout check → verify → record failure or create session + cookie. */
  async function enter(
    req: Request,
    res: Response,
    scope: Exclude<SessionScope, "share">,
    verify: (code: string) => Promise<{ codeVersion: number; adminId?: string } | null | "not-configured">,
    onSuccess: () => Partial<AccessState>,
  ) {
    const { code } = codeEntrySchema.parse(req.body);
    const ipHash = hashIp(req.ip, config.IP_HASH_SALT);

    const wait = await lockoutSeconds(db, ipHash);
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: "Too many incorrect attempts. Please wait and try again.", retryAfter: wait });
    }

    const result = await verify(code);
    if (result === "not-configured") {
      return res.status(503).json({ error: "The album hasn't been set up yet." });
    }
    if (!result) {
      await recordFailure(db, ipHash, scope);
      return res.status(401).json({ error: WRONG_CODE });
    }

    const token = await createSession(db, {
      scope,
      codeVersion: result.codeVersion,
      adminId: result.adminId,
      ttlMs: SESSION_TTL_MS[scope],
      ipHash,
      userAgent: req.get("user-agent"),
    });
    res.cookie(COOKIES[scope], token, cookieOptions(SESSION_TTL_MS[scope]));
    return res.json(state(req, onSuccess()));
  }

  async function verifySharedCode(scope: "view" | "download", code: string) {
    const [row] = await db.select().from(accessCodes).where(eq(accessCodes.scope, scope)).limit(1);
    if (!row) return "not-configured" as const;
    return (await verifyCode(code, row.codeHash)) ? { codeVersion: row.version } : null;
  }

  router.get("/me", (req, res) => {
    res.json(state(req));
  });

  router.post("/view", limiter, (req, res) =>
    enter(req, res, "view", (code) => verifySharedCode("view", code), () => ({ view: true })),
  );

  router.post("/download", limiter, requireView, (req, res) =>
    enter(req, res, "download", (code) => verifySharedCode("download", code), () => ({ download: true })),
  );

  router.post("/admin", limiter, async (req, res) => {
    const signedIn: { current: { id: string; name: string } | null } = { current: null };
    await enter(
      req,
      res,
      "admin",
      async (code) => {
        const admin = await findAdminByCode(db, code);
        if (!admin) return null;
        signedIn.current = { id: admin.id, name: admin.name };
        return { codeVersion: admin.codeVersion, adminId: admin.id };
      },
      () => ({ view: true, download: true, admin: signedIn.current }),
    );
    if (signedIn.current) {
      await db.insert(adminActivityLogs).values({ adminId: signedIn.current.id, action: "sign_in" });
    }
  });

  /**
   * Opening a share link: the token from the URL becomes a view-only session limited to
   * that link. Unknown tokens count as failed attempts (the same lockout as codes);
   * expired or revoked ones don't, since they aren't guesses.
   */
  router.post("/share", limiter, async (req, res) => {
    const { token } = shareTokenSchema.parse(req.body);
    const ipHash = hashIp(req.ip, config.IP_HASH_SALT);
    const wait = await lockoutSeconds(db, ipHash);
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: "Too many attempts. Please wait and try again.", retryAfter: wait });
    }
    const link = await findShareLink(db, token);
    if (link === null) {
      await recordFailure(db, ipHash, "share");
      return res.status(404).json({ error: "This link isn't valid. Please check you copied all of it." });
    }
    if (link === "gone") {
      return res.status(410).json({ error: "This link has expired or been switched off. Ask the family for a new one." });
    }
    const ttl = Math.min(SHARE_SESSION_MAX_MS, link.expiresAt ? link.expiresAt.getTime() - Date.now() : SHARE_SESSION_MAX_MS);
    const session = await createSession(db, {
      scope: "share",
      codeVersion: 1,
      shareLinkId: link.id,
      ttlMs: ttl,
      ipHash,
      userAgent: req.get("user-agent"),
    });
    res.cookie(COOKIES.share, session, cookieOptions(ttl));
    return res.json(state(req, { share: true }));
  });

  const signOutSchema = z.object({ scope: z.enum(["admin", "all"]).default("all") });

  /** Revokes the sessions server-side (not just the cookies). Client re-fetches /me afterwards. */
  router.post("/sign-out", async (req, res) => {
    const { scope } = signOutSchema.parse(req.body ?? {});
    const cookies = req.cookies as Record<string, string | undefined>;
    const names = scope === "admin" ? (["admin"] as const) : (["admin", "download", "view", "share"] as const);
    for (const name of names) {
      await revokeSession(db, cookies[COOKIES[name]]);
      res.clearCookie(COOKIES[name], { path: "/" });
    }
    res.status(204).end();
  });

  return router;
}
