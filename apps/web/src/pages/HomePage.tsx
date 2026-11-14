import { useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { Link, useSearchParams } from "react-router";
import type { PhotoListQuery } from "@family-album/shared";
import { ALBUM_NAME, ALBUM_TAGLINE } from "../lib/brand";
import { useEvents, usePeople, usePhotos } from "../lib/queries";
import { PhotoBook } from "../components/PhotoBook";
import { PhotoStack } from "../components/PhotoStack";
import { usePhotoViewer } from "../components/PhotoViewer";
import { useAccess } from "../lib/access";

interface Chapter {
  id: string;
  title: string;
  query: PhotoListQuery;
}

/**
 * Home: the welcome and the photo book. The book's "chapter" (whole story, favourites,
 * recently added, an event or a person) is kept in the URL so it survives a refresh.
 */
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const events = useEvents();
  const people = usePeople();
  const { data: access } = useAccess();

  const chapters = useMemo<Chapter[]>(
    () => [
      { id: "story", title: ALBUM_NAME, query: { sort: "oldest" } },
      { id: "favourites", title: "Favourites", query: { favourites: "true", sort: "oldest" } },
      { id: "recent", title: "Recently added", query: { sort: "uploaded" } },
      ...(events.data ?? [])
        .filter((e) => e.photoCount > 0)
        .map((e) => ({ id: `event:${e.slug}`, title: e.name, query: { eventId: e.id, sort: "oldest" as const } })),
      ...(people.data ?? [])
        .filter((p) => p.photoCount > 0)
        .map((p) => ({ id: `person:${p.slug}`, title: p.name, query: { personId: p.id, sort: "oldest" as const } })),
    ],
    [events.data, people.data],
  );

  const chapterId = params.get("chapter") ?? "story";
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0]!;
  const waitingForChapter = chapterId !== "story" && !chapters.some((c) => c.id === chapterId) && (events.isPending || people.isPending);

  const photos = usePhotos({ ...chapter.query, limit: 60 }, !waitingForChapter);
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.photos) ?? [], [photos.data]);
  const loadMore = useCallback(() => {
    if (photos.hasNextPage && !photos.isFetchingNextPage) void photos.fetchNextPage();
  }, [photos]);
  const { open, viewer } = usePhotoViewer(list, { hasMore: photos.hasNextPage, loadMore });

  const chooseChapter = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "story") next.delete("chapter");
        else next.set("chapter", id);
        return next;
      },
      { replace: true },
    );

  const quick = chapters.slice(0, 3);
  const more = chapters.slice(3);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto flex max-w-2xl flex-col items-center text-center"
      >
        <h1 className="font-script text-6xl leading-tight text-ink sm:text-7xl">{ALBUM_NAME}</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{ALBUM_TAGLINE}</p>
      </motion.section>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="mt-10"
      >
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Choose a chapter">
          {quick.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chapter.id === c.id}
              onClick={() => chooseChapter(c.id)}
              className={`rounded-full px-4 py-2 text-sm transition ${chapter.id === c.id ? "bg-ink text-paper" : "bg-card text-ink hover:bg-card-hover"}`}
            >
              {c.id === "story" ? "Our whole story" : c.title}
            </button>
          ))}
          {more.length > 0 && (
            <label className="flex items-center">
              <span className="sr-only">An event or a person</span>
              <select
                value={more.some((c) => c.id === chapter.id) ? chapter.id : ""}
                onChange={(e) => e.target.value && chooseChapter(e.target.value)}
                className={`h-9 rounded-full border-0 px-4 text-sm outline-none focus:ring-2 focus:ring-accent ${more.some((c) => c.id === chapter.id) ? "bg-ink text-paper" : "bg-card text-ink"}`}
              >
                <option value="">An event or a person…</option>
                <optgroup label="Events">
                  {more.filter((c) => c.id.startsWith("event:")).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="People">
                  {more.filter((c) => c.id.startsWith("person:")).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          )}
        </div>

        {photos.isPending || waitingForChapter ? (
          <div className="h-[34rem] animate-pulse rounded-[1.75rem] bg-gradient-to-b from-stage-from to-stage-to opacity-80" aria-busy="true" aria-label="Loading the book" />
        ) : photos.isError ? (
          <p className="text-center text-sm text-danger">Couldn't open the book. {photos.error.message}</p>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center rounded-[var(--radius-card)] bg-card/70 px-6 py-14 text-center">
            <PhotoStack className="w-48" interactive />
            <p className="mt-6 font-hand text-3xl font-bold">
              {chapter.id === "story" ? "The book is waiting for its first photographs" : "No photos in this chapter yet"}
            </p>
            {chapter.id === "favourites" && <p className="mt-2 text-sm text-muted">Tap the heart on any photo to add it here.</p>}
            {chapter.id === "story" && access?.admin && (
              <Link to="/admin/upload" className="mt-5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper">
                Add the first photos
              </Link>
            )}
          </div>
        ) : (
          <PhotoBook
            key={chapter.id}
            photos={list}
            title={chapter.title}
            hasMore={Boolean(photos.hasNextPage)}
            onLoadMore={loadMore}
            onOpen={open}
            suspended={params.has("photo")}
          />
        )}
      </motion.div>
      {viewer}
    </main>
  );
}
