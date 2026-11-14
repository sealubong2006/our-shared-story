CREATE TYPE "public"."download_kind" AS ENUM('single', 'zip');--> statement-breakpoint
CREATE TYPE "public"."photo_date_source" AS ENUM('exif', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."photo_variant_kind" AS ENUM('thumb', 'md', 'lg');--> statement-breakpoint
CREATE TYPE "public"."session_scope" AS ENUM('view', 'download', 'admin', 'share');--> statement-breakpoint
CREATE TYPE "public"."share_target_type" AS ENUM('event', 'category', 'person', 'selection');--> statement-breakpoint
CREATE TYPE "public"."shared_code_scope" AS ENUM('view', 'download');--> statement-breakpoint
CREATE TABLE "access_codes" (
	"scope" "shared_code_scope" PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"scope" "session_scope" NOT NULL,
	"code_version" integer NOT NULL,
	"admin_id" uuid,
	"share_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "admin_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"cover_photo_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "download_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id_hash" text,
	"admin_id" uuid,
	"photo_id" uuid,
	"kind" "download_kind" NOT NULL,
	"photo_count" integer DEFAULT 1 NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"event_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "event_categories_event_id_category_id_pk" PRIMARY KEY("event_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "event_people" (
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "event_people_event_id_person_id_pk" PRIMARY KEY("event_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"cover_photo_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "failed_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "session_scope" NOT NULL,
	"ip_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"photo_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"profile_photo_id" uuid,
	"is_collection" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "photo_categories" (
	"photo_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "photo_categories_photo_id_category_id_pk" PRIMARY KEY("photo_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "photo_events" (
	"photo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "photo_events_photo_id_event_id_pk" PRIMARY KEY("photo_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "photo_people" (
	"photo_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "photo_people_photo_id_person_id_pk" PRIMARY KEY("photo_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "photo_variants" (
	"photo_id" uuid NOT NULL,
	"variant" "photo_variant_kind" NOT NULL,
	"key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "photo_variants_photo_id_variant_pk" PRIMARY KEY("photo_id","variant")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_key" text NOT NULL,
	"archive_key" text,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" bigint,
	"taken_at" timestamp with time zone,
	"taken_at_source" "photo_date_source" DEFAULT 'unknown' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_admin_id" uuid,
	"caption" text,
	"location_name" text,
	"latitude" double precision,
	"longitude" double precision,
	"blurhash" text,
	"status" "photo_status" DEFAULT 'processing' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_link_photos" (
	"share_link_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	CONSTRAINT "share_link_photos_share_link_id_photo_id_pk" PRIMARY KEY("share_link_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"target_type" "share_target_type" NOT NULL,
	"target_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "access_sessions" ADD CONSTRAINT "access_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_sessions" ADD CONSTRAINT "access_sessions_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_activity_logs" ADD CONSTRAINT "admin_activity_logs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_cover_photo_id_photos_id_fk" FOREIGN KEY ("cover_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_audit_logs" ADD CONSTRAINT "download_audit_logs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_audit_logs" ADD CONSTRAINT "download_audit_logs_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_photo_id_photos_id_fk" FOREIGN KEY ("cover_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_profile_photo_id_photos_id_fk" FOREIGN KEY ("profile_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_categories" ADD CONSTRAINT "photo_categories_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_categories" ADD CONSTRAINT "photo_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_events" ADD CONSTRAINT "photo_events_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_events" ADD CONSTRAINT "photo_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_people" ADD CONSTRAINT "photo_people_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_people" ADD CONSTRAINT "photo_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_variants" ADD CONSTRAINT "photo_variants_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_admin_id_admins_id_fk" FOREIGN KEY ("uploaded_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_photos" ADD CONSTRAINT "share_link_photos_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_photos" ADD CONSTRAINT "share_link_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_sessions_expires_idx" ON "access_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "admin_activity_created_idx" ON "admin_activity_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_categories_category_idx" ON "event_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "event_people_person_idx" ON "event_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "failed_attempts_ip_idx" ON "failed_attempts" USING btree ("ip_hash","attempted_at");--> statement-breakpoint
CREATE INDEX "photo_categories_category_idx" ON "photo_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "photo_events_event_idx" ON "photo_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "photo_people_person_idx" ON "photo_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "photos_taken_at_idx" ON "photos" USING btree ("taken_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "photos_uploaded_at_idx" ON "photos" USING btree ("uploaded_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "photos_deleted_at_idx" ON "photos" USING btree ("deleted_at");