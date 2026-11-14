import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessState, PhotoPage, SharedCollectionInfo } from "@family-album/shared";
import { api, ApiError } from "../lib/api";
import { ALBUM_NAME } from "../lib/brand";
import { formatShortDate } from "../lib/format";
import { PhotoGrid, PhotoGridSkeleton } from "../components/PhotoGrid";
import { usePhotoViewer } from "../components/PhotoViewer";

/**
 * /s/:token — a share link. Opening it gives this browser view-only access to just that
 * event, category, person or selection. No family code, no downloads, nothing else.
 */
export function SharedPage() {
  const { token = "" } = useParams();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"opening" | "open" | "error">("opening");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<AccessState>("/access/share", { body: { token } })
      .then((access) => {
        if (cancelled) return;
        queryClient.setQueryData(["access"], access);
        setState("open");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "This link couldn't be opened.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token, queryClient]);

  const info = useQuery({
    queryKey: ["share", token, "info"],
    queryFn: () => api<SharedCollectionInfo>("/share"),
    enabled: state === "open",
  });
  const photos = useInfiniteQuery({
    queryKey: ["share", token, "photos"],
    queryFn: ({ pageParam }) => api<PhotoPage>(`/share/photos${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: state === "open",
  });
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.photos) ?? [], [photos.data]);
  const loadMore = () => {
    if (photos.hasNextPage && !photos.isFetchingNextPage) void photos.fetchNextPage();
  };
  const { open, viewer } = usePhotoViewer(list, { hasMore: photos.hasNextPage, loadMore, standalone: false, shared: true });

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <span className="font-script text-[1.75rem] leading-none">{ALBUM_NAME}</span>
          <span className="ml-auto rounded-full bg-card px-3 py-1 text-xs text-muted">View-only link</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        {state === "error" ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <p className="font-hand text-4xl font-bold">This link can't be opened</p>
            <p className="mt-3 text-sm text-muted">{error}</p>
          </div>
        ) : (
          <>
            <h1 className="font-hand text-5xl font-bold leading-tight">{info.data?.title ?? " "}</h1>
            <p className="mt-1 text-sm text-muted">
              {info.data && (
                <>
                  Shared with you from our family album · {info.data.photoCount} photo{info.data.photoCount === 1 ? "" : "s"}
                  {info.data.expiresAt && ` · available until ${formatShortDate(info.data.expiresAt.slice(0, 10))}`}
                </>
              )}
            </p>
            <div className="mt-8">
              {state === "opening" || photos.isPending ? (
                <PhotoGridSkeleton />
              ) : photos.isError ? (
                <p className="text-sm text-danger">{photos.error.message}</p>
              ) : list.length === 0 ? (
                <p className="py-16 text-center font-hand text-3xl text-muted">There are no photos here yet.</p>
              ) : (
                <PhotoGrid
                  photos={list}
                  onOpen={open}
                  hasMore={photos.hasNextPage}
                  loadingMore={photos.isFetchingNextPage}
                  onLoadMore={loadMore}
                />
              )}
            </div>
          </>
        )}
      </main>
      {viewer}
    </div>
  );
}
