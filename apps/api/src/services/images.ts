import sharp, { type Sharp } from "sharp";
import exifr from "exifr";
import { encode as encodeBlurhash } from "blurhash";
import decodeHeic from "heic-decode";

export type SourceFormat = "jpeg" | "png" | "webp" | "heic";

const MIME: Record<SourceFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};
const EXT: Record<SourceFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", heic: "heic" };

export class ImageError extends Error {}

/** Identify the real file type from its first bytes — the browser-reported type isn't trusted. */
export function sniffFormat(buf: Buffer): SourceFormat | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

export const VARIANTS = [
  { kind: "thumb", maxSize: 480, quality: 72 },
  { kind: "md", maxSize: 1200, quality: 80 },
  { kind: "lg", maxSize: 2400, quality: 82 },
] as const;
export type VariantKind = (typeof VARIANTS)[number]["kind"];

export interface ProcessedImage {
  /** The file people view and download (HEIC becomes JPEG). */
  display: { buffer: Buffer; mime: string; ext: string };
  /** Untouched original, kept only when it had to be converted. */
  archive: { buffer: Buffer; mime: string; ext: string } | null;
  width: number;
  height: number;
  /**
   * Capture time as the wall-clock time on the camera, stored as if UTC.
   * EXIF dates carry no reliable timezone, so this keeps "14:30 on Christmas Day"
   * as 14:30 wherever the album is viewed.
   */
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  blurhash: string | null;
  variants: { kind: VariantKind; buffer: Buffer; width: number; height: number }[];
}

/** "2025:12:25 14:30:05" (EXIF) → Date with those wall-clock values in UTC. */
export function parseExifDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  if (y! < 1900 || y! > 2100) return null; // cameras with unset clocks report 0000 or 1970
  const date = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
  return Number.isNaN(date.getTime()) ? null : date;
}

interface ExifData {
  date: Date | null;
  latitude: number | null;
  longitude: number | null;
  raw: { DateTimeOriginal?: string; Make?: string; Model?: string };
}

async function readExif(buf: Buffer): Promise<ExifData> {
  const empty: ExifData = { date: null, latitude: null, longitude: null, raw: {} };
  try {
    const tags = (await exifr.parse(buf, {
      pick: ["DateTimeOriginal", "CreateDate", "DateTimeDigitized", "Make", "Model"],
      reviveValues: false,
    })) as Record<string, unknown> | undefined;
    let gps: { latitude?: number; longitude?: number } | undefined;
    try {
      gps = await exifr.gps(buf);
    } catch {
      gps = undefined;
    }
    const dateString = [tags?.DateTimeOriginal, tags?.CreateDate, tags?.DateTimeDigitized].find(
      (v) => typeof v === "string",
    ) as string | undefined;
    const valid = (n: unknown, limit: number) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit ? n : null);
    return {
      date: parseExifDate(dateString),
      latitude: valid(gps?.latitude, 90),
      longitude: valid(gps?.longitude, 180),
      raw: {
        DateTimeOriginal: dateString,
        Make: typeof tags?.Make === "string" ? tags.Make : undefined,
        Model: typeof tags?.Model === "string" ? tags.Model : undefined,
      },
    };
  } catch {
    return empty;
  }
}

async function blurhashFor(image: Sharp): Promise<string | null> {
  try {
    const { data, info } = await image
      .clone()
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}

/**
 * Validates an uploaded image and produces everything we store:
 * the display file, an archive of the original if converted, WebP size variants,
 * EXIF capture date / GPS, dimensions and a blurhash placeholder.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const format = sniffFormat(input);
  if (!format) throw new ImageError("This file isn't a supported image (JPEG, PNG, WebP or HEIC).");

  const exif = await readExif(input);

  let display: ProcessedImage["display"];
  let archive: ProcessedImage["archive"] = null;
  let base: Sharp;

  if (format === "heic") {
    let decoded: Awaited<ReturnType<typeof decodeHeic>>;
    try {
      decoded = await decodeHeic({ buffer: new Uint8Array(input) });
    } catch {
      throw new ImageError("This HEIC photo couldn't be read. Try exporting it as JPEG.");
    }
    const raw = { width: decoded.width, height: decoded.height, channels: 4 as const };
    const pixels = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    // libheif already applies the HEIC rotation, so no EXIF auto-rotate here.
    // The capture date and camera are written into the JPEG so it keeps them when downloaded.
    const exifOut: Record<string, Record<string, string>> = {};
    if (exif.raw.Make || exif.raw.Model) {
      exifOut.IFD0 = {
        ...(exif.raw.Make && { Make: exif.raw.Make }),
        ...(exif.raw.Model && { Model: exif.raw.Model }),
      };
    }
    if (exif.raw.DateTimeOriginal) exifOut.IFD2 = { DateTimeOriginal: exif.raw.DateTimeOriginal };
    let encoder = sharp(pixels, { raw });
    if (Object.keys(exifOut).length > 0) encoder = encoder.withExif(exifOut);
    const jpeg = await encoder.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    display = { buffer: jpeg, mime: "image/jpeg", ext: "jpg" };
    archive = { buffer: input, mime: MIME.heic, ext: EXT.heic };
    base = sharp(pixels, { raw });
  } else {
    display = { buffer: input, mime: MIME[format], ext: EXT[format] };
    base = sharp(input, { failOn: "error" }).rotate(); // apply EXIF orientation
  }

  let width: number;
  let height: number;
  try {
    const meta = await sharp(display.buffer).metadata();
    const swap = format !== "heic" && (meta.orientation ?? 1) >= 5;
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
    if (!width || !height) throw new Error("no dimensions");
  } catch {
    throw new ImageError("This image appears to be damaged and couldn't be read.");
  }

  const variants: ProcessedImage["variants"] = [];
  for (const v of VARIANTS) {
    const { data, info } = await base
      .clone()
      .resize({ width: v.maxSize, height: v.maxSize, fit: "inside", withoutEnlargement: true })
      .webp({ quality: v.quality })
      .toBuffer({ resolveWithObject: true });
    variants.push({ kind: v.kind, buffer: data, width: info.width, height: info.height });
  }

  return {
    display,
    archive,
    width,
    height,
    takenAt: exif.date,
    latitude: exif.latitude,
    longitude: exif.longitude,
    blurhash: await blurhashFor(base),
    variants,
  };
}
