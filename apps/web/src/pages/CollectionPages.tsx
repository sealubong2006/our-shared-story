import { useMemo } from "react";
import { useAccess } from "../lib/access";
import { Link, useParams } from "react-router";
import type { EventDto, PersonDto, PhotoListQuery } from "@family-album/shared";
import { type CollectionKind, useCollection, useEvents, usePhotos } from "../lib/queries";
import { formatRange } from "../lib/format";
import { CollectionCard, CollectionGridSkeleton, collectionSubtitle, PencilIcon, photoCount } from "../components/CollectionCard";
import { PageHeader } from "../components/PageHeader";
import { PhotoGrid, PhotoGridSkeleton } from "../components/PhotoGrid";
import { usePhotoViewer } from "../components/PhotoViewer";
import { useSelectToDownload } from "../components/SelectToDownload";

const COPY: Record<CollectionKind, { title: string; subtitle: string; empty: string }> = {
  people: { title: "People", subtitle: "Everyone in the album. A photo of several people appears in each of their pages.", empty: "No people yet." },
  categories: { title: "Categories", subtitle: "Photos gathered by theme.", empty: "No categories yet." },
  events: { title: "Events", subtitle: "Trips, birthdays, holidays and gatherings.", empty: "No events yet." },
};

const FILTER: Record<CollectionKind, keyof PhotoListQuery> = { people: "personId", categories: "categoryId", events: "eventId" };

/** /people, /categories, /events — the bookshelf of collections. */
export function CollectionIndexPage({ kind }: { kind: CollectionKind }) {
  const { data, isPending, isError, error } = useCollection(kind);
  const copy = COPY[kind];
  // Hide empty categories from visitors; people and events are worth showing even before photos arrive.
  const items = kind === "categories" ? data?.filter((c) => c.photoCount > 0) : data;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <div className="mt-8">
        {isPending ? (
          <CollectionGridSkeleton />
        ) : isError ? (
          <p className="text-sm text-danger">Couldn't load. {error.message}</p>
        ) : !items?.length ? (
          <p className="py-16 text-center font-hand text-3xl text-muted">{copy.empty}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <CollectionCard name={item.name} subtitle={collectionSubtitle(item)} previewUrls={item.previewUrls} to={`/${kind}/${item.slug}`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Chips({ title, items }: { title: string; items: { key: string; label: string; to: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <h2 className="text-xs uppercase tracking-wide text-muted">{title}</h2>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <li key={i.key}>
            <Link to={i.to} className="inline-block rounded-full bg-card px-3 py-1 text-sm transition hover:bg-card-hover">
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /people/:slug, /categories/:slug, /events/:slug — one collection and its photos. */
export function CollectionPage({ kind }: { kind: CollectionKind }) {
  const { slug } = useParams();
  const { data: access } = useAccess();
  const { data, isPending } = useCollection(kind);
  const events = useEvents();
  const item = data?.find((d) => d.slug === slug);

  const photos = usePhotos({ [FILTER[kind]]: item?.id }, Boolean(item));
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.photos) ?? [], [photos.data]);
  const loadMore = () => {
    if (photos.hasNextPage && !photos.isFetchingNextPage) void photos.fetchNextPage();
  };
  const { open, viewer } = usePhotoViewer(list, { hasMore: photos.hasNextPage, loadMore });
  const pick = useSelectToDownload(list);

  if (isPending) {
    return (
      <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
        <div className="h-12 w-64 animate-pulse rounded-xl bg-card" />
        <div className="mt-8">
          <PhotoGridSkeleton />
        </div>
      </main>
    );
  }
  if (!item) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
        <p className="font-hand text-3xl">This page isn't in the album any more.</p>
        <Link to={`/${kind}`} className="mt-4 inline-block text-sm underline underline-offset-4">
          Back to {COPY[kind].title.toLowerCase()}
        </Link>
      </main>
    );
  }

  const event = kind === "events" ? (item as EventDto) : null;
  const person = kind === "people" ? (item as PersonDto) : null;
  const eventPeople = event
    ? [...new Map([...event.people, ...event.taggedPeople].map((p) => [p.id, p])).values()]
    : [];
  const personEvents = person
    ? (events.data ?? []).filter((e) => [...e.people, ...e.taggedPeople].some((p) => p.id === person.id))
    : [];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/${kind}`} className="text-sm text-muted transition hover:text-ink">
          ← {COPY[kind].title}
        </Link>
        {access?.admin && (
          <Link
            to={`/admin/${kind}?edit=${item.id}`}
            className="flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-sm font-medium transition hover:bg-card-hover"
          >
            <PencilIcon />
            Edit
          </Link>
        )}
      </div>
      <div className="mt-2">
        <PageHeader
          title={item.name}
          subtitle={
            <>
              {event && formatRange(event.startsOn, event.endsOn) && <span>{formatRange(event.startsOn, event.endsOn)} · </span>}
              {photoCount(item.photoCount)}
              {item.description && <p className="mt-2 text-base text-ink/80">{item.description}</p>}
            </>
          }
        >
          <Chips title="People" items={eventPeople.map((p) => ({ key: p.id, label: p.name, to: `/people/${p.slug}` }))} />
          <Chips
            title="Events"
            items={personEvents.map((e) => ({ key: e.id, label: e.name, to: `/events/${e.slug}` }))}
          />
          {event && (
            <Chips title="Categories" items={event.categories.map((c) => ({ key: c.id, label: c.name, to: `/categories/${c.slug}` }))} />
          )}
        </PageHeader>
      </div>

      <div className="mt-6 flex justify-end">{pick.toggleButton}</div>
      <div className="mt-3">
        {photos.isPending ? (
          <PhotoGridSkeleton />
        ) : list.length === 0 ? (
          <p className="py-16 text-center font-hand text-3xl text-muted">No photos here yet.</p>
        ) : (
          <PhotoGrid photos={list} onOpen={open} hasMore={photos.hasNextPage} loadingMore={photos.isFetchingNextPage} onLoadMore={loadMore} selection={pick.selection} />
        )}
      </div>
      {viewer}
      {pick.bar}
    </main>
  );
}
