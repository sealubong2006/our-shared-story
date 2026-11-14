# Our Shared Story — family photo album

A private family photo album. No accounts: access is by codes (family viewing code,
family download code, and a personal admin code for each admin). See
[docs/PLAN.md](docs/PLAN.md) for the architecture, schema and phase plan.

## Structure

```
apps/api         Express + TypeScript REST API, Drizzle ORM, PostgreSQL
apps/web         React + TypeScript + Vite + Tailwind + Motion
packages/shared  Types and validation shared by both
```

## Local development

Requirements: Node 20+, PostgreSQL.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL, TEST_DATABASE_URL, IP_HASH_SALT
npm run db:setup-local --workspace apps/api   # creates the dev + test databases
npm run db:migrate
npm run db:seed               # placeholder people (Family, Dad, Mum, Brother, Sister, Me) + categories
```

Run the API and the web app in two terminals:

```bash
npm run dev:api     # http://localhost:3001
npm run dev:web     # http://localhost:5173  (proxies /api to the API)
```

### Local development codes

A new database has no codes. Create some for local testing (see "Managing codes" below), e.g.:

```bash
npm run codes -- set-view --code "dev-view-code"
npm run codes -- set-download --code "dev-download-code"
npm run codes -- add-admin "Your name" --code "dev-admin-code"
```

Use these only locally; production codes are created on the live server (docs/DEPLOY.md).

## Cloudflare R2

Put the bucket details in `.env`, then check the connection:

```bash
npm run r2:check
```

Bucket settings:
- **Public access:** off. Browsers only ever get short-lived signed URLs from the API.
- **CORS:** allow `GET`, `PUT`, `HEAD` with header `Content-Type` from the site's origin
  (`http://localhost:5173` locally), so admins' browsers can upload directly.
- **Lifecycle rule (recommended):** delete objects with prefix `uploads/` after 1 day. These are
  temporary files; finished uploads are moved out of `uploads/` automatically, so this only
  cleans up uploads that were cancelled or interrupted.

Storage layout: `originals/{photoId}.jpg|png|webp` (the file people download),
`originals/{photoId}-original.heic` (archived iPhone original, when converted),
`variants/{photoId}/thumb|md|lg.webp`.

## Managing codes

Admins can do all of this in the app under **Admin → Settings** (and share links under
**Admin → Sharing**). The command-line tool below does the same and is handy for first-time
setup, before any admin exists.

Codes are stored only as hashes. A memorable code is generated and shown **once**;
add `--code "your own words"` to choose one yourself (minimum 8 characters).
Codes are not case- or spacing-sensitive.

```bash
npm run codes -- set-view                # new viewing code (signs out all viewers)
npm run codes -- set-download            # new download code
npm run codes -- add-admin "Mum"         # each admin has their own code
npm run codes -- reset-admin "Mum"       # new code for one admin (signs them out)
npm run codes -- disable-admin "Mum"
npm run codes -- enable-admin "Mum"
npm run codes -- list-admins
```

## Backups

The server backs up the database to R2 once a day (newest 30 kept); admins can download a copy
under Admin → Settings. `npm run backup -- list | create | save FILE | restore BACKUP --yes-replace-everything`
works locally; see [docs/DEPLOY.md](docs/DEPLOY.md) for the live server.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) (Railway + Cloudflare R2). In production the server
defaults to secure cookies and trusting one proxy, and refuses to start without the R2 settings.

## Tests

```bash
npm test            # API tests against TEST_DATABASE_URL (the test database is wiped each run)
npm run typecheck
```

## Security model (summary)

- Codes hashed with scrypt; compared on the server only.
- Sessions are random tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production);
  only a SHA-256 of the token is stored, so sessions can be revoked server-side.
- Changing a code bumps its version and invalidates every session made with the old one.
- 5 wrong codes from one IP in 15 minutes (or 20 in 24 hours) → temporary lockout, across all code types.
- Every state-changing request needs the `x-family-album` header (CSRF defence alongside SameSite).
- Downloads need the download code (or admin) on every request; originals are served through
  5-minute signed URLs, ZIPs through one-time tokens bound to the session. Every download is logged.
- Share links are random 256-bit tokens stored only as hashes; they grant view-only access to one
  collection, expire, and can be switched off instantly (ending open sessions too).
- Deleted photos are kept for 30 days in "Recently deleted", then their files and records are removed.
- The frontend only decides what to *show*; every permission is enforced by the API.
