import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { PhotoListQuery } from "@family-album/shared";
import { useCategories, useEvents, usePeople, usePhotos, useTimeline } from "../lib/queries";
import { PhotoGrid, PhotoGridSkeleton, type GridLayout } from "../components/PhotoGrid";
import { usePhotoViewer } from "../components/PhotoViewer";
import { useSelectToDownload } from "../components/SelectToDownload";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui";

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-0 rounded-xl border border-line bg-white/80 px-3 text-sm text-ink outline-none focus:border-accent"
      >
        {children}
      </select>
    </label>
  );
}

const FILTER_KEYS = ["person", "category", "event", "year", "date"] as const;

/** All photos, with combinable filters kept in the URL so a filtered view can be bookmarked. */
export function PhotosPage() {
  const [params, setParams] = useSearchParams();
  const people = usePeople();
  const categories = useCategories();
  const events = useEvents();
  const timeline = useTimeline();

  const get = (k: string) => params.get(k) ?? "";
  const set = (k: string, v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(k, v);
        else next.delete(k);
        // A specific day and a year are alternatives.
        if (k === "date" && v) next.delete("year");
        if (k === "year" && v) next.delete("date");
        return next;
      },
      { replace: true },
    );

  const layout: GridLayout = get("layout") === "grid" ? "grid" : "masonry";
  const sort = get("sort") === "oldest" ? "oldest" : "newest";
  const years = useMemo(() => [...new Set(timeline.data?.months.map((m) => m.year) ?? [])], [timeline.data]);

  const query: PhotoListQuery = {
    personId: get("person") || undefined,
    categoryId: get("category") || undefined,
    eventId: get("event") || undefined,
    sort,
    ...(get("date") ? { from: get("date"), to: get("date") } : {}),
    ...(get("year") ? { from: `${get("year")}-01-01`, to: `${get("year")}-12-31` } : {}),
  };
  const photos = usePhotos(query);
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.photos) ?? [], [photos.data]);
  const loadMore = () => {
    if (photos.hasNextPage && !photos.isFetchingNextPage) void photos.fetchNextPage();
  };
  const { open, viewer } = usePhotoViewer(list, { hasMore: photos.hasNextPage, loadMore });
  const pick = useSelectToDownload(list);
  const filtered = FILTER_KEYS.some((k) => get(k));

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <PageHeader title="All photos" subtitle="Every moment in the album, newest first unless you choose otherwise." />

      <section aria-label="Filters" className="mt-6 rounded-[var(--radius-card)] bg-card/60 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Select label="Person" value={get("person")} onChange={(v) => set("person", v)}>
            <option value="">Everyone</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Category" value={get("category")} onChange={(v) => set("category", v)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Event" value={get("event")} onChange={(v) => set("event", v)}>
            <option value="">All events</option>
            {events.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Select label="Year" value={get("year")} onChange={(v) => set("year", v)}>
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted">Specific day</span>
            <input
              type="date"
              value={get("date")}
              onChange={(e) => set("date", e.target.value)}
              className="h-10 min-w-0 rounded-xl border border-line bg-white/80 px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <Select label="Order" value={sort} onChange={(v) => set("sort", v === "oldest" ? "oldest" : "")}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-card p-1" role="group" aria-label="Layout">
            {(["masonry", "grid"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                onClick={() => set("layout", l === "grid" ? "grid" : "")}
                className={`rounded-full px-3 py-1 text-xs transition ${layout === l ? "bg-paper font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {l === "masonry" ? "Natural shapes" : "Even grid"}
              </button>
            ))}
          </div>
          <div className="ml-auto">{pick.toggleButton}</div>
          {filtered && (
            <Button
              variant="ghost"
              className="h-8 px-3 text-xs"
              onClick={() =>
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  FILTER_KEYS.forEach((k) => next.delete(k));
                  return next;
                })
              }
            >
              Clear filters
            </Button>
          )}
        </div>
      </section>

      <div className="mt-6">
        {photos.isPending ? (
          <PhotoGridSkeleton />
        ) : photos.isError ? (
          <p className="text-sm text-danger">Couldn't load photos. {photos.error.message}</p>
        ) : list.length === 0 ? (
          <p className="py-16 text-center font-hand text-3xl text-muted">
            {filtered ? "No photos match these filters." : "No photos yet."}
          </p>
        ) : (
          <PhotoGrid
            photos={list}
            layout={layout}
            onOpen={open}
            hasMore={photos.hasNextPage}
            loadingMore={photos.isFetchingNextPage}
            onLoadMore={loadMore}
            selection={pick.selection}
          />
        )}
      </div>
      {viewer}
      {pick.bar}
    </main>
  );
}
