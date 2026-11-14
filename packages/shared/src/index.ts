import { z } from "zod";
import { MAX_FILES_PER_BATCH, MAX_UPLOAD_BYTES, MAX_ZIP_PHOTOS, UPLOAD_TYPES } from "./constants";

export * from "./constants";

// ---------------------------------------------------------------- Access

/** Body for every code-entry endpoint (view, download, admin). */
export const codeEntrySchema = z.object({
  code: z.string().trim().min(4, "Code is too short").max(128, "Code is too long"),
});
export type CodeEntry = z.infer<typeof codeEntrySchema>;

/** What the current browser is allowed to do. Returned by GET /api/access/me. */
export interface AccessState {
  view: boolean;
  download: boolean;
  admin: { id: string; name: string } | null;
  /** True when the browser opened a share link (limited, view-only access to one collection). */
  share: boolean;
}

export interface ApiError {
  error: string;
  /** Seconds until another attempt is allowed (lockouts only). */
  retryAfter?: number;
}

// ---------------------------------------------------------------- Uploads

export const presignSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.enum(Object.keys(UPLOAD_TYPES) as [string, ...string[]], "Unsupported file type"),
        size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "File is larger than 50 MB"),
      }),
    )
    .min(1)
    .max(MAX_FILES_PER_BATCH),
});
export type PresignRequest = z.infer<typeof presignSchema>;
export interface PresignedUpload {
  key: string;
  url: string;
  contentType: string;
}

const idList = z.array(z.uuid()).max(200).default([]);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** ISO date or date-time; stored as a wall-clock time (see docs/PLAN.md, "dates"). */
const takenAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Use a date like 2025-12-25 or 2025-12-25T14:30")
  .nullish();

export const finaliseUploadSchema = z.object({
  key: z.string().regex(/^uploads\/[0-9a-f-]{36}\.(jpg|png|webp|heic)$/, "Invalid upload key"),
  originalFilename: z.string().trim().min(1).max(255),
  caption: optionalText(2000),
  locationName: optionalText(200),
  takenAt: takenAtSchema,
  personIds: idList,
  categoryIds: idList,
  eventIds: idList,
});
export type FinaliseUpload = z.input<typeof finaliseUploadSchema>;

export const updatePhotoSchema = z.object({
  caption: optionalText(2000).optional(),
  locationName: optionalText(200).optional(),
  takenAt: takenAtSchema,
  personIds: z.array(z.uuid()).max(200).optional(),
  categoryIds: z.array(z.uuid()).max(200).optional(),
  eventIds: z.array(z.uuid()).max(200).optional(),
});
export type UpdatePhoto = z.input<typeof updatePhotoSchema>;

export const bulkTagSchema = z.object({
  photoIds: z.array(z.uuid()).min(1).max(500),
  personIds: idList,
  categoryIds: idList,
  eventIds: idList,
});
export type BulkTag = z.input<typeof bulkTagSchema>;

export const bulkPhotoIdsSchema = z.object({ photoIds: z.array(z.uuid()).min(1).max(500) });

// ---------------------------------------------------------------- Photos

export interface TagRef {
  id: string;
  name: string;
  slug: string;
}

export interface PhotoUrls {
  thumb: string;
  md: string;
  lg: string;
}

export interface PhotoDto {
  id: string;
  /** Wall-clock capture time, ISO without timezone ("2025-12-25T14:30:00"), or null if unknown. */
  takenAt: string | null;
  takenAtSource: "exif" | "manual" | "unknown";
  uploadedAt: string;
  uploadedBy: string | null;
  originalFilename: string;
  caption: string | null;
  locationName: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  urls: PhotoUrls | null;
  people: TagRef[];
  categories: TagRef[];
  events: TagRef[];
  isFavourite: boolean;
  deletedAt: string | null;
}

export interface PhotoPage {
  photos: PhotoDto[];
  nextCursor: string | null;
}

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2025-12-25");

export const photoListQuerySchema = z.object({
  personId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  eventId: z.uuid().optional(),
  untagged: z.enum(["true", "false"]).optional(),
  deleted: z.enum(["true", "false"]).optional(),
  favourites: z.enum(["true", "false"]).optional(),
  /** Capture date range, inclusive. Photos without a known date are excluded. */
  from: dateParam.optional(),
  to: dateParam.optional(),
  /** Only photos whose capture date is unknown. */
  undated: z.enum(["true", "false"]).optional(),
  sort: z.enum(["newest", "oldest", "uploaded"]).default("newest"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});
export type PhotoListQuery = z.input<typeof photoListQuerySchema>;

/** One month on the timeline. */
export interface TimelineMonth {
  year: number;
  /** 1–12 */
  month: number;
  count: number;
}

export interface TimelineSummary {
  months: TimelineMonth[];
  /** Photos whose capture date is unknown. */
  undatedCount: number;
}

// ---------------------------------------------------------------- People, categories, events

export interface CollectionDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  photoCount: number;
  coverPhotoId: string | null;
  /** Up to three thumbnail URLs, cover first, for the fanned "photo stack". */
  previewUrls: string[];
}

