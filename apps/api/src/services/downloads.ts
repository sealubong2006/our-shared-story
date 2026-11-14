import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { ZipArchive } from "archiver";
import type { Response } from "express";
import type { DownloadLogDto } from "@family-album/shared";
import type { Db } from "../db/client.js";
import { admins, downloadAuditLogs, photos } from "../db/schema.js";
import { generateToken } from "../lib/crypto.js";
import type { ObjectStore } from "../lib/storage.js";
import { HttpError, notFound } from "../lib/errors.js";

/** Who is downloading, for the audit log. */
export interface Downloader {
  sessionIdHash: string | null;
  adminId: string | null;
  ipHash: string;
  userAgent: string | undefined;
}

const SINGLE_URL_SECONDS = 300;
const ZIP_TOKEN_MS = 5 * 60 * 1000;

/** "IMG_0042.HEIC" stored as JPEG → "IMG_0042.jpg"; keeps names safe for every OS. */
export function downloadName(originalFilename: string, storedKey: string): string {
  const ext = storedKey.split(".").pop() ?? "jpg";
  const base = originalFilename.replace(/\.[^.]+$/, "").replace(/[^\w\- ().]+/g, "_").slice(0, 100) || "photo";
  return `${base}.${ext}`;
}

async function visiblePhotos(db: Db, ids: string[]) {
  return db
    .select()
    .from(photos)
    .where(and(inArray(photos.id, ids), isNull(photos.deletedAt), eq(photos.status, "ready")));
}

async function audit(db: Db, who: Downloader, kind: "single" | "zip", photoId: string | null, photoCount: number) {
  await db.insert(downloadAuditLogs).values({
    sessionIdHash: who.sessionIdHash,
    adminId: who.adminId,
    photoId,
    kind,
    photoCount,
    ipHash: who.ipHash,
    userAgent: who.userAgent?.slice(0, 300) ?? null,
  });
}

/** A short-lived signed link to the full-quality original, sent as an attachment. */
export async function singleDownloadUrl(db: Db, storage: ObjectStore, photoId: string, who: Downloader): Promise<string> {
  const [photo] = await visiblePhotos(db, [photoId]);
  if (!photo) throw notFound("Photo");
  const url = await storage.signedGetUrl(photo.originalKey, {
    expiresInSeconds: SINGLE_URL_SECONDS,
    downloadName: downloadName(photo.originalFilename, photo.originalKey),
  });
  await audit(db, who, "single", photo.id, 1);
  return url;
}

/**
 * ZIP downloads are two steps so the browser can save the file with a plain link:
 * a POST (with the CSRF header) issues a one-time token bound to the session, then a
 * GET with that token streams the ZIP. Tokens live in memory — fine for a single server.
 */
export class ZipTokens {
  private readonly tokens = new Map<string, { photoIds: string[]; sessionIdHash: string | null; expires: number }>();

  issue(photoIds: string[], sessionIdHash: string | null): string {
    this.sweep();
    const token = generateToken();
    this.tokens.set(token, { photoIds, sessionIdHash, expires: Date.now() + ZIP_TOKEN_MS });
    return token;
  }

  /** One use only; must be redeemed by the same session that asked for it. */
  redeem(token: string, sessionIdHash: string | null): string[] {
    const entry = this.tokens.get(token);
    this.tokens.delete(token);
    if (!entry || entry.expires < Date.now() || entry.sessionIdHash !== sessionIdHash) {
      throw new HttpError(403, "This download link has expired. Please start the download again.");
    }
    return entry.photoIds;
  }

  private sweep() {
    const now = Date.now();
    for (const [t, e] of this.tokens) if (e.expires < now) this.tokens.delete(t);
  }
}

export async function streamZip(db: Db, storage: ObjectStore, photoIds: string[], who: Downloader, res: Response) {
  const rows = await visiblePhotos(db, photoIds);
  if (rows.length === 0) throw notFound("Photos");

  const used = new Set<string>();
  const uniqueName = (name: string) => {
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = name.replace(/(\.[^.]+)$/, ` (${n})$1`);
    used.add(candidate.toLowerCase());
    return candidate;
  };

  await audit(db, who, "zip", rows.length === 1 ? rows[0]!.id : null, rows.length);

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="our-shared-story-${stamp}.zip"`);
  res.setHeader("Cache-Control", "no-store");

  // Photos are already compressed, so store them as-is: faster and no bigger.
  const zip = new ZipArchive({ store: true });
  zip.on("error", (err: Error) => {
    console.error("ZIP stream failed", err);
    res.destroy(err);
  });
  zip.pipe(res);
  for (const photo of rows) {
    const prefix = photo.takenAt ? `${photo.takenAt.toISOString().slice(0, 10)} ` : "";
    zip.append(await storage.getObjectStream(photo.originalKey), {
      name: uniqueName(prefix + downloadName(photo.originalFilename, photo.originalKey)),
      date: photo.takenAt ?? photo.uploadedAt,
    });
  }
  await zip.finalize();
}

export async function recentDownloads(db: Db, limit = 50): Promise<DownloadLogDto[]> {
  const rows = await db
    .select({
      id: downloadAuditLogs.id,
      kind: downloadAuditLogs.kind,
      photoCount: downloadAuditLogs.photoCount,
      photoFilename: photos.originalFilename,
      adminName: admins.name,
      createdAt: downloadAuditLogs.createdAt,
    })
    .from(downloadAuditLogs)
    .leftJoin(photos, eq(photos.id, downloadAuditLogs.photoId))
    .leftJoin(admins, eq(admins.id, downloadAuditLogs.adminId))
    .orderBy(desc(downloadAuditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    photoCount: r.photoCount,
    photoFilename: r.photoFilename,
    // No accounts, so family members can't be named — only admins can.
    who: r.adminName ? `${r.adminName} (admin)` : "A family member",
    createdAt: r.createdAt.toISOString(),
  }));
}
