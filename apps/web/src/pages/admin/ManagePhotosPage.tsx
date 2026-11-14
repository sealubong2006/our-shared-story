import { useState } from "react";
import type { PhotoDto, PhotoListQuery } from "@family-album/shared";
import { ApiError } from "../../lib/api";
import { useBulkTag, usePhotos, useSetDeleted } from "../../lib/queries";
import { Modal } from "../../components/Modal";
import { PhotoEditor } from "../../components/PhotoEditor";
import { TagPicker } from "../../components/TagPicker";
import { ShareLinkModal } from "../../components/ShareLinkModal";
import { Button, ErrorText, Spinner, Thumb } from "../../components/ui";

const VIEWS: { id: string; label: string; query: PhotoListQuery; empty: string }[] = [
  { id: "untagged", label: "Needs tagging", query: { untagged: "true", sort: "uploaded" }, empty: "Every photo has been tagged. Lovely." },
  { id: "all", label: "All photos", query: { sort: "uploaded" }, empty: "No photos yet. Upload some to get started." },
  { id: "deleted", label: "Recently deleted", query: { deleted: "true", sort: "uploaded" }, empty: "Nothing has been deleted." },
];

function BulkTagModal({ photoIds, onClose }: { photoIds: string[]; onClose: (done: boolean) => void }) {
  const bulkTag = useBulkTag();
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nothing = !personIds.length && !categoryIds.length && !eventIds.length;

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={`Tag ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={nothing || bulkTag.isPending}
            onClick={async () => {
              try {
                await bulkTag.mutateAsync({ photoIds, personIds, categoryIds, eventIds });
                onClose(true);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Couldn't add the tags.");
              }
            }}
          >
            {bulkTag.isPending ? "Adding…" : "Add tags"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">These are added to each selected photo. Existing tags are kept.</p>
        <TagPicker kind="people" value={personIds} onChange={setPersonIds} />
        <TagPicker kind="categories" value={categoryIds} onChange={setCategoryIds} />
        <TagPicker kind="events" value={eventIds} onChange={setEventIds} />
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}

export function ManagePhotosPage() {
  const [viewId, setViewId] = useState("untagged");
  const view = VIEWS.find((v) => v.id === viewId)!;
  const photos = usePhotos(view.query);
  const setDeleted = useSetDeleted();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PhotoDto | null>(null);
  const [tagging, setTagging] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = photos.data?.pages.flatMap((p) => p.photos) ?? [];
  const isDeletedView = viewId === "deleted";

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setDeletedForSelection(deleted: boolean) {
    setError(null);
    try {
      await setDeleted.mutateAsync({ photoIds: [...selected], deleted });
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Photo lists">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={v.id === viewId}
            onClick={() => {
              setViewId(v.id);
              setSelected(new Set());
            }}
            className={`rounded-full px-4 py-2 text-sm transition ${v.id === viewId ? "bg-ink text-paper" : "bg-card text-ink hover:bg-card-hover"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {isDeletedView && (
        <p className="mt-4 text-sm text-muted">Deleted photos are hidden from the album and can be restored for 30 days.</p>
      )}

      {selected.size > 0 && (
        <div className="sticky top-[4.5rem] z-30 mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-paper shadow-[var(--shadow-lift)]">
          <span className="mr-auto text-sm">{selected.size} selected</span>
          <Button variant="ghost" className="h-9 text-paper/80 hover:bg-white/10 hover:text-paper" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {isDeletedView ? (
            <Button className="h-9" onClick={() => setDeletedForSelection(false)} disabled={setDeleted.isPending}>
              Restore
            </Button>
          ) : (
            <>
              <Button className="h-9" onClick={() => setTagging(true)}>
                Add tags
              </Button>
              <Button className="h-9" onClick={() => setSharing(true)}>
                Share
              </Button>
              <Button className="h-9 !bg-danger !text-white hover:!bg-danger/90" onClick={() => setDeletedForSelection(true)} disabled={setDeleted.isPending}>
                Delete
              </Button>
            </>
          )}
        </div>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>

      {photos.isPending ? (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : photos.isError ? (
        <p className="mt-8 text-sm text-danger">Couldn't load photos. {photos.error.message}</p>
      ) : list.length === 0 ? (
        <p className="mt-10 text-center font-hand text-2xl text-muted">{view.empty}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {list.map((photo) => {
            const isSelected = selected.has(photo.id);
            return (
              <li key={photo.id} className="group relative">
                <button
                  type="button"
                  onClick={() => (selected.size > 0 ? toggle(photo.id) : isDeletedView ? toggle(photo.id) : setEditing(photo))}
                  className={`block w-full overflow-hidden rounded-xl transition ${isSelected ? "ring-3 ring-accent ring-offset-2 ring-offset-paper" : ""}`}
                  aria-label={selected.size > 0 || isDeletedView ? `Select ${photo.originalFilename}` : `Edit ${photo.originalFilename}`}
                >
                  <Thumb src={photo.urls?.thumb} alt={photo.caption ?? photo.originalFilename} className="aspect-square w-full transition duration-300 group-hover:scale-[1.03]" />
                </button>
                <label className="absolute left-2 top-2 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-paper/90 opacity-100 shadow sm:opacity-0 sm:transition sm:group-hover:opacity-100 has-[:checked]:opacity-100">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(photo.id)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    aria-label={`Select ${photo.originalFilename}`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {photos.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button onClick={() => photos.fetchNextPage()} disabled={photos.isFetchingNextPage}>
            {photos.isFetchingNextPage ? <Spinner /> : "Load more"}
          </Button>
        </div>
      )}

      <PhotoEditor photo={editing} onClose={() => setEditing(null)} />
      {sharing && <ShareLinkModal photoIds={[...selected]} onClose={() => setSharing(false)} />}
      {tagging && (
        <BulkTagModal
          photoIds={[...selected]}
          onClose={(done) => {
            setTagging(false);
            if (done) setSelected(new Set());
          }}
        />
      )}
    </section>
  );
}
