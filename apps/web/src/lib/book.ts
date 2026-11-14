import type { PhotoDto } from "@family-album/shared";

export interface BookItem {
  photo: PhotoDto;
  /** Position in the flat photo list (used to open the viewer). */
  index: number;
}

export type BookPage =
  | { kind: "title" }
  | { kind: "single"; items: [BookItem] }
  | { kind: "stack"; items: [BookItem, BookItem] };

export type Spread = BookPage[];

const isLandscape = (p: PhotoDto) => (p.width && p.height ? p.width / p.height > 1.15 : true);

/**
 * Lays photos out like a hand-made album: two landscape photos share a page as a
 * stacked pair (most of the time), everything else gets a page to itself. The first
 * page is a title page, as in a printed album.
 */
export function buildPages(photos: PhotoDto[]): BookPage[] {
  const pages: BookPage[] = [{ kind: "title" }];
  let i = 0;
  while (i < photos.length) {
    const current = photos[i]!;
    const next = photos[i + 1];
    // Every third page stays a single photo even when a pair is possible, for rhythm.
    if (next && isLandscape(current) && isLandscape(next) && pages.length % 3 !== 0) {
      pages.push({ kind: "stack", items: [{ photo: current, index: i }, { photo: next, index: i + 1 }] });
      i += 2;
    } else {
      pages.push({ kind: "single", items: [{ photo: current, index: i }] });
      i += 1;
    }
  }
  return pages;
}

/** Two pages per spread on wide screens, one on phones. */
export function buildSpreads(pages: BookPage[], pagesPerSpread: 1 | 2): Spread[] {
  const spreads: Spread[] = [];
  for (let i = 0; i < pages.length; i += pagesPerSpread) spreads.push(pages.slice(i, i + pagesPerSpread));
  return spreads;
}

/** Small, stable "hand-placed" tilt for a photo, so the page doesn't change on re-render. */
export function tiltFor(id: string, max = 2.2): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 1000) / 1000 - 0.5) * 2 * max;
}
