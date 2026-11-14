import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CSRF_HEADER, CSRF_HEADER_VALUE, type AccessState } from "@family-album/shared";
import { SESSION_TTL_MS } from "../config.js";
import type { Db } from "../db/client.js";
import { resolveSession } from "./sessions.js";
import { liveLinkById } from "../services/sharing.js";

export const COOKIES = {
  view: "fa_view",
  download: "fa_download",
  admin: "fa_admin",
  share: "fa_share",
} as const;

type ShareLinkRow = NonNullable<Awaited<ReturnType<typeof liveLinkById>>>;

export interface RequestAccess extends AccessState {
  sessionIdHash: string | null;
  /** The share link this browser opened, when still valid. */
  shareLink: ShareLinkRow | null;
}

declare module "express-serve-static-core" {
  interface Request {
    access: RequestAccess;
  }
}

/**
 * Works out what this browser may do from its cookies. Admin implies view and download;
 * a download session only counts while the viewer still has viewing access.
 */
export function loadAccess(db: Db): RequestHandler {
  return async (req, _res, next) => {
    try {
      const cookies = req.cookies as Record<string, string | undefined>;
      const [view, download, admin, share] = await Promise.all([
        resolveSession(db, cookies[COOKIES.view], "view", SESSION_TTL_MS.view),
        resolveSession(db, cookies[COOKIES.download], "download"),
        resolveSession(db, cookies[COOKIES.admin], "admin"),
        resolveSession(db, cookies[COOKIES.share], "share"),
      ]);
      const shareLink = share?.shareLinkId ? await liveLinkById(db, share.shareLinkId) : null;
      const canView = Boolean(view || admin);
      req.access = {
        view: canView,
        download: Boolean(admin || (canView && download)),
        admin: admin?.admin ?? null,
        share: Boolean(shareLink),
        shareLink,
        sessionIdHash: admin?.idHash ?? download?.idHash ?? view?.idHash ?? null,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

function deny(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

export const requireView: RequestHandler = (req, res, next) =>
  req.access.view ? next() : deny(res, 401, "Enter the family code to view the album.");

export const requireDownload: RequestHandler = (req, res, next) =>
  req.access.download ? next() : deny(res, 403, "Enter the download code to download photos.");

export const requireAdmin: RequestHandler = (req, res, next) =>
  req.access.admin ? next() : deny(res, 403, "Admin access required.");

/**
 * CSRF defence in depth: cookies are SameSite=Lax, and every state-changing request must
 * also carry a custom header, which a cross-site form or image tag cannot add.
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) === CSRF_HEADER_VALUE) return next();
  deny(res, 403, "Missing request header.");
}
