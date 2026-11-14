import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Enums ----------
export const photoDateSource = pgEnum("photo_date_source", ["exif", "manual", "unknown"]);
export const photoStatus = pgEnum("photo_status", ["processing", "ready", "failed"]);
export const photoVariantKind = pgEnum("photo_variant_kind", ["thumb", "md", "lg"]);
/** Codes shared by the whole family. Admin codes live on the admins table instead. */
export const sharedCodeScope = pgEnum("shared_code_scope", ["view", "download"]);
export const sessionScope = pgEnum("session_scope", ["view", "download", "admin", "share"]);
export const shareTargetType = pgEnum("share_target_type", ["event", "category", "person", "selection"]);
export const downloadKind = pgEnum("download_kind", ["single", "zip"]);

// ---------- Admins (named codes, no accounts) ----------
export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  codeHash: text("code_hash").notNull(),
  /** Bumped when the code is reset; sessions created with an older version stop working. */
  codeVersion: integer("code_version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

// ---------- Photos ----------
export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The file everyone views/downloads (JPEG for converted HEIC uploads). */
    originalKey: text("original_key").notNull(),
    /** Untouched upload kept as an archive when the original had to be converted (e.g. HEIC). */
    archiveKey: text("archive_key"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: bigint("bytes", { mode: "number" }),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    takenAtSource: photoDateSource("taken_at_source").notNull().default("unknown"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    uploadedByAdminId: uuid("uploaded_by_admin_id").references(() => admins.id, { onDelete: "set null" }),
    caption: text("caption"),
    locationName: text("location_name"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    /** Tiny encoded placeholder shown while the thumbnail loads. */
    blurhash: text("blurhash"),
    status: photoStatus("status").notNull().default("processing"),
    /** Soft delete; files are purged after a grace period. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("photos_taken_at_idx").on(t.takenAt.desc(), t.id),
    index("photos_uploaded_at_idx").on(t.uploadedAt.desc(), t.id),
    index("photos_deleted_at_idx").on(t.deletedAt),
  ],
);

export const photoVariants = pgTable(
  "photo_variants",
  {
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    variant: photoVariantKind("variant").notNull(),
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.variant] })],
);

// ---------- People ----------
export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  profilePhotoId: uuid("profile_photo_id").references((): AnyPgColumn => photos.id, { onDelete: "set null" }),
  /** True for group collections such as "Family". */
  isCollection: boolean("is_collection").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const photoPeople = pgTable(
  "photo_people",
  {
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.personId] }), index("photo_people_person_idx").on(t.personId)],
);

// ---------- Categories ----------
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  coverPhotoId: uuid("cover_photo_id").references((): AnyPgColumn => photos.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const photoCategories = pgTable(
  "photo_categories",
  {
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.categoryId] }), index("photo_categories_category_idx").on(t.categoryId)],
);

// ---------- Events ----------
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  coverPhotoId: uuid("cover_photo_id").references((): AnyPgColumn => photos.id, { onDelete: "set null" }),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  createdAt: createdAt(),
});

export const photoEvents = pgTable(
  "photo_events",
  {
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.eventId] }), index("photo_events_event_idx").on(t.eventId)],
);

export const eventPeople = pgTable(
  "event_people",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.personId] }), index("event_people_person_idx").on(t.personId)],
);

export const eventCategories = pgTable(
  "event_categories",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.categoryId] }), index("event_categories_category_idx").on(t.categoryId)],
);

// ---------- Favourites (one shared family list) ----------
export const favourites = pgTable("favourites", {
  photoId: uuid("photo_id")
    .primaryKey()
    .references(() => photos.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// ---------- Access ----------
export const accessCodes = pgTable("access_codes", {
  scope: sharedCodeScope("scope").primaryKey(),
  codeHash: text("code_hash").notNull(),
  /** Bumped on rotation; sessions created with an older version stop working. */
  version: integer("version").notNull().default(1),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  targetType: shareTargetType("target_type").notNull(),
  /** Event/category/person id; null for hand-picked selections. */
  targetId: uuid("target_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdByAdminId: uuid("created_by_admin_id").references(() => admins.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const shareLinkPhotos = pgTable(
  "share_link_photos",
  {
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.shareLinkId, t.photoId] })],
);

export const accessSessions = pgTable(
  "access_sessions",
  {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    idHash: text("id_hash").primaryKey(),
    scope: sessionScope("scope").notNull(),
    /** Version of the code (shared code or admin code) that created this session. */
    codeVersion: integer("code_version").notNull(),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "cascade" }),
    shareLinkId: uuid("share_link_id").references(() => shareLinks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [index("access_sessions_expires_idx").on(t.expiresAt)],
);

export const failedAttempts = pgTable(
  "failed_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: sessionScope("scope").notNull(),
    ipHash: text("ip_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("failed_attempts_ip_idx").on(t.ipHash, t.attemptedAt)],
);

// ---------- Audit ----------
export const downloadAuditLogs = pgTable("download_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionIdHash: text("session_id_hash"),
  adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
  photoId: uuid("photo_id").references(() => photos.id, { onDelete: "set null" }),
  kind: downloadKind("kind").notNull(),
  photoCount: integer("photo_count").notNull().default(1),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const adminActivityLogs = pgTable(
  "admin_activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    details: jsonb("details"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_activity_created_idx").on(t.createdAt.desc())],
);

// ---------- Settings (key/value; replaces a one-row "families" table) ----------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
