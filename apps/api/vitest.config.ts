import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/env.ts"],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
