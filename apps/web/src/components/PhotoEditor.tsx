import { useEffect, useState } from "react";
import type { PhotoDto } from "@family-album/shared";
import { ApiError } from "../lib/api";
import { useSetDeleted, useUpdatePhoto } from "../lib/queries";
import { Modal } from "./Modal";
import { TagPicker } from "./TagPicker";
import { Button, ErrorText, Field, TextArea, TextInput } from "./ui";

const DATE_SOURCE_HINT: Record<PhotoDto["takenAtSource"], string> = {
  exif: "Read from the camera. Change it if the camera clock was wrong.",
  manual: "Set by hand.",
  unknown: "The photo didn't include a date. Add one so it appears in the right place on the timeline.",
};

interface PhotoEditorProps {
  photo: PhotoDto | null;
  onClose: () => void;
}

/** Edit one photo's date, caption, location and tags, or delete it (restorable for 30 days). */
export function PhotoEditor({ photo, onClose }: PhotoEditorProps) {
  const update = useUpdatePhoto();
  const setDeleted = useSetDeleted();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!photo) return;
    setDate(photo.takenAt?.slice(0, 10) ?? "");
    const t = photo.takenAt?.slice(11, 16) ?? "";
    setTime(t === "00:00" ? "" : t);
    setCaption(photo.caption ?? "");
    setLocation(photo.locationName ?? "");
    setPersonIds(photo.people.map((p) => p.id));
    setCategoryIds(photo.categories.map((c) => c.id));
    setEventIds(photo.events.map((e) => e.id));
    setError(null);
    setConfirmDelete(false);
  }, [photo]);

  if (!photo) return <Modal open={false} onClose={onClose} title="" children={null} />;

  const originalDate = photo.takenAt ? photo.takenAt.slice(0, 16).replace(/T00:00$/, "") : "";
  const newDate = date ? (time ? `${date}T${time}` : date) : "";
  const dateChanged = newDate !== originalDate;

  async function save() {
    if (!photo) return;
    setError(null);
    try {
      await update.mutateAsync({
        id: photo.id,
        caption,
        locationName: location,
        personIds,
        categoryIds,
        eventIds,
        ...(dateChanged && { takenAt: newDate || null }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the changes.");
    }
  }

  async function remove() {
    if (!photo) return;
    try {
      await setDeleted.mutateAsync({ photoIds: [photo.id], deleted: true });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the photo.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Photo details"
      size="lg"
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto text-sm text-muted">Delete this photo? You can restore it for 30 days.</span>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove} disabled={setDeleted.isPending}>
              {setDeleted.isPending ? "Deleting…" : "Delete photo"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl bg-card">
            {photo.urls ? (
              <img
                src={photo.urls.md}
                alt={photo.caption ?? photo.originalFilename}
                className="max-h-[50dvh] w-full object-contain"
              />
            ) : (
              <div className="aspect-[4/3]" />
            )}
          </div>
          <p className="text-xs text-muted">
            {photo.originalFilename}
            {photo.width && photo.height ? ` · ${photo.width} × ${photo.height}` : ""}
            {photo.uploadedBy ? ` · uploaded by ${photo.uploadedBy}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Date taken" hint={dateChanged ? "Will be saved as set by hand." : DATE_SOURCE_HINT[photo.takenAtSource]}>
              {(id) => <TextInput id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Time">
              {(id) => (
                <TextInput id={id} type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} className="w-32" />
              )}
            </Field>
          </div>
          <Field label="Caption">
            {(id) => (
              <TextArea id={id} value={caption} maxLength={2000} onChange={(e) => setCaption(e.target.value)} placeholder="What's happening here?" />
            )}
          </Field>
          <Field label="Location">
            {(id) => (
              <TextInput id={id} value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Edinburgh" />
            )}
          </Field>
          <TagPicker kind="people" value={personIds} onChange={setPersonIds} />
          <TagPicker kind="categories" value={categoryIds} onChange={setCategoryIds} />
          <TagPicker kind="events" value={eventIds} onChange={setEventIds} />
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </Modal>
  );
}
