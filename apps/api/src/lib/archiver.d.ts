/** Minimal types for archiver v8 (the package ships none; @types/archiver describes v6). */
declare module "archiver" {
  import type { Readable, Transform } from "node:stream";
  export class ZipArchive extends Transform {
    constructor(options?: { zlib?: { level?: number }; store?: boolean });
    append(source: Readable | Buffer | string, data: { name: string; date?: Date }): this;
    finalize(): Promise<void>;
    abort(): this;
    pointer(): number;
  }
}
