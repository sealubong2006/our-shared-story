import { useEffect, useMemo, useRef, useState } from "react";
import type { PhotoDto, PhotoListQuery } from "@family-album/shared";
import { usePhotos, useTimeline } from "../lib/queries";
import { formatDayHeading, lastDayOfMonth, monthName } from "../lib/format";
import { useMotionSettings } from "../lib/motion";
import { PageHeader } from "../components/PageHeader";
import { PhotoGrid } from "../components/PhotoGrid";
import { usePhotoViewer } from "../components/PhotoViewer";
import { Button } from "../components/ui";

const anchor = (year: number, month?: number) => (month ? `y${year}-m${month}` : `y${year}`);

/** Renders its children only once the placeholder is near the viewport. */
function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setNear(true), {
      rootMargin: "600px 0px",
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near]);
  return { ref, near };
}

/** One month: loads its photos when scrolled near, grouped by day. */
function MonthSection({ id, title, count, query }: { id: string; title: string; count: number; query: PhotoListQuery }) {
  const { ref, near } = useNearViewport<HTMLElement>();
  const photos = usePhotos({ ...query, limit: 100 }, near);
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.photos) ?? [], [photos.data]);
  const loadMore = () => {
    if (photos.hasNextPage && !photos.isFetchingNextPage) void photos.fetchNextPage();
  };
  // Several months share the page, so each only opens photos it has loaded.
  const { open, viewer } = usePhotoViewer(list, { hasMore: photos.hasNextPage, loadMore, standalone: false });

  const days = useMemo(() => {
    const groups: { day: string | null; items: { photo: PhotoDto; index: number }[] }[] = [];
    list.forEach((photo, index) => {
      const day = photo.takenAt?.slice(0, 10) ?? null;
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push({ photo, index });
      else groups.push({ day, items: [{ photo, index }] });
    });
    return groups;
  }, [list]);

  return (
    <section ref={ref} id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28">
      <h2 id={`${id}-h`} className="font-hand text-3xl font-bold">
        {title} <span className="font-sans text-sm font-normal text-muted">· {count}</span>
      </h2>
      {!near || photos.isPending ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5" style={{ minHeight: Math.min(count, 10) * 22 }}>
          {Array.from({ length: Math.min(count, 5) }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {days.map((g) => (
            <div key={g.day ?? "undated"}>
              {g.day && <h3 className="mb-2 text-sm text-muted">{formatDayHeading(g.day)}</h3>}
              <PhotoGrid photos={g.items.map((i) => i.photo)} layout="grid" onOpen={(i) => open(g.items[i]!.index)} />
            </div>
          ))}
          {photos.hasNextPage && (
            <Button className="self-center" onClick={loadMore} disabled={photos.isFetchingNextPage}>
              Show more from {title}
            </Button>
          )}
        </div>
      )}
      {viewer}
    </section>
  );
}

/** Chronological view by year → month → day, with a jump rail. */
export function TimelinePage() {
  const { data, isPending, isError, error } = useTimeline();
  const { animationsOn } = useMotionSettings();

  const years = useMemo(() => {
    const map = new Map<number, { month: number; count: number }[]>();
    for (const m of data?.months ?? []) map.set(m.year, [...(map.get(m.year) ?? []), { month: m.month, count: m.count }]);
    return [...map.entries()];
  }, [data]);

  const jump = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: animationsOn ? "smooth" : "auto", block: "start" });

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <PageHeader title="Timeline" subtitle="The album in the order things happened, using the date each photo was taken." />

      {isPending ? (
        <div className="mt-8 h-40 animate-pulse rounded-[var(--radius-card)] bg-card" />
      ) : isError ? (
        <p className="mt-8 text-sm text-danger">Couldn't load the timeline. {error.message}</p>
      ) : years.length === 0 && !data.undatedCount ? (
        <p className="py-16 text-center font-hand text-3xl text-muted">No photos yet.</p>
      ) : (
        <div className="mt-6 lg:grid lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-10">
          {/* Jump rail: sticky chips on phones, a side list on desktop */}
          <nav aria-label="Jump to year" className="sticky top-16 z-20 -mx-4 bg-paper/90 px-4 py-2 backdrop-blur-md lg:top-24 lg:mx-0 lg:self-start lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <ul className="flex gap-1.5 overflow-x-auto lg:flex-col lg:gap-0.5">
              {years.map(([year, months]) => (
                <li key={year} className="shrink-0">
                  <button type="button" onClick={() => jump(anchor(year, months[0]!.month))} className="rounded-full bg-card px-3 py-1 text-sm font-medium lg:bg-transparent lg:px-2 lg:text-base hover:bg-card-hover">
                    {year}
                  </button>
                  <ul className="hidden lg:block">
                    {months.map((m) => (
                      <li key={m.month}>
                        <button type="button" onClick={() => jump(anchor(year, m.month))} className="w-full rounded-md px-2 py-0.5 text-left text-sm text-muted hover:bg-card hover:text-ink">
                          {monthName(m.month)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {data.undatedCount > 0 && (
                <li className="shrink-0">
                  <button type="button" onClick={() => jump("undated")} className="rounded-full bg-card px-3 py-1 text-sm text-muted lg:bg-transparent lg:px-2 hover:bg-card-hover">
                    Undated
                  </button>
                </li>
              )}
            </ul>
          </nav>

          <div className="mt-6 flex flex-col gap-12 lg:mt-0">
            {years.map(([year, months]) => (
              <div key={year} className="flex flex-col gap-10">
                <p className="font-script text-5xl text-ink/80" aria-hidden="true">
                  {year}
                </p>
                {months.map((m) => (
                  <MonthSection
                    key={`${year}-${m.month}`}
                    id={anchor(year, m.month)}
                    title={`${monthName(m.month)} ${year}`}
                    count={m.count}
                    query={{
                      from: `${year}-${String(m.month).padStart(2, "0")}-01`,
                      to: lastDayOfMonth(year, m.month),
                      sort: "oldest",
                    }}
                  />
                ))}
              </div>
            ))}
            {data.undatedCount > 0 && (
              <MonthSection id="undated" title="Date unknown" count={data.undatedCount} query={{ undated: "true", sort: "uploaded" }} />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
