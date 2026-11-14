import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type { PhotoDto } from "@family-album/shared";
import { blurhashUrl, formatTakenAt } from "../lib/format";
import { Spinner } from "./ui";

export type GridLayout = "grid" | "masonry";

export interface GridSelection {
  selected: Set<string>;
  toggle: (id: string) => void;
}

interface PhotoGridProps {
  photos: PhotoDto[];
  /** When set, tapping a photo selects it instead of opening it. */
  selection?: GridSelection;
  layout?: GridLayout;
  onOpen: (index: number) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

function Tile({
  photo,
  index,
  onOpen,
  square,
  selection,
}: {
  photo: PhotoDto;
  index: number;
  onOpen: (i: number) => void;
  square: boolean;
  selection?: GridSelection;
}) {
  const isSelected = selection?.selected.has(photo.id) ?? false;
  const [loaded, setLoaded] = useState(false);
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  const label = photo.caption ?? (photo.takenAt ? `Photo from ${formatTakenAt(photo.takenAt, false)}` : "Undated photo");
  return (
    <motion.button
      type="button"
      onClick={() => (selection ? selection.toggle(photo.id) : onOpen(index))}
      aria-pressed={selection ? isSelected : undefined}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index % 30, 12) * 0.02 }}
      className="group relative block w-full overflow-hidden rounded-xl bg-card text-left shadow-[0_1px_2px_rgb(36_37_43/0.06)] focus-visible:outline-offset-4"
      style={{
        aspectRatio: square ? "1" : String(ratio),
        backgroundImage: blurhashUrl(photo.blurhash) ? `url(${blurhashUrl(photo.blurhash)})` : undefined,
        backgroundSize: "cover",
      }}
      aria-label={selection ? `Select ${label}` : `Open ${label}`}
    >
      {photo.urls && (
        <img
          src={photo.urls.thumb}
          srcSet={`${photo.urls.thumb} 480w, ${photo.urls.md} 1200w`}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.035] ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent opacity-0 transition group-hover:opacity-100" />
      {selection && (
        <span
          aria-hidden="true"
          className={`absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full border-2 transition ${isSelected ? "border-white bg-accent text-white" : "border-white/90 bg-black/20"}`}
        >
          {isSelected && (
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M4.5 10.5 8 14l7.5-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      {isSelected && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl ring-4 ring-inset ring-accent" />}
      {photo.isFavourite && (
        <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm" role="img" aria-label="Favourite">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-9.6-9.4C1 8.3 3.1 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.8 0 5.9 3.8 4.5 7.1C19.5 16.4 12 21 12 21z" />
          </svg>
        </span>
      )}
    </motion.button>
  );
}

function useColumnCount() {
  const get = () => (window.innerWidth >= 1024 ? 4 : window.innerWidth >= 640 ? 3 : 2);
  const [count, setCount] = useState(get);
  useEffect(() => {
    const onResize = () => setCount(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return count;
}

/**
 * Photo grid in two styles: an even square grid, or a masonry layout that keeps each
 * photo's shape. Masonry places each photo in the currently shortest column (heights are
 * known from the stored dimensions), so loading more photos never reshuffles earlier ones.
 * Loads more automatically as the end comes into view.
 */
export function PhotoGrid({ photos, layout = "masonry", onOpen, hasMore, loadingMore, onLoadMore, selection }: PhotoGridProps) {
  const columnCount = useColumnCount();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore || !sentinel.current) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onLoadMore(), {
      rootMargin: "800px 0px",
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, photos.length]);

  const columns = useMemo(() => {
    const cols: { index: number; photo: PhotoDto }[][] = Array.from({ length: columnCount }, () => []);
    const heights = new Array<number>(columnCount).fill(0);
    photos.forEach((photo, index) => {
      const shortest = heights.indexOf(Math.min(...heights));
      cols[shortest]!.push({ photo, index });
      heights[shortest]! += photo.width && photo.height ? photo.height / photo.width : 0.75;
    });
    return cols;
  }, [photos, columnCount]);

  return (
    <div>
      {layout === "grid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {photos.map((photo, index) => (
            <Tile key={photo.id} photo={photo} index={index} onOpen={onOpen} square selection={selection} />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 sm:gap-3">
          {columns.map((col, c) => (
            <div key={c} className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3">
              {col.map(({ photo, index }) => (
                <Tile key={photo.id} photo={photo} index={index} onOpen={onOpen} square={false} selection={selection} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" />
      {loadingMore && (
        <div className="mt-6 flex justify-center text-muted">
          <Spinner className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

export function PhotoGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading photos">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-xl bg-card" />
      ))}
    </div>
  );
}
