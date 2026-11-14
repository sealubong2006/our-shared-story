import { Router } from "express";
import { z } from "zod";
import { photoListQuerySchema } from "@family-album/shared";
import type { Db } from "../db/client.js";
import type { ObjectStore } from "../lib/storage.js";
import { HttpError } from "../lib/errors.js";
import { requireView } from "../auth/middleware.js";
import { getPhoto, listPhotos, setFavourite, timelineSummary } from "../services/photos.js";
import { listCategories, listEvents, listPeople } from "../services/collections.js";

/** Read-only endpoints for anyone with viewing access. */
export function libraryRouter(db: Db, storage: ObjectStore | null): Router {
  const router = Router();
  router.use(requireView);

  router.get("/photos", async (req, res) => {
    const query = photoListQuerySchema.parse(req.query);
    if (query.deleted === "true" && !req.access.admin) throw new HttpError(403, "Admin access required.");
    res.json(await listPhotos(db, storage, query));
  });

  router.get("/photos/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    res.json(await getPhoto(db, storage, id, Boolean(req.access.admin)));
  });

  router.put("/photos/:id/favourite", async (req, res) => {
    await setFavourite(db, z.uuid().parse(req.params.id), true);
    res.status(204).end();
  });

  router.delete("/photos/:id/favourite", async (req, res) => {
    await setFavourite(db, z.uuid().parse(req.params.id), false);
    res.status(204).end();
  });

  router.get("/timeline", async (_req, res) => {
    res.json(await timelineSummary(db));
  });

  router.get("/people", async (_req, res) => {
    res.json(await listPeople(db, storage));
  });

  router.get("/categories", async (_req, res) => {
    res.json(await listCategories(db, storage));
  });

  router.get("/events", async (_req, res) => {
    res.json(await listEvents(db, storage));
  });

  return router;
}
