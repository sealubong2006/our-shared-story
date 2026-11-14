import { decode } from "blurhash";

/*
 * Capture dates are wall-clock strings without a timezone ("2025-12-25T09:05:00").
 * Parsing them without "Z" treats them as local time, so they display exactly as the
 * camera recorded them, whatever the viewer's timezone.
 */
const local = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value);

export function formatTakenAt(takenAt: string | null, withTime = true): string {
  if (!takenAt) return "Date unknown";
  const date = local(takenAt);
  const day = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const hasTime = takenAt.length > 10 && !takenAt.endsWith("T00:00:00");
  return withTime && hasTime
    ? `${day} · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : day;
}

export function formatShortDate(value: string): string {
  return local(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDayHeading(value: string): string {
  return local(value).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleDateString("en-GB", { month: "long" });
}

export function formatRange(startsOn: string | null, endsOn: string | null): string | null {
  if (!startsOn) return null;
  return endsOn && endsOn !== startsOn ? `${formatShortDate(startsOn)} – ${formatShortDate(endsOn)}` : formatShortDate(startsOn);
}

export function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const blurCache = new Map<string, string>();

/** Turns a stored blurhash into a tiny data URL used as a placeholder behind the photo. */
export function blurhashUrl(hash: string | null): string | undefined {
  if (!hash) return undefined;
  const cached = blurCache.get(hash);
  if (cached) return cached;
  try {
    const size = 24;
    const pixels = decode(hash, size, size);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const image = ctx.createImageData(size, size);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL();
    blurCache.set(hash, url);
    return url;
  } catch {
    return undefined;
  }
}
