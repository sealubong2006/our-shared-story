import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { PhotoDto, TagRef } from "@family-album/shared";
import { useAccess } from "../lib/access";
import { blurhashUrl, formatTakenAt } from "../lib/format";
import { usePhoto, useToggleFavourite } from "../lib/queries";
import { useDownloader } from "../lib/download";
import { useFocusTrap } from "../lib/focusTrap";

// Only admins edit, so the editor (and its tag picker) is fetched when first opened.
const PhotoEditor = lazy(() => import("./PhotoEditor").then((m) => ({ default: m.PhotoEditor })));

interface PhotoViewerProps {
  photos: PhotoDto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Called when the viewer gets close to the end of the loaded photos. */
  onNeedMore?: () => void;
  hasMore?: boolean;
  /** Visitor through a share link: view only — no favourites, editing or downloads. */
  shared?: boolean;
}

function RoundButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
    >
      {children}
    </button>
  );
}

function TagLinks({ title, tags, base }: { title: string; tags: TagRef[]; base: string }) {
  if (!tags.length) return null;
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-white/50">{title}</h3>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <li key={t.id}>
            <Link to={`${base}/${t.slug}`} className="inline-block rounded-full bg-white/10 px-3 py-1 text-sm text-white transition hover:bg-white/20">
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const heartPath =
  "M12 21s-7.5-4.6-9.6-9.4C1 8.3 3.1 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.8 0 5.9 3.8 4.5 7.1C19.5 16.4 12 21 12 21z";

/**
 * Immersive full-screen viewer on the dark "stage" from the design reference.
 * Swipe or arrow keys to move, Esc to close, "i" for details, "f" to favourite.
 */
export function PhotoViewer({ photos, index, onIndexChange, onClose, onNeedMore, hasMore, shared = false }: PhotoViewerProps) {
  const photo = photos[index];
  const [direction, setDirection] = useState(0);
  const [showInfo, setShowInfo] = useState(() => window.innerWidth >= 1024);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const toggleFavourite = useToggleFavourite();
  const { data: access } = useAccess();
  const downloader = useDownloader();

  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      setDirection(delta);
      onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  // Fetch more before the end; preload neighbours so moving feels instant.
  useEffect(() => {
    if (hasMore && index >= photos.length - 4) onNeedMore?.();
    for (const n of [photos[index + 1], photos[index - 1]]) {
      if (n?.urls) new Image().src = n.urls.md;
    }
  }, [index, photos, hasMore, onNeedMore]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
      else if (e.key.toLowerCase() === "i") setShowInfo((s) => !s);
      else if (e.key.toLowerCase() === "f" && photo && !shared) toggleFavourite.mutate({ id: photo.id, favourite: !photo.isFavourite });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, photo, editing, toggleFavourite, shared]);

  if (!photo) return null;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -80 || info.velocity.x < -500) go(1);
    else if (info.offset.x > 80 || info.velocity.x > 500) go(-1);
  };

  return createPortal(
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[90] flex bg-gradient-to-b from-stage-from to-stage-to text-white"
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="relative z-10 flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <p className="ml-1 text-sm text-white/70" aria-live="polite">
            {index + 1} / {photos.length}
            {hasMore ? "+" : ""}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {!shared && (
              <RoundButton label="Download original" onClick={() => void downloader.downloadPhoto(photo.id)}>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </RoundButton>
            )}
            {!shared && (
            <RoundButton
              label={photo.isFavourite ? "Remove from favourites" : "Add to favourites"}
              pressed={photo.isFavourite}
              onClick={() => toggleFavourite.mutate({ id: photo.id, favourite: !photo.isFavourite })}
            >
              <svg viewBox="0 0 24 24" className={`h-[18px] w-[18px] ${photo.isFavourite ? "text-[#ff8a8a]" : ""}`} aria-hidden="true">
                <path d={heartPath} fill={photo.isFavourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </RoundButton>
            )}
            {access?.admin && !shared && (
              <RoundButton label="Edit details" onClick={() => setEditing(true)}>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" strokeLinejoin="round" />
                </svg>
              </RoundButton>
            )}
            <RoundButton label={showInfo ? "Hide details" : "Show details"} pressed={showInfo} onClick={() => setShowInfo((s) => !s)}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v6M12 7.5v.5" strokeLinecap="round" />
              </svg>
            </RoundButton>
          </div>
        </div>

        {/* Photo stage */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 py-4 sm:px-16">
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={photo.id}
              custom={direction}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 80, scale: 0.98 }),
                center: { opacity: 1, x: 0, scale: 1 },
                exit: (d: number) => ({ opacity: 0, x: d * -80, scale: 0.98 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={onDragEnd}
              className="flex h-full w-full touch-pan-y items-center justify-center"
            >
              {photo.urls ? (
                <img
                  src={photo.urls.lg}
                  srcSet={`${photo.urls.md} 1200w, ${photo.urls.lg} 2400w`}
                  sizes="100vw"
                  alt={photo.caption ?? (photo.takenAt ? `Photo from ${formatTakenAt(photo.takenAt, false)}` : "Undated photo")}
                  draggable={false}
                  onLoad={() => setLoaded((l) => ({ ...l, [photo.id]: true }))}
                  className="max-h-full max-w-full rounded-md object-contain shadow-[0_30px_80px_rgb(0_0_0/0.45)] transition-opacity duration-300 select-none"
                  style={{
                    aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : undefined,
                    backgroundImage: !loaded[photo.id] && blurhashUrl(photo.blurhash) ? `url(${blurhashUrl(photo.blurhash)})` : undefined,
                    backgroundSize: "cover",
                  }}
                />
              ) : (
                <p className="text-white/60">This photo isn't available right now.</p>
              )}
            </motion.div>
          </AnimatePresence>

          {canPrev && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20 sm:grid"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
                <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {canNext && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20 sm:grid"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
                <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Caption strip (always visible, short) */}
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
          <p className="text-sm text-white/80">{formatTakenAt(photo.takenAt)}</p>
          {photo.caption && <p className="mx-auto mt-1 max-w-2xl font-hand text-2xl leading-snug">{photo.caption}</p>}
        </div>
      </div>

      {/* Details panel: side panel on desktop, bottom sheet on phones */}
      <AnimatePresence>
        {showInfo && (
          <motion.aside
            aria-label="Photo details"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 z-20 max-h-[55dvh] overflow-y-auto rounded-t-3xl bg-[#1f2533]/95 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:static lg:max-h-none lg:w-80 lg:rounded-none lg:border-l lg:border-white/10 lg:bg-black/15 lg:pt-20"
          >
            <div className="mb-4 flex items-center justify-between lg:hidden">
              <h2 className="text-sm font-medium">Details</h2>
              <button type="button" onClick={() => setShowInfo(false)} className="text-sm text-white/60 hover:text-white">
                Close
              </button>
            </div>
            <div className="flex flex-col gap-5">
              <div>
                <h3 className="text-xs uppercase tracking-wide text-white/50">Taken</h3>
                <p className="mt-1 text-sm">{formatTakenAt(photo.takenAt)}</p>
                {photo.takenAtSource === "unknown" && <p className="mt-0.5 text-xs text-white/50">The photo didn't include a date.</p>}
              </div>
              {photo.caption && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-white/50">Caption</h3>
                  <p className="mt-1 text-sm leading-relaxed">{photo.caption}</p>
                </div>
              )}
              {photo.locationName && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-white/50">Where</h3>
                  <p className="mt-1 text-sm">{photo.locationName}</p>
                </div>
              )}
              <TagLinks title="People" tags={photo.people} base="/people" />
              <TagLinks title="Events" tags={photo.events} base="/events" />
              <TagLinks title="Categories" tags={photo.categories} base="/categories" />
              {photo.uploadedBy && <p className="text-xs text-white/40">Added by {photo.uploadedBy}</p>}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {editing && (
        <Suspense fallback={null}>
          <PhotoEditor photo={photo} onClose={() => setEditing(false)} />
        </Suspense>
      )}
      {downloader.dialog}
    </motion.div>,
    document.body,
  );
}

/**
 * Connects a photo list to the viewer through the URL (?photo=<id>), so the browser's
 * Back button closes the viewer and a link to a single photo can be shared.
 */
export function usePhotoViewer(
  photos: PhotoDto[],
  opts: {
    hasMore?: boolean;
    loadMore?: () => void;
    /** Show a linked photo that isn't in this list on its own (default true). */
    standalone?: boolean;
    shared?: boolean;
  } = {},
) {
  const [params, setParams] = useSearchParams();
  const openId = params.get("photo");
  const index = openId ? photos.findIndex((p) => p.id === openId) : -1;
  // A shared link to a photo that isn't in the loaded list is shown on its own.
  const standalone = opts.standalone ?? true;
  const single = usePhoto(standalone && openId && index === -1 ? openId : null);

  const setPhoto = useCallback(
    (id: string | null, replace: boolean) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("photo", id);
          else next.delete("photo");
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  const navigate = useNavigate();
  // Opening adds one history entry; closing goes back over it, so Back and Close agree.
  const openedHere = useRef(false);
  const open = useCallback(
    (i: number) => {
      if (!photos[i]) return;
      openedHere.current = true;
      setPhoto(photos[i]!.id, false);
    },
    [photos, setPhoto],
  );
  const close = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      navigate(-1);
    } else {
      setPhoto(null, true);
    }
  }, [navigate, setPhoto]);
  const change = useCallback((i: number) => photos[i] && setPhoto(photos[i]!.id, true), [photos, setPhoto]);

  const list = index >= 0 ? photos : standalone && single.data ? [single.data] : [];
  const viewer = (
    <AnimatePresence>
      {openId && list.length > 0 && (
        <PhotoViewer
          key="viewer"
          photos={list}
          index={index >= 0 ? index : 0}
          onIndexChange={change}
          onClose={close}
          onNeedMore={opts.loadMore}
          hasMore={index >= 0 ? opts.hasMore : false}
          shared={opts.shared}
        />
      )}
    </AnimatePresence>
  );
  return { open, viewer };
}
