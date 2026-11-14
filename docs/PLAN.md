# Our Shared Story — Architecture & Implementation Plan

Status: **All six phases built; deployment prepared** — 2026-11-14. See docs/DEPLOY.md.
Deployment prep: `.railway/railway.ts` (Railway IaC, variables unmanaged: build → start, health
check; the server migrates and seeds itself on start); production defaults for secure cookies and one trusted proxy (blank variables count as
unset); server refuses to start without R2 in production; CLI tools built into dist
(`codes:prod`, `r2:check:prod`); seeding only adds people/categories to an empty album.
Rehearsed locally on a fresh database in production mode.
Phase 6 delivered: admin screens, the share page and the photo editor load on demand; zod kept
out of the browser bundle (plain constants live in `@family-album/shared/constants`); initial JS
~180 KB gzipped (was ~215 KB). Production server gzips responses, caches hashed `/assets` for a
year (other files 1 hour) and returns 404 for missing assets. Accessibility: secondary text
darkened to meet WCAG AA contrast, stronger focus ring, skip link, focus kept inside dialogs
(stack-aware), Escape closes only the top dialog, better image labels. Every page checked at
320/375/768 px with no sideways scrolling (header tightened on the narrowest phones).
Before going live: add the production origin to the R2 CORS rule; test HEIC with a real iPhone photo.