export interface PersonDto extends CollectionDto {
  isCollection: boolean;
}

export type CategoryDto = CollectionDto;

export interface EventDto extends CollectionDto {
  startsOn: string | null;
  endsOn: string | null;
  /** People linked to the event by an admin (editable). */
  people: TagRef[];
  /** People tagged in the event's photos (derived). */
  taggedPeople: TagRef[];
  categories: TagRef[];
}

const name = z.string().trim().min(1, "Name is required").max(80, "Name is too long");
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2025-12-25")
  .nullish()
  .transform((v) => v ?? null);

export const createCollectionSchema = z.object({
  name,
  description: optionalText(1000),
});

export const updateCollectionSchema = z.object({
  name: name.optional(),
  description: optionalText(1000).optional(),
  coverPhotoId: z.uuid().nullish(),
});

export const createEventSchema = createCollectionSchema.extend({
  startsOn: dateOnly,
  endsOn: dateOnly,
  personIds: idList,
  categoryIds: idList,
});

export const updateEventSchema = updateCollectionSchema.extend({
  startsOn: dateOnly.optional(),
  endsOn: dateOnly.optional(),
  personIds: z.array(z.uuid()).max(200).optional(),
  categoryIds: z.array(z.uuid()).max(200).optional(),
});

// ---------------------------------------------------------------- Downloads

export const zipRequestSchema = z.object({
  photoIds: z.array(z.uuid()).min(1).max(MAX_ZIP_PHOTOS, `You can download up to ${MAX_ZIP_PHOTOS} photos at once.`),
});

export interface DownloadLink {
  url: string;
}

// ---------------------------------------------------------------- Sharing

export const shareTokenSchema = z.object({ token: z.string().min(20).max(100) });

export const createShareLinkSchema = z
  .object({
    label: z.string().trim().min(1, "Give the link a name").max(80),
    targetType: z.enum(["event", "category", "person", "selection"]),
    targetId: z.uuid().optional(),
    photoIds: z.array(z.uuid()).max(500).optional(),
    /** Days until the link stops working; null = until revoked. */
    expiresInDays: z.number().int().min(1).max(365).nullable(),
  })
  .refine((v) => (v.targetType === "selection" ? Boolean(v.photoIds?.length) : Boolean(v.targetId)), {
    message: "Choose what to share.",
  });
export type CreateShareLink = z.input<typeof createShareLinkSchema>;

export interface ShareLinkDto {
  id: string;
  label: string;
  targetType: "event" | "category" | "person" | "selection";
  /** Event/category/person name, or "N photos" for a selection. */
  targetName: string;
  status: "active" | "expired" | "revoked";
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** Returned once, at creation — only a hash of the token is stored. */
export interface CreatedShareLink extends ShareLinkDto {
  path: string;
}

export interface SharedCollectionInfo {
  /** What visitors see: the event/category/person name. The link's own label is admin-only. */
  title: string;
  photoCount: number;
  expiresAt: string | null;
}

// ---------------------------------------------------------------- Admin settings

export const newCodeSchema = z.object({
  /** Leave empty to have a memorable code generated. */
  code: z.string().trim().max(128).optional(),
});

export const addAdminSchema = newCodeSchema.extend({
  name: z.string().trim().min(1, "Name is required").max(40),
});

export const setAdminActiveSchema = z.object({ active: z.boolean() });

export const revokeSessionsSchema = z.object({
  scope: z.enum(["visitors", "download", "share"]),
});

export interface IssuedCode {
  /** Shown once. */
  code: string;
}

export interface AdminDto {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  isYou: boolean;
}

export interface SettingsOverview {
  codes: { view: { rotatedAt: string } | null; download: { rotatedAt: string } | null };
  admins: AdminDto[];
  activeSessions: { view: number; download: number; admin: number; share: number };
}

export interface DownloadLogDto {
  id: string;
  kind: "single" | "zip";
  photoCount: number;
  photoFilename: string | null;
  who: string;
  createdAt: string;
}

export interface ActivityDto {
  id: string;
  adminName: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export type CreateCollection = z.input<typeof createCollectionSchema>;
export type UpdateCollection = z.input<typeof updateCollectionSchema>;
export type CreateEvent = z.input<typeof createEventSchema>;
export type UpdateEvent = z.input<typeof updateEventSchema>;

// ---------------------------------------------------------------- Backups

/** A stored database backup (photos aren't included; they live in R2 already). */
export interface BackupDto {
  key: string;
  size: number;
  createdAt: string;
}
