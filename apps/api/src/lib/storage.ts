import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { Config } from "../config.js";

export interface SignedGetOptions {
  expiresInSeconds?: number;
  /** Round expiry to fixed windows so the URL is identical (and cacheable) within a window. */
  windowSeconds?: number;
  downloadName?: string;
}

/**
 * Private object storage. The bucket is never public; browsers only receive short-lived
 * signed URLs, generated after the API has checked their access.
 */
export interface ObjectStore {
  signedGetUrl(key: string, opts?: SignedGetOptions): Promise<string>;
  signedPutUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  /** Streams an object (used for ZIP downloads so large files aren't held in memory). */
  getObjectStream(key: string): Promise<Readable>;
  /** Size in bytes, or null if the object does not exist. */
  headObject(key: string): Promise<number | null>;
  deleteObject(key: string): Promise<void>;
  /** Every object whose key starts with `prefix` (used for the database backups). */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  check(): Promise<void>;
}

/** Cloudflare R2 via its S3-compatible API. */
export class R2Store implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // Path-style keeps every URL on one host (simpler CSP, no TLS issues with bucket names).
      forcePathStyle: true,
      // Newer SDKs add CRC32 checksums to presigned uploads by default, which browsers
      // can't satisfy; only send checksums when an operation actually requires them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async signedGetUrl(key: string, opts: SignedGetOptions = {}): Promise<string> {
    let expiresIn = opts.expiresInSeconds ?? 300;
    let signingDate: Date | undefined;
    if (opts.windowSeconds) {
      const windowMs = opts.windowSeconds * 1000;
      signingDate = new Date(Math.floor(Date.now() / windowMs) * windowMs);
      expiresIn = opts.windowSeconds * 2; // valid for the rest of this window and the next
    }
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.downloadName
        ? `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, "_")}"`
        : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn, signingDate });
  }

  async signedPutUrl(key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Keys are immutable (new uploads get new ids), so browsers may cache for a long time.
        CacheControl: "private, max-age=31536000, immutable",
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return res.Body as Readable;
  }

  async headObject(key: string): Promise<number | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.ContentLength ?? 0;
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const found: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of page.Contents ?? []) if (o.Key) found.push({ key: o.Key, size: o.Size ?? 0 });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return found;
  }

  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

/** Returns null when R2 isn't configured yet (e.g. early local development). */
export function createStorage(config: Config): ObjectStore | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = config;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return new R2Store(R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY);
}
