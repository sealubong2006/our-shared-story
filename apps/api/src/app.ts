import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { ObjectStore } from "./lib/storage.js";
import { loadAccess, requireCsrfHeader } from "./auth/middleware.js";
import { accessRouter } from "./routes/access.js";
import { adminRouter } from "./routes/admin.js";
import { libraryRouter } from "./routes/library.js";
import { downloadsRouter } from "./routes/downloads.js";
import { shareRouter } from "./routes/share.js";
import { HttpError } from "./lib/errors.js";

export interface AppDeps {
  db: Db;
  config: Config;
  storage: ObjectStore | null;
}

export function createApp({ db, config, storage }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY > 0) app.set("trust proxy", config.TRUST_PROXY);
  // Gzip text responses (the app bundle, JSON). Photos and ZIPs are already compressed and are skipped.
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Images and downloads come from signed R2 URLs.
          "img-src": ["'self'", "data:", "blob:", "https://*.r2.cloudflarestorage.com"],
          "connect-src": ["'self'", "https://*.r2.cloudflarestorage.com"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ ok: true });
  });

  app.use("/api", requireCsrfHeader, loadAccess(db));
  app.use("/api/access", accessRouter(db, config));
  app.use("/api/admin", adminRouter(db, storage));
  app.use("/api/downloads", downloadsRouter(db, storage, config));
  app.use("/api/share", shareRouter(db, storage));
  app.use("/api", libraryRouter(db, storage));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // In production the API also serves the built frontend (same origin → first-party cookies).
  const webDist = path.resolve(process.cwd(), "../web/dist");
  if (config.NODE_ENV === "production" && fs.existsSync(webDist)) {
    // Hashed build files never change, so browsers may keep them for a year; anything else
    // (favicon) is revalidated.
    app.use("/assets", express.static(path.join(webDist, "assets"), { index: false, maxAge: "1y", immutable: true }));
    // An old tab asking for a file from a previous deploy gets a clean 404, not the app shell.
    app.use("/assets", (_req, res) => {
      res.status(404).end();
    });
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request" });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  };
  app.use(errorHandler);

  return app;
}
