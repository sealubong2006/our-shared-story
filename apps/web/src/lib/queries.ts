import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BulkTag,
  CategoryDto,
  CreateCollection,
  CreateEvent,
  EventDto,
  PersonDto,
  PhotoDto,
  PhotoListQuery,
  PhotoPage,
  TagRef,
  TimelineSummary,
  UpdateCollection,
  UpdateEvent,
  UpdatePhoto,
} from "@family-album/shared";
import { api } from "./api";

export type CollectionKind = "people" | "categories" | "events";

export const keys = {
  collection: (kind: CollectionKind) => [kind] as const,
  photos: (query: PhotoListQuery) => ["photos", query] as const,
  allPhotos: ["photos"] as const,
};

// ---------------------------------------------------------------- reads

export const usePeople = () => useQuery({ queryKey: keys.collection("people"), queryFn: () => api<PersonDto[]>("/people") });
export const useCategories = () =>
  useQuery({ queryKey: keys.collection("categories"), queryFn: () => api<CategoryDto[]>("/categories") });
export const useEvents = () => useQuery({ queryKey: keys.collection("events"), queryFn: () => api<EventDto[]>("/events") });

/** Any of the three collection lists (shares the cache with usePeople/useCategories/useEvents). */
export function useCollection(kind: CollectionKind) {
  return useQuery({
    queryKey: keys.collection(kind),
    queryFn: () => api<(PersonDto | CategoryDto | EventDto)[]>(`/${kind}`),
  });
}

function toSearch(query: PhotoListQuery & { cursor?: string }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  return params.toString();
}

export function usePhotos(query: PhotoListQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.photos(query),
    queryFn: ({ pageParam }) => api<PhotoPage>(`/photos?${toSearch({ ...query, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export const useTimeline = () =>
  useQuery({ queryKey: ["timeline"], queryFn: () => api<TimelineSummary>("/timeline") });

export function usePhoto(id: string | null) {
  return useQuery({ queryKey: ["photo", id], queryFn: () => api<PhotoDto>(`/photos/${id}`), enabled: Boolean(id) });
}

// ---------------------------------------------------------------- writes

/**
 * Favourite toggle with an instant (optimistic) update in every loaded photo list;
 * rolled back if the server refuses.
 */
export function useToggleFavourite() {
  const qc = useQueryClient();
  const apply = (id: string, value: boolean) => {
    const patch = (p: PhotoDto) => (p.id === id ? { ...p, isFavourite: value } : p);
    qc.setQueriesData<InfiniteData<PhotoPage>>({ queryKey: keys.allPhotos }, (data) =>
      data ? { ...data, pages: data.pages.map((pg) => ({ ...pg, photos: pg.photos.map(patch) })) } : data,
    );
    qc.setQueryData<PhotoDto>(["photo", id], (p) => (p ? patch(p) : p));
  };
  return useMutation({
    mutationFn: ({ id, favourite }: { id: string; favourite: boolean }) =>
      api<void>(`/photos/${id}/favourite`, { method: favourite ? "PUT" : "DELETE" }),
    onMutate: ({ id, favourite }) => apply(id, favourite),
    onError: (_err, { id, favourite }) => apply(id, !favourite),
    // The Favourites list itself must refetch to gain or lose the photo.
    onSettled: () =>
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "photos" && (q.queryKey[1] as PhotoListQuery | undefined)?.favourites === "true",
      }),
  });
}

/** After any change, refresh photo lists and collection counts/previews. */
function useInvalidateAlbum() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.allPhotos }),
      qc.invalidateQueries({ queryKey: keys.collection("people") }),
      qc.invalidateQueries({ queryKey: keys.collection("categories") }),
      qc.invalidateQueries({ queryKey: keys.collection("events") }),
    ]);
}

export function useUpdatePhoto() {
  const invalidate = useInvalidateAlbum();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdatePhoto & { id: string }) =>
      api<PhotoDto>(`/admin/photos/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useBulkTag() {
  const invalidate = useInvalidateAlbum();
  return useMutation({
    mutationFn: (body: BulkTag) => api<void>("/admin/photos/bulk-tag", { body }),
    onSuccess: invalidate,
  });
}

export function useSetDeleted() {
  const invalidate = useInvalidateAlbum();
  return useMutation({
    mutationFn: ({ photoIds, deleted }: { photoIds: string[]; deleted: boolean }) =>
      api<{ count: number }>(`/admin/photos/${deleted ? "bulk-delete" : "bulk-restore"}`, { body: { photoIds } }),
    onSuccess: invalidate,
  });
}

export function useCreateCollection(kind: CollectionKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCollection | CreateEvent) => api<TagRef>(`/admin/${kind}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.collection(kind) }),
  });
}

export function useUpdateCollection(kind: CollectionKind) {
  const invalidate = useInvalidateAlbum();
  return useMutation({
    mutationFn: ({ id, ...body }: (UpdateCollection | UpdateEvent) & { id: string }) =>
      api<void>(`/admin/${kind}/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteCollection(kind: CollectionKind) {
  const invalidate = useInvalidateAlbum();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/${kind}/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export { useInvalidateAlbum };
