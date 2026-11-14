import { useEffect, useState } from "react";
import type { CategoryDto, EventDto, PersonDto } from "@family-album/shared";
import { useSearchParams } from "react-router";
import { ApiError } from "../../lib/api";
import {
  type CollectionKind,
  useCollection,
  useCreateCollection,
  useDeleteCollection,
  usePhotos,
  useUpdateCollection,
} from "../../lib/queries";
import { Modal } from "../../components/Modal";
import { CollectionCard, collectionSubtitle } from "../../components/CollectionCard";
import { TagPicker } from "../../components/TagPicker";
import { Button, ErrorText, Field, Spinner, TextArea, TextInput, Thumb } from "../../components/ui";

type Item = PersonDto | CategoryDto | EventDto;

const COPY: Record<CollectionKind, { singular: string; add: string; deleteNote: string; coverLabel: string }> = {
  people: {
    singular: "person",
    add: "Add person",
    deleteNote: "Their photos stay in the album; they're just no longer tagged with this person.",
    coverLabel: "Profile photo",
  },
  categories: {
    singular: "category",
    add: "Add category",
    deleteNote: "Its photos stay in the album; they're just no longer in this category.",
    coverLabel: "Cover photo",
  },
  events: {
    singular: "event",
    add: "Add event",
    deleteNote: "Its photos stay in the album; they're just no longer linked to this event.",
    coverLabel: "Cover photo",
  },
};

const filterKey: Record<CollectionKind, "personId" | "categoryId" | "eventId"> = {
  people: "personId",
  categories: "categoryId",
  events: "eventId",
};

function CoverPicker({ kind, item, value, onChange }: { kind: CollectionKind; item: Item; value: string | null; onChange: (id: string | null) => void }) {
  const photos = usePhotos({ [filterKey[kind]]: item.id, limit: 24 });
  const list = photos.data?.pages.flatMap((p) => p.photos) ?? [];
  if (photos.isPending) return <Spinner className="h-5 w-5 text-muted" />;
  if (list.length === 0) return <p className="text-sm text-muted">Tag some photos first, then choose one here.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id === value ? null : p.id)}
            aria-pressed={p.id === value}
            aria-label={`Use ${p.originalFilename} as cover`}
            className={`overflow-hidden rounded-lg transition ${p.id === value ? "ring-3 ring-accent ring-offset-2 ring-offset-paper" : "opacity-80 hover:opacity-100"}`}
          >
            <Thumb src={p.urls?.thumb} alt="" className="aspect-square w-full" />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{value ? "Tap the selected photo again to go back to the latest photos." : "Without a choice, the latest photos are shown."}</p>
    </div>
  );
}

function EditModal({ kind, item, onClose }: { kind: CollectionKind; item: Item | "new"; onClose: () => void }) {
  const copy = COPY[kind];
  const isNew = item === "new";
  const create = useCreateCollection(kind);
  const update = useUpdateCollection(kind);
  const remove = useDeleteCollection(kind);
  const event = !isNew && kind === "events" ? (item as EventDto) : null;

  const [name, setName] = useState(isNew ? "" : item.name);
  const [description, setDescription] = useState(isNew ? "" : (item.description ?? ""));
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(isNew ? null : item.coverPhotoId);
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? "");
  const [personIds, setPersonIds] = useState<string[]>(event?.people.map((p) => p.id) ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(event?.categories.map((c) => c.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setError(null), [name]);
  const saving = create.isPending || update.isPending;

  async function save() {
    setError(null);
    const eventFields = kind === "events" ? { startsOn: startsOn || null, endsOn: endsOn || null, personIds, categoryIds } : {};
    try {
      if (isNew) await create.mutateAsync({ name, description, ...eventFields });
      else await update.mutateAsync({ id: item.id, name, description, coverPhotoId, ...eventFields });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    }
  }

  async function doDelete() {
    if (isNew) return;
    try {
      await remove.mutateAsync(item.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? copy.add : `Edit ${copy.singular}`}
      size={isNew ? "md" : "lg"}
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto text-sm text-muted">Delete “{name}”? {copy.deleteNote}</span>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </>
        ) : (
          <>
            {!isNew && (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : isNew ? "Create" : "Save changes"}
            </Button>
          </>
        )
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          {(id) => <TextInput id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />}
        </Field>
        <Field label="Description" hint="Optional">
          {(id) => <TextArea id={id} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        {kind === "events" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                {(id) => <TextInput id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
              </Field>
              <Field label="Ends" hint="Leave empty for a single day">
                {(id) => <TextInput id={id} type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} />}
              </Field>
            </div>
            <TagPicker kind="people" value={personIds} onChange={setPersonIds} />
            <TagPicker kind="categories" value={categoryIds} onChange={setCategoryIds} />
          </>
        )}
        {!isNew && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{copy.coverLabel}</span>
            <CoverPicker kind={kind} item={item} value={coverPhotoId} onChange={setCoverPhotoId} />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Manage people, categories or events: the "bookshelf" of collections with add/edit/delete. */
export function CollectionsAdminPage({ kind }: { kind: CollectionKind }) {
  const { data, isPending, isError, error } = useCollection(kind);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const copy = COPY[kind];

  // Arriving from an "Edit" button elsewhere (/admin/people?edit=<id>) opens that one straight away.
  const [params, setParams] = useSearchParams();
  const editId = params.get("edit");
  useEffect(() => {
    if (!editId || !data) return;
    const item = data.find((i) => i.id === editId);
    if (item) setEditing(item);
    setParams({}, { replace: true });
  }, [editId, data, setParams]);

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            {data ? `${data.length} ${data.length === 1 ? copy.singular : kind === "people" ? "people" : kind}` : " "}
          </p>
          <p className="text-sm text-muted">Tap one to fix its name, change its picture or delete it.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          {copy.add}
        </Button>
      </div>

      {isPending ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[4/3.6] animate-pulse rounded-[var(--radius-card)] bg-card" />
          ))}
        </div>
      ) : isError ? (
        <p className="mt-8 text-sm text-danger">Couldn't load. {error.message}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((item) => (
            <li key={item.id}>
              <CollectionCard
                name={item.name}
                subtitle={collectionSubtitle(item)}
                previewUrls={item.previewUrls}
                onClick={() => setEditing(item)}
                editable
              />
            </li>
          ))}
        </ul>
      )}

      {editing && <EditModal key={editing === "new" ? "new" : editing.id} kind={kind} item={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
