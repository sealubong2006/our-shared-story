import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db/client.js";
import type { ObjectStore } from "../lib/storage.js";
import { listSharedPhotos, sharedInfo } from "../services/sharing.js";

const requireShare: RequestHandler = (req, res, next) =>
  req.access.shareLink
    ? next()
    : res.status(401).json({ error: "This link has expired or been switched off. Ask the family for a new one." });

/** What someone who opened a share link can see: that link's photos, and nothing else. */
export function shareRouter(db: Db, storage: ObjectStore | null): Router {
  const router = Router();
  router.use(requireShare);

  router.get("/", async (req, res) => {
    res.json(await sharedInfo(db, req.access.shareLink!));
  });

  router.get("/photos", async (req, res) => {
    const cursor = z.string().max(200).optional().parse(req.query.cursor);
    res.json(await listSharedPhotos(db, storage, req.access.shareLink!, cursor));
  });

  return router;
}
