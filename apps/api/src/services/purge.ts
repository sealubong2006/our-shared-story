import { and, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { photoVariants, photos } from "../db/schema.js";
import type { ObjectStore } from "../lib/storage.js";

export const DELETED_RETENTION_DAYS = 30;

/**
 * Permanently removes photos that have been in "Recently deleted" longer than the
 * retention period: their files in storage first, then the database rows (tags,
 * favourites and variants go with them). A file that fails to delete leaves its photo
 * in place so the next run retries it — nothing is orphaned silently.
 */
export async function purgeDeletedPhotos(db: Db, storage: ObjectStore, days = DELETED_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const expired = await db
    .select({ id: photos.id, originalKey: photos.originalKey, archiveKey: photos.archiveKey })
    .from(photos)
    .where(and(isNotNull(photos.deletedAt), lt(photos.deletedAt, cutoff)))
    .limit(200);
  if (expired.length === 0) return 0;

  const variants = await db
    .select({ photoId: photoVariants.photoId, key: photoVariants.key })
    .from(photoVariants)
    .where(
      inArray(
        photoVariants.photoId,
        expired.map((p) => p.id),
      ),
    );

  const done: string[] = [];
  for (const photo of expired) {
    const keys = [photo.originalKey, photo.archiveKey, ...variants.filter((v) => v.photoId === photo.id).map((v) => v.key)];
    try {
      for (const key of keys) if (key) await storage.deleteObject(key);
      done.push(photo.id);
    } catch (err) {
      console.error(`Could not delete files for photo ${photo.id}; will retry`, err);
    }
  }
  if (done.length) await db.delete(photos).where(inArray(photos.id, done));
  return done.length;
}
