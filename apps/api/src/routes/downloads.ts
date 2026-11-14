import { Router, type Request } from "express";
import { z } from "zod";
import { zipRequestSchema } from "@family-album/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { hashIp } from "../lib/crypto.js";
import type { ObjectStore } from "../lib/storage.js";
import { HttpError } from "../lib/errors.js";
import { requireDownload } from "../auth/middleware.js";
import { type Downloader, ZipTokens, singleDownloadUrl, streamZip } from "../services/downloads.js";

/** Downloads need the separate download code (or admin). The viewing code alone is never enough. */
export function downloadsRouter(db: Db, storage: ObjectStore | null, config: Config): Router {
  const router = Router();
  const zipTokens = new ZipTokens();
  router.use(requireDownload);

  const store = () => {
    if (!storage) throw new HttpError(503, "Photo storage isn't configured yet.");
    return storage;
  };
  const who = (req: Request): Downloader => ({
    sessionIdHash: req.access.sessionIdHash,
    adminId: req.access.admin?.id ?? null,
    ipHash: hashIp(req.ip, config.IP_HASH_SALT),
    userAgent: req.get("user-agent"),
  });

  router.get("/photos/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    res.set("Cache-Control", "no-store");
    res.json({ url: await singleDownloadUrl(db, store(), id, who(req)) });
  });

  router.post("/zip", (req, res) => {
    const { photoIds } = zipRequestSchema.parse(req.body);
    const token = zipTokens.issue(photoIds, req.access.sessionIdHash);
    res.json({ url: `/api/downloads/zip/${token}` });
  });

  router.get("/zip/:token", async (req, res) => {
    const photoIds = zipTokens.redeem(String(req.params.token), req.access.sessionIdHash);
    await streamZip(db, store(), photoIds, who(req), res);
  });

  return router;
}
