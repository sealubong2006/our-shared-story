import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

// scrypt cost parameters (OWASP-recommended minimum is N=2^17 with r=8; 2^15 keeps a
// login at ~50–100ms on small hosts — still far beyond what an online attacker can use
// given the lockout). Stored with the hash so they can be raised later.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function scryptAsync(secret: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Codes are compared case- and spacing-insensitively so "Maple River 42"
 * and "maple-river-42" both work when typed on a phone.
 */
export function normaliseCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

export async function hashCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(normaliseCode(code), salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyCode(code: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split("$");
  if (algo !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scryptAsync(normaliseCode(code), Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Opaque random token for cookies and share links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashIp(ip: string | undefined, salt: string): string {
  return sha256(`${salt}:${ip ?? "unknown"}`);
}

// Short, unambiguous words that are easy to read out over the phone.
const WORDS = (
  "amber apple arrow aspen autumn basil beach berry birch bloom breeze brook candle canyon cedar " +
  "cherry cloud clover coast comet coral cotton daisy dawn delta dune ember fable fern field " +
  "flame forest fox garden ginger glade harbor hazel heron honey island ivy jasmine juniper kite " +
  "lagoon lantern lemon lily linen lotus maple meadow melon mint misty moon moss nectar oak " +
  "ocean olive orchid otter palm peach pearl pebble pine plum pond poppy quill rain raven reed " +
  "river robin rose sage sand shell sky snow sparrow spruce star stone summer sunny swan thistle " +
  "tide tulip valley velvet violet willow winter wren"
).split(" ");

/**
 * Memorable random code such as "maple-river-otter-42".
 * 3 words + 2 digits ≈ 100³×90 ≈ 10⁸ combinations; with the lockout (5 tries / 15 min)
 * guessing is impractical. Admin codes use 4 words.
 */
export function generateMemorableCode(wordCount = 3): string {
  const words = Array.from({ length: wordCount }, () => WORDS[randomInt(WORDS.length)]);
  return [...words, String(randomInt(10, 100))].join("-");
}
