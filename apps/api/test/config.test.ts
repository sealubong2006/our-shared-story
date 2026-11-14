import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x", IP_HASH_SALT: "a-long-enough-test-salt" };
const r2 = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" };

describe("config", () => {
  it("uses relaxed defaults in development", () => {
    const c = loadConfig({ ...base });
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.TRUST_PROXY).toBe(0);
  });

  it("uses secure cookies and trusts one proxy in production by default", () => {
    const c = loadConfig({ ...base, ...r2, NODE_ENV: "production" });
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.TRUST_PROXY).toBe(1);
  });

  it("lets explicit settings override the production defaults", () => {
    const c = loadConfig({ ...base, ...r2, NODE_ENV: "production", COOKIE_SECURE: "false", TRUST_PROXY: "2" });
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.TRUST_PROXY).toBe(2);
  });

  it("treats blank settings as unset rather than false or 0", () => {
    const c = loadConfig({ ...base, ...r2, NODE_ENV: "production", COOKIE_SECURE: "", TRUST_PROXY: " " });
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.TRUST_PROXY).toBe(1);
  });

  it("refuses to start in production without R2", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", R2_BUCKET: "d" })).toThrow(/R2_ACCOUNT_ID: is required/);
  });
});
