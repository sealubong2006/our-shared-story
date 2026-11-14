import { Router, type Request } from "express";
import { z } from "zod";
import {
  addAdminSchema,
  createShareLinkSchema,
  newCodeSchema,
  revokeSessionsSchema,
  setAdminActiveSchema,
  bulkPhotoIdsSchema,
  bulkTagSchema,
  createCollectionSchema,
  createEventSchema,
  finaliseUploadSchema,
  presignSchema,
  updateCollectionSchema,
  updateEventSchema,
  updatePhotoSchema,
} from "@family-album/shared";
import type { Db } from "../db/client.js";
import type { ObjectStore } from "../lib/storage.js";
import { HttpError } from "../lib/errors.js";
import { requireAdmin } from "../auth/middleware.js";
import { bulkTag, finaliseUpload, presignUploads, setPhotosDeleted, updatePhoto } from "../services/photos.js";
import {
  createCollection,
  createEvent,
  deleteCollection,
  updateCollection,
  updateEvent,
} from "../services/collections.js";
import { createShareLink, listShareLinks, revokeShareLink } from "../services/sharing.js";
import { recentDownloads } from "../services/downloads.js";
import { logActivity } from "../services/activity.js";
import { backupDownloadName, exportDatabase, listBackups } from "../services/backup.js";
import {
  changeAdminActive,
  createAdmin,
  recentActivity,
  resetAdmin,
  revokeVisitorSessions,
  rotateSharedCode,
  settingsOverview,
} from "../services/settings.js";

const idParam = (req: Request) => z.uuid("Invalid id").parse(req.params.id);

/** Everything that changes the album. Every route requires an admin session. */
export function adminRouter(db: Db, storage: ObjectStore | null): Router {
  const router = Router();
  router.use(requireAdmin);

  const adminId = (req: Request) => req.access.admin!.id;
  const store = () => {
    if (!storage) throw new HttpError(503, "Photo storage isn't configured yet.");
    return storage;
  };

  // ---- uploads & photos
  router.post("/uploads/presign", async (req, res) => {
    const { files } = presignSchema.parse(req.body);
    res.json({ uploads: await presignUploads(store(), files) });
  });

  router.post("/photos", async (req, res) => {
    const input = finaliseUploadSchema.parse(req.body);
    res.status(201).json(await finaliseUpload(db, store(), adminId(req), input));
  });

  router.patch("/photos/:id", async (req, res) => {
    res.json(await updatePhoto(db, storage, adminId(req), idParam(req), updatePhotoSchema.parse(req.body)));
  });

  router.post("/photos/bulk-tag", async (req, res) => {
    await bulkTag(db, adminId(req), bulkTagSchema.parse(req.body));
    res.status(204).end();
  });

  router.post("/photos/bulk-delete", async (req, res) => {
    const { photoIds } = bulkPhotoIdsSchema.parse(req.body);
    res.json({ count: await setPhotosDeleted(db, adminId(req), photoIds, true) });
  });

  router.post("/photos/bulk-restore", async (req, res) => {
    const { photoIds } = bulkPhotoIdsSchema.parse(req.body);
    res.json({ count: await setPhotosDeleted(db, adminId(req), photoIds, false) });
  });

  // ---- people & categories
  for (const [path, kind] of [
    ["people", "person"],
    ["categories", "category"],
  ] as const) {
    router.post(`/${path}`, async (req, res) => {
      res.status(201).json(await createCollection(db, adminId(req), kind, createCollectionSchema.parse(req.body)));
    });
    router.patch(`/${path}/:id`, async (req, res) => {
      await updateCollection(db, adminId(req), kind, idParam(req), updateCollectionSchema.parse(req.body));
      res.status(204).end();
    });
    router.delete(`/${path}/:id`, async (req, res) => {
      await deleteCollection(db, adminId(req), kind, idParam(req));
      res.status(204).end();
    });
  }

  // ---- events
  router.post("/events", async (req, res) => {
    res.status(201).json(await createEvent(db, adminId(req), createEventSchema.parse(req.body)));
  });
  router.patch("/events/:id", async (req, res) => {
    await updateEvent(db, adminId(req), idParam(req), updateEventSchema.parse(req.body));
    res.status(204).end();
  });
  router.delete("/events/:id", async (req, res) => {
    await deleteCollection(db, adminId(req), "event", idParam(req));
    res.status(204).end();
  });

  // ---- sharing
  router.get("/share-links", async (_req, res) => {
    res.json(await listShareLinks(db));
  });
  router.post("/share-links", async (req, res) => {
    res.status(201).json(await createShareLink(db, adminId(req), createShareLinkSchema.parse(req.body)));
  });
  router.post("/share-links/:id/revoke", async (req, res) => {
    await revokeShareLink(db, adminId(req), idParam(req));
    res.status(204).end();
  });

  // ---- codes, admins, sessions, logs
  router.get("/settings", async (req, res) => {
    res.json(await settingsOverview(db, adminId(req)));
  });
  router.post("/codes/:scope", async (req, res) => {
    const scope = z.enum(["view", "download"]).parse(req.params.scope);
    const { code } = newCodeSchema.parse(req.body);
    res.set("Cache-Control", "no-store");
    res.json({ code: await rotateSharedCode(db, adminId(req), scope, code) });
  });
  router.post("/admins", async (req, res) => {
    const { name, code } = addAdminSchema.parse(req.body);
    res.set("Cache-Control", "no-store");
    res.status(201).json({ code: await createAdmin(db, adminId(req), name, code) });
  });
  router.post("/admins/:id/reset-code", async (req, res) => {
    const { code } = newCodeSchema.parse(req.body);
    res.set("Cache-Control", "no-store");
    res.json({ code: await resetAdmin(db, adminId(req), idParam(req), code) });
  });
  router.patch("/admins/:id", async (req, res) => {
    const { active } = setAdminActiveSchema.parse(req.body);
    await changeAdminActive(db, adminId(req), idParam(req), active);
    res.status(204).end();
  });
  router.post("/sessions/revoke", async (req, res) => {
    const { scope } = revokeSessionsSchema.parse(req.body);
    res.json({ count: await revokeVisitorSessions(db, adminId(req), scope) });
  });
  router.get("/downloads", async (_req, res) => {
    res.json(await recentDownloads(db));
  });
  router.get("/activity", async (_req, res) => {
    res.json(await recentActivity(db));
  });

  // ---- database backups
  router.get("/backups", async (_req, res) => {
    res.json(storage ? await listBackups(storage) : []);
  });
  /** A fresh copy of the database for an admin to keep on their own computer. */
  router.get("/backups/download", async (req, res) => {
    const data = await exportDatabase(db);
    await logActivity(db, adminId(req), "backup.download", undefined, { size: data.length });
    res.set({
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${backupDownloadName()}"`,
      "Cache-Control": "no-store",
    });
    res.send(data);
  });

  return router;
}
