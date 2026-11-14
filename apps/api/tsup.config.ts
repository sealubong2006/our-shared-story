import { defineConfig } from "tsup";

export default defineConfig({
  // Named entries keep the output layout stable (dist/index.js, dist/db/migrate.js, …).
  entry: {
    index: "src/index.ts",
    "db/migrate": "src/db/migrate.ts",
    "db/seed": "src/db/seed.ts",
    // Command-line tools, so they can be run on the server too (see docs/DEPLOY.md).
    codes: "scripts/codes.ts",
    "r2-check": "scripts/r2-check.ts",
    backup: "scripts/backup.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  // The shared workspace package is TypeScript source, so bundle it in.
  noExternal: ["@family-album/shared"],
});
