import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/** A blank variable (easy to leave in a hosting dashboard) means "not set", not "" or 0. */
const blankAsUnset = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  IP_HASH_SALT: z.string().min(16, "IP_HASH_SALT must be at least 16 characters"),
  /** Defaults to true in production (HTTPS), false otherwise. */
  COOKIE_SECURE: z
    .preprocess(blankAsUnset, z.enum(["true", "false"]).optional())
    .transform((v) => (v === undefined ? undefined : v === "true")),
  /**
   * Number of reverse proxies in front of the app (Railway = 1). Needed for correct client IPs:
   * without it every visitor looks like the proxy, so one person's wrong codes would lock out
   * the whole family. Defaults to 1 in production, 0 otherwise.
   */
  TRUST_PROXY: z.preprocess(blankAsUnset, z.coerce.number().int().min(0).optional()),
  /** Coarse per-IP request cap on code-entry endpoints, per 15 minutes. */
  ACCESS_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
});

const R2_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

const configSchema = envSchema
  .superRefine((env, ctx) => {
    // In production a missing bucket would mean uploads and photos silently fail, so refuse to start.
    if (env.NODE_ENV !== "production") return;
    for (const key of R2_KEYS) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required in production" });
    }
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
    TRUST_PROXY: env.TRUST_PROXY ?? (env.NODE_ENV === "production" ? 1 : 0),
  }));

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How long each kind of access lasts. View sessions slide forward while in use. */
export const SESSION_TTL_MS = {
  view: 30 * DAY,
  download: 2 * HOUR,
  admin: 12 * HOUR,
} as const;

/** Failed code attempts allowed per IP before a temporary lockout. */
export const LOCKOUT = {
  shortWindowMs: 15 * 60 * 1000,
  shortMaxFailures: 5,
  longWindowMs: DAY,
  longMaxFailures: 20,
} as const;
