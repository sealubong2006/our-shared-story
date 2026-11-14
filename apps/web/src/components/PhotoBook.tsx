import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion, type PanInfo } from "motion/react";
import type { PhotoDto } from "@family-album/shared";
import { type BookItem, type BookPage, buildPages, buildSpreads, tiltFor } from "../lib/book";
import { blurhashUrl, formatShortDate } from "../lib/format";
import { useMotionSettings } from "../lib/motion";
import { ALBUM_NAME } from "../lib/brand";

const SPEEDS = [
  { seconds: 4, label: "Quick" },
  { seconds: 7, label: "Gentle" },
  { seconds: 12, label: "Slow" },
];
const SPEED_KEY = "family-album:book-speed";

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.some((s) => s.seconds === v) ? v : 7;
  } catch {
    return 7;
  }
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

// ---------------------------------------------------------------- pages

function Tape({ className }: { className: string }) {
  return <span aria-hidden="true" className={`absolute h-4 w-12 bg-[#efe3c8]/80 shadow-sm ${className}`} />;
}

function Print({
  item,
  detailed,
  active,
  onOpen,
  className = "",
}: {
  item: BookItem;
  detailed: boolean;
  /** Only photos on the open spread can be opened; elsewhere a click turns to that page. */
  active: boolean;
  onOpen: (index: number) => void;
  className?: string;
}) {
  const { photo } = item;
  const tilt = tiltFor(photo.id);
  const src = detailed ? photo.urls?.md : photo.urls?.thumb;
  const label = photo.caption ?? (photo.takenAt ? `Photo from ${formatShortDate(photo.takenAt)}` : "Photo");
  return (
    <button
      type="button"
      tabIndex={active ? 0 : -1}
      onClick={(e) => {
        if (!active) return;
        e.stopPropagation();
        onOpen(item.index);
      }}
      aria-label={`Open ${label}`}
      className={`group relative flex min-h-0 flex-col bg-white p-[4%] pb-[3%] shadow-[0_2px_6px_rgb(0_0_0/0.12),0_10px_24px_rgb(0_0_0/0.08)] transition-transform duration-300 hover:scale-[1.02] ${className}`}
      style={{ rotate: `${tilt}deg` }}
    >
      <Tape className="-top-2 left-1/2 -translate-x-1/2 rotate-[-4deg]" />
      <span
        className="relative min-h-0 flex-1 overflow-hidden bg-card"
        style={{
          backgroundImage: blurhashUrl(photo.blurhash) ? `url(${blurhashUrl(photo.blurhash)})` : undefined,
          backgroundSize: "cover",
        }}
      >
        {src && <img src={src} alt="" draggable={false} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
      </span>
      {photo.caption && detailed && (
        <span className="mt-[3%] line-clamp-2 text-left font-hand text-[clamp(0.9rem,1.6vw,1.35rem)] leading-tight text-ink">
          {photo.caption}
        </span>
      )}
    </button>
  );
}

function PageView({
  page,
  side,
  detailed,
  active,
  title,
  photoTotal,
  onOpen,
}: {
  page: BookPage | undefined;
  side: "left" | "right" | "single";
  detailed: boolean;
  active: boolean;
  title: string;
  photoTotal: number;
  onOpen: (index: number) => void;
}) {
  const shade =
    side === "left"
      ? "bg-[linear-gradient(to_left,rgb(0_0_0/0.10),transparent_12%)]"
      : side === "right"
        ? "bg-[linear-gradient(to_right,rgb(0_0_0/0.10),transparent_12%)]"
        : "";
  const corner = side === "left" ? "rounded-l-md" : side === "right" ? "rounded-r-md" : "rounded-md";

  return (
    <div className={`relative h-full flex-1 overflow-hidden bg-page ${corner}`}>
      {/* paper grain + spine shadow */}
      <div className={`pointer-events-none absolute inset-0 ${shade}`} />
      {!page ? null : page.kind === "title" ? (
        <div className="flex h-full flex-col items-center justify-center p-[10%] text-center">
          <p className="font-script text-[clamp(2rem,5vw,3.6rem)] leading-tight text-ink">{title}</p>
          <p className="mt-3 text-[clamp(0.65rem,1.1vw,0.8rem)] uppercase tracking-[0.25em] text-muted">
            {photoTotal} photograph{photoTotal === 1 ? "" : "s"}
          </p>
          {title !== ALBUM_NAME && <p className="mt-6 font-script text-xl text-muted">{ALBUM_NAME}</p>}
        </div>
      ) : page.kind === "single" ? (
        <div className="flex h-full flex-col items-center justify-center p-[11%]">
          <Print item={page.items[0]} detailed={detailed} active={active} onOpen={onOpen} className="h-full w-full" />
          {page.items[0].photo.takenAt && detailed && (
            <p className="mt-[4%] font-hand text-[clamp(0.85rem,1.4vw,1.1rem)] text-muted">{formatShortDate(page.items[0].photo.takenAt)}</p>
          )}
        </div>
      ) : (
        <div className="flex h-full flex-col justify-center gap-[7%] p-[10%]">
          {page.items.map((item, i) => (
            <Print key={item.photo.id} item={item} detailed={detailed} active={active} onOpen={onOpen} className={`h-[44%] w-[86%] ${i === 0 ? "self-start" : "self-end"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the book

interface PhotoBookProps {
  photos: PhotoDto[];
  title: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (index: number) => void;
  /** Pause autoplay while something else (e.g. the viewer) is on top. */
  suspended?: boolean;
}

/**
 * The album's centrepiece: an open book on a dark stage, with the other spreads fanned
 * away in 3D on either side (after the reference design). Turns pages by itself, or by
 * arrows, swipes, clicks on the fanned pages, the keyboard or the scrubber.
 */
export function PhotoBook({ photos, title, hasMore, onLoadMore, onOpen, suspended = false }: PhotoBookProps) {
  const { animationsOn } = useMotionSettings();
  const prefersReduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const { ref: stageRef, width } = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 640;

  const spreads = useMemo(() => buildSpreads(buildPages(photos), narrow ? 1 : 2), [photos, narrow]);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(() => animationsOn && !prefersReduced);
  const [speed, setSpeed] = useState(readSpeed);
  const [hidden, setHidden] = useState(document.hidden);
  const lastPan = useRef(0);

  const last = spreads.length - 1;
  const safeCurrent = Math.min(current, Math.max(last, 0));

  // Keep the place when the layout switches between one and two pages per spread.
  const prevNarrow = useRef(narrow);
  useEffect(() => {
    if (prevNarrow.current !== narrow) {
      setCurrent((c) => (narrow ? c * 2 : Math.floor(c / 2)));
      prevNarrow.current = narrow;
    }
  }, [narrow]);

  // A new chapter starts from its title page.
  const firstId = photos[0]?.id;
  useEffect(() => setCurrent(0), [firstId]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const goTo = useCallback((i: number) => setCurrent(Math.max(0, Math.min(i, last))), [last]);

  // Fetch more photos before reaching the end of what's loaded.
  useEffect(() => {
    if (hasMore && safeCurrent >= last - 3) onLoadMore();
  }, [safeCurrent, last, hasMore, onLoadMore]);

  // Autoplay: turn the page after the chosen time; loop back to the start at the end.
  const running = playing && !suspended && !hidden && spreads.length > 1;
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      if (safeCurrent < last) setCurrent(safeCurrent + 1);
      else if (!hasMore) setCurrent(0);
    }, speed * 1000);
    return () => clearTimeout(timer);
  }, [running, safeCurrent, last, hasMore, speed]);

  const changeSpeed = (s: number) => {
    setSpeed(s);
    try {
      localStorage.setItem(SPEED_KEY, String(s));
    } catch {
      // Not saved; still applies for this visit.
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") goTo(safeCurrent + 1);
    else if (e.key === "ArrowLeft") goTo(safeCurrent - 1);
    else if (e.key === " ") setPlaying((p) => !p);
    else if (e.key === "Home") goTo(0);
    else if (e.key === "End") goTo(last);
    else return;
    e.preventDefault();
  };

  const onPanEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 50) return;
    lastPan.current = Date.now();
    goTo(safeCurrent + (info.offset.x < 0 ? 1 : -1));
  };

  const open = (index: number) => {
    if (Date.now() - lastPan.current < 300) return; // a swipe isn't a tap
    setPlaying(false);
    onOpen(index);
  };

  // Geometry: the open spread in the middle, others hinged at their inner edge and
  // turned away, each a little further along, so only their edges show — like pages fanning.
  const pageAspect = 3 / 4; // width / height of one page
  const maxHeight = narrow ? 460 : 540;
  const spreadWidth = Math.min(
    narrow ? width * 0.74 : width * 0.6,
    maxHeight * pageAspect * (narrow ? 1 : 2),
  );
  const pageHeight = spreadWidth / (pageAspect * (narrow ? 1 : 2));
  const edge = narrow ? 12 : 24;
  const gap = narrow ? 8 : 16;
  const visibleEachSide = narrow ? 3 : 6;

  const placement = (d: number) => {
    if (d === 0) return { x: 0, rotateY: 0, z: 0, scale: 1, opacity: 1 };
    const side = Math.sign(d);
    const depth = Math.min(Math.abs(d), visibleEachSide + 1);
    return {
      x: side * (spreadWidth + gap + (depth - 1) * edge),
      rotateY: side * 72,
      z: -depth * 24,
      scale: 0.97,
      opacity: Math.abs(d) > visibleEachSide ? 0 : 1,
    };
  };

  const progress = last > 0 ? safeCurrent / last : 0;

  return (
    <section
      aria-roledescription="photo book"
      aria-label={`${title} photo book`}
      className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-b from-stage-from to-stage-to text-white shadow-[var(--shadow-lift)]"
    >
      <header className="px-6 pt-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-white/60">
          {spreads.length} {narrow ? "page" : "spread"}
          {spreads.length === 1 ? "" : "s"}
          {hasMore ? "+" : ""}
        </p>
      </header>

      <motion.div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPanEnd={onPanEnd}
        aria-label="Book pages. Use the arrow keys to turn pages and the space bar to pause."
        className="relative mx-auto mt-4 touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        style={{ height: pageHeight ? pageHeight + 40 : 420, perspective: 2200 }}
      >
        <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
          {width > 0 &&
            spreads.map((spread, i) => {
              const d = i - safeCurrent;
              if (Math.abs(d) > visibleEachSide + 1) return null;
              const p = placement(d);
              return (
                <motion.div
                  key={i}
                  initial={false}
                  animate={p}
                  transition={animationsOn ? { type: "spring", stiffness: 90, damping: 20, mass: 0.9 } : { duration: 0 }}
                  onClick={() => d !== 0 && goTo(i)}
                  aria-hidden={d !== 0}
                  className={`absolute top-5 flex ${d !== 0 ? "cursor-pointer" : ""}`}
                  style={{
                    left: "50%",
                    marginLeft: -spreadWidth / 2,
                    width: spreadWidth,
                    height: pageHeight,
                    zIndex: 100 - Math.abs(d),
                    transformOrigin: d > 0 ? "left center" : d < 0 ? "right center" : "center",
                    filter: d === 0 ? "drop-shadow(0 30px 40px rgb(0 0 0 / 0.45))" : "brightness(0.92)",
                  }}
                >
                  {spread.map((page, j) => (
                    <PageView
                      key={j}
                      page={page}
                      side={spread.length === 1 ? "single" : j === 0 ? "left" : "right"}
                      detailed={Math.abs(d) <= 1}
                      active={d === 0}
                      title={title}
                      photoTotal={photos.length}
                      onOpen={open}
                    />
                  ))}
                  {spread.length === 2 && (
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10" />
                  )}
                </motion.div>
              );
            })}
        </div>
      </motion.div>

      <p className="sr-only" aria-live="polite">
        Page {safeCurrent + 1} of {spreads.length}
      </p>

      {/* Controls */}
      <div className="px-5 pb-5 pt-3 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause slideshow" : "Play slideshow"}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
          >
            {playing ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <rect x="5" y="4" width="3.5" height="12" rx="1" />
                <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2z" />
              </svg>
            )}
          </button>
          <p className="shrink-0 text-sm tabular-nums text-white/80">
            <span className="font-semibold text-white">{safeCurrent + 1}</span> / {spreads.length}
          </p>
          <div className="relative mx-1 h-6 min-w-0 flex-1">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
            <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/70" style={{ width: `${progress * 100}%` }} />
            <input
              type="range"
              min={0}
              max={Math.max(last, 0)}
              value={safeCurrent}
              onChange={(e) => goTo(Number(e.target.value))}
              aria-label="Go to page"
              aria-valuetext={`Page ${safeCurrent + 1} of ${spreads.length}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
              style={{ left: `${progress * 100}%` }}
            />
          </div>
          <label className="hidden shrink-0 items-center gap-2 text-xs text-white/70 sm:flex">
            Speed
            <select
              value={speed}
              onChange={(e) => changeSpeed(Number(e.target.value))}
              className="h-8 rounded-full border-0 bg-white/10 px-3 text-xs text-white outline-none focus:ring-2 focus:ring-white/40 [&>option]:text-ink"
            >
              {SPEEDS.map((s) => (
                <option key={s.seconds} value={s.seconds}>
                  {s.label} ({s.seconds}s)
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => goTo(safeCurrent - 1)}
            disabled={safeCurrent === 0}
            aria-label="Previous page"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => goTo(0)}
            disabled={safeCurrent === 0}
            className="h-9 rounded-full bg-white/10 px-4 text-xs transition hover:bg-white/20 disabled:opacity-30"
          >
            Back to the start
          </button>
          <label className="flex items-center gap-2 text-xs text-white/70 sm:hidden">
            <span className="sr-only">Speed</span>
            <select
              value={speed}
              onChange={(e) => changeSpeed(Number(e.target.value))}
              className="h-9 rounded-full border-0 bg-white/10 px-3 text-xs text-white outline-none [&>option]:text-ink"
            >
              {SPEEDS.map((s) => (
                <option key={s.seconds} value={s.seconds}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => goTo(safeCurrent + 1)}
            disabled={safeCurrent >= last}
            aria-label="Next page"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