Phase 5 (permissions) built.
Phase 5 delivered: downloads behind the separate download code (asked for in a dialog when
needed; admins exempt) — single originals via 5-minute signed attachment URLs, multi-select
ZIPs via a one-time token bound to the session; download audit log. Share links for an
event/category/person or a hand-picked selection, with expiry, shown once (only a hash stored),
revocable instantly, view-only (no downloads, tags, uploader names or anything else in the album;
visitors see the collection's name, never the admin-only link label). Admin Settings: change the
viewing/download codes, add admins, give an admin a new code, disable/enable (not yourself, and
never the last active admin), sign out family devices, download and admin activity logs.
Photos in "Recently deleted" are permanently removed (files then rows) after 30 days.
Known limits: ZIP tokens live in server memory (fine for one server; a restart just means
pressing Download again).

Phase 4 (photo book) built.
Phase 4 delivered: Home photo book on the dark stage — open spread in the centre, other spreads
hinged and fanned in 3D on both sides; scrapbook pages (taped prints, handwritten captions and
dates, title page); autoplay with three speeds (remembered per device), pause/resume, scrubber,
previous/next, back to start, arrow keys/space/Home/End, swipe, click a fanned page to turn to it,
click a photo on the open spread to view it (autoplay pauses meanwhile); one page per spread on
phones; chapters (whole story, favourites, recently added, any event or person) kept in the URL.
With animations off or reduced motion, pages change instantly and autoplay starts paused.

Phase 3 (browsing) built.
Phase 3 delivered: library with masonry/grid layouts, combinable filters (person, category,
event, year, specific day, order) kept in the URL, infinite scroll, blurhash placeholders;
full-screen viewer (swipe, arrow keys, details panel, shared favourites, admin edit, Back
button closes it, shareable ?photo= links); people/category/event pages; timeline by
year → month → day with jump rail; favourites. Undated photos sort as the oldest.

Phase 2 status (kept for reference): photo management built.
Phase 2 delivered: direct-to-R2 uploads with progress/cancel, server-side processing (EXIF date
and GPS, orientation, WebP thumb/md/lg variants, blurhash, HEIC → JPEG with the date written
back into the JPEG), tagging at upload with inline tag creation, photo editor, "Needs tagging"
queue, bulk tag/delete/restore, soft delete, people/categories/events management with cover
photos, admin activity log. Not yet: purging soft-deleted files after 30 days (Phase 5/6).

**Date convention:** `photos.taken_at` stores the camera's wall-clock time as if it were UTC
(EXIF has no reliable timezone), and the UI always displays it without timezone conversion.

Phase 1 delivered: workspaces, full database schema + migration, seed data, R2 storage client
(not yet connected — needs credentials), access codes, sessions, lockout, access screen,
admin sign-in, global animation setting. Phase 1 deliberately has no in-app code management
yet (that is Phase 5); codes are managed with `npm run codes` for now.
Environment found: empty project folder, Node 24, npm 11, PostgreSQL 18 running locally, no Docker.

---

## 1. Design analysis (from the two reference screenshots)

### Reference A — dark "Movies" book viewer
- Deep navy/slate gradient stage (`#1e2433` → `#3a4256`), the photographs are the only colour.
- **3D fanned page stack**: an open double-page spread in the centre, with neighbouring pages
  receding left and right in perspective (rotateY + translateZ), white page edges visible.
  It reads more like a coverflow of pages than a paper curl.
- Pages are **scrapbook collages**: several photos per spread, slight rotations, a handwritten
  caption block, torn/taped edges.
- Header: centred bold sans title ("Movies") with a small muted sub-line ("12 Pages").
- Controls: small circular translucent icon buttons (top corners, bottom action row),
  a thin progress/scrub bar, play/pause, mute. Very little chrome.

### Reference B — light "Memory Lane" bookshelf
- Warm off-white canvas (`#f2f1ee`) on a slightly darker frame, generous whitespace.
- **Handwritten font for album names** ("Kanada 23", "Spain Summer"), small sans for UI.
- Grid of soft rounded cards (≈16px radius, faint tint, no hard borders); each card shows a
  **fanned stack of 3 photos** — one centred and upright, two tilted behind it.
- Pill-shaped primary button ("New album"), small avatar top right, tiny logo top left.

### Resulting design system
| Token | Proposal |
|---|---|
| Light surfaces | `paper #f4f2ee`, `card #ebe8e3`, `ink #24252b`, `muted #7b7a78` |
| Dark stage (book) | `stage-from #1c2230`, `stage-to #3b4458`, page `#fbfaf7` |
| Accent | one warm accent, e.g. `#c98a5b` (terracotta) — used sparingly |
| Type | UI: **Inter** (or DM Sans). Album/person/event names + captions: **Caveat** (handwritten). |
| Radius | cards 16px, photos 6–10px, buttons full pill / circle |
| Shadow | soft layered shadows for photos; deeper ambient shadow under the book |
| Motion | spring-based, 250–600ms, nothing bouncy; all non-essential motion behind the global toggle and `prefers-reduced-motion` |

**Split of the two references:** the library, People, Categories and Events pages use the light
bookshelf language (collections as fanned photo stacks); the Home photo book and the full-screen
viewer use the dark immersive stage.

---

## 2. Architecture

```
album/
  apps/web      React + TS + Vite + Tailwind + Motion + React Router
  apps/api      Node + Express + TS (REST)
  packages/shared   zod schemas + shared TS types (API contract)
  docs/
```
npm workspaces; no extra monorepo tooling.

**Supporting libraries (each explained before install):**
- `drizzle-orm` + `drizzle-kit` — typed queries and SQL migrations.
- `zod` — request validation on the API, shared types for the frontend.
- `argon2` — hashing access codes.
- `express-rate-limit` — per-IP limits on code endpoints.
- `sharp` — thumbnails / WebP / AVIF variants.
- `exifr` — EXIF date, orientation, GPS.
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — R2 is S3-compatible.
- `archiver` — streamed ZIP for multi-photo downloads.
- `@tanstack/react-query` — data fetching/caching on the frontend.

### Request flow
```
Browser ──cookie──▶ Express API ──▶ PostgreSQL
   │                    │
   │                    └─ signs short-lived URLs ─▶ Cloudflare R2 (private bucket)
   └──────────── GET image via signed URL ──────────▶ R2
```
In production the API also serves the built frontend, so cookies are first-party and there is no CORS.

### Access model (no accounts)
| Scope | Granted by | Allows |
|---|---|---|
| `view` | family viewing code | browse everything |
| `download` | download code (on top of `view`) | originals + ZIP downloads |
| `admin` | administrator code | everything incl. upload, settings, code rotation |
| `share` | share-link token | view **only** the linked event/collection; never download |

- Codes stored as argon2 hashes in `access_codes`; plaintext never stored or sent to the frontend.
- Successful code entry creates a row in `access_sessions`; the browser gets an opaque random
  session id in an `HttpOnly; Secure; SameSite=Lax` cookie. Server-side sessions are what make
  **revocation** possible (delete rows / bump code version).
- Expiry: view 30 days (sliding), download 2 hours, admin 12 hours. All configurable.
- Rate limiting: 5 failed attempts per IP per 15 min → lockout with increasing back-off.
  Failed attempts recorded so the admin can see them.
- Rotating a code invalidates every session of that scope.
- Admin routes are enforced in API middleware; the frontend only hides buttons for UX.
- CSRF: `SameSite=Lax` plus requiring a custom header on mutating requests.

### Images
- Upload: admin browser → API (`POST /admin/uploads/presign`) → **direct PUT to R2** with progress
  and cancel (XHR abort) → `POST /admin/photos/finalise` → API reads EXIF, generates variants, writes DB rows.
  Direct upload keeps large originals off the small API server.
- Stored keys: `originals/{id}.{ext}`, `variants/{id}/thumb-400.webp`, `md-1200.webp`, `lg-2400.webp`
  (AVIF optional later; WebP gives near-universal support at much lower encode cost).
- Library loads only `thumb`, the viewer loads `md`/`lg` via `srcset`, originals are fetched only for
  authorised downloads.
- **Caching vs signed URLs:** signing every request would make URLs unique and defeat caching.
  The API signs viewing URLs with expiry rounded to fixed 1-hour windows, so the same URL is
  reused within a window and the browser cache works. Download URLs are signed per request, 5 min.
- Pagination: cursor-based (`taken_at, id`), 60 per page, infinite scroll.

---

## 3. Database schema (PostgreSQL)

```sql
people          (id uuid pk, name, slug unique, description, profile_photo_id fk→photos null,
                 is_collection bool  -- true for "Family"
                 , sort_order, created_at)
photos          (id uuid pk, original_key, original_filename, mime_type, width, height, bytes,
                 taken_at timestamptz null, taken_at_source enum('exif','manual','unknown'),
                 uploaded_at, caption, location_name, latitude, longitude,
                 blurhash,            -- tiny placeholder for progressive loading
                 status enum('processing','ready','failed'), deleted_at null)
photo_variants  (photo_id fk, variant enum('thumb','md','lg'), key, width, height, bytes,
                 pk(photo_id, variant))
photo_people    (photo_id fk, person_id fk, pk(photo_id, person_id))
categories      (id, name, slug unique, description, cover_photo_id fk null, sort_order)
photo_categories(photo_id fk, category_id fk, pk)
events          (id, name, slug unique, description, cover_photo_id fk null,
                 starts_on date, ends_on date null, created_at)
photo_events    (photo_id fk, event_id fk, pk)
event_people    (event_id fk, person_id fk, pk)        -- explicit, plus derived from photos
event_categories(event_id fk, category_id fk, pk)
favourites      (photo_id fk pk, created_at)            -- see open question 1
access_codes    (scope enum('view','download','admin') pk, code_hash, version int, rotated_at)
access_sessions (id_hash pk, scope, code_version, share_link_id fk null,
                 created_at, last_seen_at, expires_at, ip_hash, user_agent, revoked_at null)
failed_attempts (id, scope, ip_hash, attempted_at)
share_links     (id, token_hash unique, label, target_type enum('event','category','person','selection'),
                 target_id null, expires_at null, revoked_at null, created_at)
share_link_photos (share_link_id fk, photo_id fk, pk)   -- for hand-picked selections
download_audit_logs (id, session_id_hash, photo_id fk null, kind enum('single','zip'),
                 photo_count, ip_hash, user_agent, created_at)
```

**"Photo appears in every featured person's profile + Family"** — handled by `photo_people`:
tagging four people creates four rows; one image file. "Family" is a
person-like collection (`is_collection = true`) so it reuses the profile UI. I suggest the admin
tags "Family" explicitly (or ticks a "whole family" shortcut that tags all five), rather than
auto-adding every multi-person photo to Family — two siblings at the beach is not necessarily a
"family" photo. Easy to change if you prefer automatic.

Indexes: `photos(taken_at desc, id)`, `photos(deleted_at)`, reverse indexes on every join
table's second column, `access_sessions(expires_at)`.

**Dropped from the suggested list:** `families`. There is exactly one family; a table that will
only ever hold one row adds joins without value. A small `settings` table (album title, default
slideshow speed) covers what it would have held.

Photo deletion is soft (`deleted_at`) with a "Recently deleted" admin view and a purge after 30
days that removes R2 objects — protection against accidental deletion of irreplaceable photos.

---

## 4. Pages & reusable components

**Public (view scope)**
| Route | Page |
|---|---|
| `/` (no session) | Access screen — code entry over a soft blurred photo backdrop |
| `/` | Home — interactive photo book |
| `/photos` | All Photos — masonry / grid toggle, filter bar, sort |
| `/people`, `/people/:slug` | Bookshelf of people → person profile (photos, count, events) |
| `/categories`, `/categories/:slug` | Bookshelf → category |
| `/events`, `/events/:slug` | Bookshelf → event (dates, people, photos) |
| `/timeline` | Year → month → day, sticky year/month jump rail |
| `/favourites` | Favourites |
| `/photo/:id` | Viewer (also opens as a modal over any list) |
| `/s/:token` | Share-link landing, scoped view |

**Admin**
`/admin` (code entry) · `/admin/upload` · `/admin/photos` (bulk metadata edit, untagged queue) ·
`/admin/people` · `/admin/categories` · `/admin/events` · `/admin/sharing` · `/admin/settings`
(codes, sessions, download activity, recently deleted).

**Components:** `AppShell`, `NavBar` (desktop) / `BottomNav` (mobile), `CodeEntryCard`,
`DownloadAuthModal`, `PhotoBook` (`BookStage`, `BookSpread`, `SpreadLayout`, `BookControls`),
`CollectionStack` (the fanned 3-photo card), `CollectionShelf`, `PhotoGrid`, `MasonryGrid`,
`PhotoTile` (blurhash → thumb), `FilterBar`, `PhotoViewer`, `MetadataPanel`, `TimelineRail`,
`UploadDropzone`, `UploadQueueItem`, `TagPicker` (people / categories / events),
`Skeleton`, `IconButton`, `Pill`, `Modal`, `MotionProvider` (global animation toggle + reduced motion).

**Photo book approach:** custom-built with Motion (3D `rotateY` spreads with receding page
stack, as in reference A) rather than a page-curl library. It matches the reference better,
gives full control of the animation toggle and reduced motion, and avoids a dependency.
Spreads are auto-composed from 2–5 photos (layouts chosen by orientation), sourced from
recent photos, favourites, or a chosen event/person. Auto-play, pause/resume, speed,
keyboard arrows, swipe/drag, click-edge-to-turn.

---

## 5. Infrastructure, cost & inactivity

| Need | Recommendation | Why | Approx. cost* |
|---|---|---|---|
| Images | **Cloudflare R2** | zero egress fees, never suspends | free to 10 GB, then ~$0.015/GB-month |
| App + DB | **Railway (Hobby)** — API and Postgres in one project | no sleeping, managed backups, deploy from Git | ~$5/month minimum, usage-based |
| Alternative | Small VPS (e.g. Hetzner) running Node + Postgres | cheapest at ~€4–5/month | you own patching and backups |
| Avoid | Supabase free (pauses after ~1 week idle), Render free Postgres (expires), any free web tier that sleeps | | |

\* Prices from my knowledge, not checked today — please confirm before signing up.

Realistic total for a family of this size: **~$5–8/month**, storage growing very slowly
(10,000 photos ≈ 40–60 GB originals + variants ≈ $1/month on R2).
Weeks without uploads cost nothing extra and nothing goes to sleep. I'd add a nightly
`pg_dump` to R2 so the metadata (which is the hard part to recreate) is backed up independently.

**Local development:** the PostgreSQL 18 already running on this machine, plus a separate
R2 *development* bucket (R2 has no official local emulator, and Docker isn't installed for MinIO).

---

## 6. Implementation plan

| Phase | Deliverable | How it's verified |
|---|---|---|
| 1 Foundation | workspaces, API skeleton, Drizzle schema + migrations, seed (people, categories), R2 client, code hashing, sessions, rate limit, access screen, admin code entry | API tests (vitest + supertest) for code validation, lockout, revocation; manual check in browser |
| 2 Photo management | presigned upload, finalise + EXIF + variants, upload UI (drag-drop, progress, cancel, previews), people/categories/events CRUD, tag pickers, bulk edit | tests for finalise and many-to-many tagging; upload real photos to dev bucket |
| 3 Browsing | library (grid/masonry, filters, sort, cursor paging), viewer, profiles, categories, events, timeline | query tests for combined filters; browser check |
| 4 Main experience | photo book, autoplay, controls, gestures, animation settings | browser check desktop + mobile viewport, reduced-motion check |
| 5 Permissions | download modal, signed downloads, ZIP, audit log, share links, code rotation, session management | security tests: no download without scope, share link can't download, rotated code kills sessions, admin routes reject view sessions |
| 6 Polish | responsive pass, accessibility (keyboard, focus, alt text, contrast), Lighthouse performance, animation tuning | Lighthouse + manual a11y checks |

Seed data: freely licensed sample photographs (e.g. Unsplash) with realistic sample metadata,
downloaded only with your OK, and kept out of production.

---

## 7. Decisions (agreed 2026-11-14)

1. **Favourites:** one shared family list; anyone with the viewing code can add or remove.
2. **Hosting:** Railway (app + Postgres) + Cloudflare R2.
3. **HEIC:** converted to high-quality JPEG on the server at upload. EXIF is read from the HEIC
   *before* conversion so dates aren't lost. The JPEG is what everyone views and downloads;
   the HEIC is kept in R2 as an archive copy (`originals/{id}.heic`), never shown.
4. **Tagging at upload:** the uploader picks people, categories and events for each photo (or a
   whole batch) in the upload screen, and can **create a new tag inline** ("+ Create 'Lagos 2026'")
   without leaving the page. "Family" is just another tag they choose. Untagged uploads are allowed
   and appear in an "Needs tagging" queue.
5. **Admin entry point:** an "Add photos" button in the navigation opens the admin code screen;
   after entering it, upload/edit/delete/settings appear. Admin sessions last 12 hours.
   **Named admin codes:** each admin (e.g. Mum, Dad, more later) has their own code — no
   accounts or usernames, the code alone identifies the admin. Gives "Uploaded by Mum",
   an admin activity log (uploads, edits, deletions) and per-person revocation.
   Schema: `admins (id, name, code_hash, code_version, active, created_at)`; `access_codes`
   keeps only the `view` and `download` scopes; `access_sessions.admin_id`;
   `photos.uploaded_by_admin_id`; `admin_activity_logs (id, admin_id, action, target_type,
   target_id, details jsonb, created_at)`.
6. **Hashing:** Node's built-in `scrypt` instead of `argon2` — equally suitable for this,
   and avoids a native dependency that can be awkward on Windows and hosting builds.

### Original open questions (resolved)

1. **Favourites without accounts.** With no user identity, "favourites" can be either
   (a) one shared family favourites list that anyone with the viewing code can add to,
   (b) admin-curated highlights only, or (c) per-device favourites that live in each browser.
   *Recommendation: (a) shared family list* — simplest and fits a single family; it's what the schema above assumes.
2. **Hosting:** Railway (managed, ~$5/month) or a VPS (cheaper, more upkeep)? *Recommendation: Railway.*
3. **iPhone HEIC photos.** The prebuilt `sharp` can't decode HEIC. Options: convert HEIC on upload
   with a pure-JS decoder (slower, but works on any host), or ask uploaders to export JPEG.
   *Recommendation: convert on upload, keeping the original HEIC for download.*
4. **Family tag:** explicit tag (recommended above) or automatic for any multi-person photo?
