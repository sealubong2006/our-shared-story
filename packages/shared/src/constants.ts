/**
 * Plain values shared by the API and the web app. Kept free of zod so the browser bundle
 * can import them without pulling in the validation library.
 */

/** Header every mutating request must carry (basic CSRF defence alongside SameSite cookies). */
export const CSRF_HEADER = "x-family-album";
export const CSRF_HEADER_VALUE = "1";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 100;

/** Accepted upload types. HEIC/HEIF (iPhone) is converted to JPEG on the server. */
export const UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

/** Some browsers (Windows) report an empty type for .heic files, so fall back to the extension. */
export function uploadTypeFor(file: { name: string; type: string }): string | null {
  if (file.type && UPLOAD_TYPES[file.type]) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return (ext && byExt[ext]) || null;
}

export const MAX_ZIP_PHOTOS = 200;
