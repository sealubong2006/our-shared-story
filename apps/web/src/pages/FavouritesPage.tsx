import { useMemo } from "react";
import { usePhotos } from "../lib/queries";
import { PageHeader } from "../components/PageHeader";
import { PhotoGrid, PhotoGridSkeleton } from "../components/PhotoGrid";
import { usePhotoViewer } from "../components/PhotoViewer";
import { useSelectToDownload } from "../components/SelectToDownload";

/** The family's shared favourites list. */
export function FavouritesPage() {
  const photos = usePhotos({ favourites: "true" });
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.photos) ?? [], [photos.data]);
  const loadMore = () => {
    if (photos.hasNextPage && !photos.isFetchingNextPage) void photos.fetchNextPage();
  };
  const { open, viewer } = usePhotoViewer(list, { hasMore: photos.hasNextPage, loadMore });
  const pick = useSelectToDownload(list);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <PageHeader title="Favourites" subtitle="Photos the family has hearted. Anyone can add or remove a favourite from the photo viewer." />
      <div className="mt-6 flex justify-end">{pick.toggleButton}</div>
      <div className="mt-3">
        {photos.isPending ? (
          <PhotoGridSkeleton />
        ) : photos.isError ? (
          <p className="text-sm text-danger">Couldn't load favourites. {photos.error.message}</p>
        ) : list.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-hand text-3xl text-muted">No favourites yet.</p>
            <p className="mt-2 text-sm text-muted">Open any photo and tap the heart to add it here.</p>
          </div>
        ) : (
          <PhotoGrid photos={list} onOpen={open} hasMore={photos.hasNextPage} loadingMore={photos.isFetchingNextPage} onLoadMore={loadMore} selection={pick.selection} />
        )}
      </div>
      {viewer}
      {pick.bar}
    </main>
  );
}
