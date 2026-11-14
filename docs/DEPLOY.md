# Deploying Our Shared Story (Railway + Cloudflare R2)

One Railway service runs everything: the API and the built website, on the same address.
A Railway PostgreSQL database holds the album's records; photos live in Cloudflare R2.

What happens on every deploy (configured in `railway.json`):

1. **Build:** `npm run build` builds the website and the API.
2. **Release:** `npm run release` applies database migrations, and on a brand-new album adds
   the starter people and categories. It never re-adds anything an admin has deleted.
3. **Start:** `npm start`. Railway waits for `/api/health` before sending visitors over.

---

## 1. Put the code where Railway can read it

A GitHub repository, public or private. Railway then redeploys automatically whenever new
code is pushed to `main`. A public repository is safe: the code contains no secrets (they live
only in Railway's variables), and forks or pull requests from other people can't deploy
anything. Only pushes to your own `main` branch do. Leave Railway's "PR environments"
switched off.

## 2. Create the Railway project

1. Sign in at railway.com → **New Project** → **Deploy from GitHub repo** → pick the repository.
2. In the same project: **+ Create** → **Database** → **PostgreSQL**.

## 3. Set the variables

Open the app service → **Variables** and add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills this in from the database) |
| `IP_HASH_SALT` | a new long random string; see below. Don't reuse the one from `.env` |
| `R2_ACCOUNT_ID` | from Cloudflare |
| `R2_ACCESS_KEY_ID` | from Cloudflare |
| `R2_SECRET_ACCESS_KEY` | from Cloudflare |
| `R2_BUCKET` | the bucket name |

To make a random salt, run this on your computer and paste the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You do **not** need to set `COOKIE_SECURE` or `TRUST_PROXY`. In production they default to
secure cookies and to trusting Railway's one proxy. The server refuses to start if any R2
variable is missing, so a typo shows up straight away instead of as broken uploads.

**Bucket:** a separate production bucket is cleaner. Photos uploaded while testing then stay
out of the real album. Reusing the development bucket also works.

## 4. Give it an address

App service → **Settings** → **Networking** → **Generate Domain** (or add your own domain).
Note the address, e.g. `https://our-shared-story.up.railway.app`.

## 5. Let browsers upload to R2 from that address

Cloudflare → R2 → your bucket → **Settings** → **CORS policy**. Add the address from step 4
to `AllowedOrigins`, keeping `http://localhost:5173` only if you use this bucket for development
too:

```json
[
  {
    "AllowedOrigins": ["https://our-shared-story.up.railway.app"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

## 6. Create the codes (once)

A new album has no codes. Create them on the server with the Railway CLI:

```bash
npm install -g @railway/cli
railway login
railway link          # pick the project and the app service
railway ssh           # opens a shell on the running server
```

Then, in that shell:

```bash
npm run codes:prod --workspace apps/api -- add-admin "Your name"
npm run codes:prod --workspace apps/api -- set-view
npm run codes:prod --workspace apps/api -- set-download
npm run r2:check:prod --workspace apps/api
```

Each code is shown **once**. Write it down. Then sign in at `/admin` and, under
**Admin → People**, rename the placeholder people (Dad, Mum, Brother, Sister, Me) to real names. After this, everything (more admins, new codes,
signing devices out) can be done in the app under **Admin → Settings**.

## 7. Check it

- Open the address and enter the viewing code.
- Sign in at `/admin` with your admin code and upload one photo, ideally an iPhone (HEIC) photo,
  to confirm conversion works on the server.
- Download that photo with the download code.

## Notes

- **Backups:** Railway's PostgreSQL has a Backups tab. Turn on scheduled backups. Photos are in R2,
  separately from the database.
- **One server:** ZIP download links are held in memory, so keep the service at one replica.
- **Clean-up** of deleted photos (after 30 days) and expired sessions runs inside the server
  every 6 hours. No cron job is needed.
