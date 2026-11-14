import { Readable } from "node:stream";
import type { ObjectStore } from "../src/lib/storage.js";

/** In-memory stand-in for R2 so tests don't touch real storage. */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; type: string }>();

  async signedGetUrl(key: string) {
    return `memory://get/${key}`;
  }
  async signedPutUrl(key: string, contentType: string) {
    return `memory://put/${key}?type=${encodeURIComponent(contentType)}`;
  }
  async putObject(key: string, body: Buffer, type: string) {
    this.objects.set(key, { body, type });
  }
  async getObject(key: string) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`NoSuchKey: ${key}`);
    return obj.body;
  }
  async getObjectStream(key: string) {
    return Readable.from([await this.getObject(key)]);
  }
  async headObject(key: string) {
    return this.objects.get(key)?.body.length ?? null;
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async check() {}

  keys(prefix = "") {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
