import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PhotoDto, PresignedUpload } from "@family-album/shared";
import { MAX_FILES_PER_BATCH, MAX_UPLOAD_BYTES, uploadTypeFor } from "@family-album/shared/constants";
import { api, ApiError } from "../../lib/api";
import { useInvalidateAlbum } from "../../lib/queries";
import { putToStorage, runWithConcurrency } from "../../lib/upload";
import { PhotoEditor } from "../../components/PhotoEditor";
import { TagPicker } from "../../components/TagPicker";
import { Button, Spinner, Thumb } from "../../components/ui";

type Status = "ready" | "uploading" | "processing" | "done" | "error" | "cancelled";

interface QueueItem {
  id: string;
  file: File;
  type: string | null;
  previewUrl: string | null;
  status: Status;
  progress: number;
  error: string | null;
  photo: PhotoDto | null;
}

const CONCURRENCY = 3;

function validate(file: File): { type: string | null; error: string | null } {
  const type = uploadTypeFor(file);
  if (!type) return { type: null, error: "Not a supported photo (JPEG, PNG, WebP or HEIC)." };
  if (file.size > MAX_UPLOAD_BYTES) return { type, error: "Larger than 50 MB." };
  return { type, error: null };
}

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function UploadPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<PhotoDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<string, () => void>());
  const cancelled = useRef(new Set<string>());
  const invalidate = useInvalidateAlbum();

  const patch = useCallback((id: string, change: Partial<QueueItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...change } : it)));
  }, []);

  // Free preview memory when items go away.
  const previews = useRef(new Set<string>());
  useEffect(
    () => () => {
      previews.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function addFiles(files: FileList | File[]) {
    const room = MAX_FILES_PER_BATCH - items.filter((i) => i.status !== "done").length;
    const incoming = Array.from(files).slice(0, Math.max(room, 0));
    const added = incoming.map((file): QueueItem => {
      const { type, error } = validate(file);
      // Most browsers can't display HEIC, so those get a placeholder until processed.
      const previewUrl = type && type !== "image/heic" && type !== "image/heif" ? URL.createObjectURL(file) : null;
      if (previewUrl) previews.current.add(previewUrl);
      return {
        id: crypto.randomUUID(),
        file,
        type,
        previewUrl,
        status: error ? "error" : "ready",
        progress: 0,
        error,
        photo: null,
      };
    });
    setItems((list) => [...list, ...added]);
  }

  function removeItem(item: QueueItem) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems((list) => list.filter((i) => i.id !== item.id));
  }

  function cancelItem(item: QueueItem) {
    cancelled.current.add(item.id);
    aborts.current.get(item.id)?.();
    patch(item.id, { status: "cancelled", error: null });
  }

  async function uploadOne(item: QueueItem, target: PresignedUpload) {
    if (cancelled.current.has(item.id)) return;
    patch(item.id, { status: "uploading", progress: 0 });
    try {
      const { promise, abort } = putToStorage(target.url, item.file, target.contentType, (p) =>
        patch(item.id, { progress: p }),
      );
      aborts.current.set(item.id, abort);
      await promise;
      aborts.current.delete(item.id);
      if (cancelled.current.has(item.id)) return;

      patch(item.id, { status: "processing", progress: 1 });
      const photo = await api<PhotoDto>("/admin/photos", {
        body: { key: target.key, originalFilename: item.file.name, personIds, categoryIds, eventIds },
      });
      patch(item.id, { status: "done", photo });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      patch(item.id, {
        status: "error",
        error: err instanceof ApiError || err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  async function startUpload() {
    const pending = items.filter((i) => i.status === "ready" && i.type);
    if (!pending.length) return;
    setRunning(true);
    cancelled.current.clear();
    try {
      // Presign in batches so URLs don't expire while earlier files are still uploading.
      for (let i = 0; i < pending.length; i += 12) {
        const batch = pending.slice(i, i + 12).filter((it) => !cancelled.current.has(it.id));
        if (!batch.length) continue;
        let uploads: PresignedUpload[];
        try {
          ({ uploads } = await api<{ uploads: PresignedUpload[] }>("/admin/uploads/presign", {
            body: { files: batch.map((it) => ({ name: it.file.name, type: it.type, size: it.file.size })) },
          }));
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "Couldn't start the upload.";
          batch.forEach((it) => patch(it.id, { status: "error", error: message }));
          continue;
        }
        await runWithConcurrency(
          batch.map((it, idx) => [it, uploads[idx]!] as const),
          CONCURRENCY,
          ([it, target]) => uploadOne(it, target),
        );
      }
    } finally {
      setRunning(false);
      void invalidate();
    }
  }

  function retry(item: QueueItem) {
    patch(item.id, { status: "ready", error: null, progress: 0 });
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const readyCount = items.filter((i) => i.status === "ready").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const busy = items.some((i) => i.status === "uploading" || i.status === "processing");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition ${
            dragging ? "border-accent bg-accent/5" : "border-line bg-card/50"
          }`}
        >
          <svg viewBox="0 0 48 48" className="h-12 w-12 text-muted" aria-hidden="true">
            <rect x="8" y="12" width="26" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(-8 21 23)" />
            <rect x="14" y="10" width="26" height="22" rx="3" fill="var(--color-paper)" stroke="currentColor" strokeWidth="2" />
            <path d="M27 26V16m-4 4 4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-4 font-hand text-3xl font-bold">Drop photos here</p>
          <p className="mt-1 text-sm text-muted">JPEG, PNG, WebP or iPhone HEIC · up to 50 MB each</p>
          <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
            Choose photos
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {items.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">
                {items.length} photo{items.length === 1 ? "" : "s"}
                {doneCount > 0 && <span className="text-muted"> · {doneCount} uploaded</span>}
              </h2>
              {!busy && (
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => items.filter((i) => i.status !== "ready").forEach(removeItem)}
                  disabled={items.every((i) => i.status === "ready")}
                >
                  Clear finished
                </Button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-3 rounded-2xl bg-card/60 p-2 pr-3"
                  >
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-card">
                      {item.photo?.urls ? (
                        <Thumb src={item.photo.urls.thumb} alt="" className="h-full w-full" />
                      ) : item.previewUrl ? (
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[10px] font-semibold text-muted">
                          {item.file.name.split(".").pop()?.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{item.file.name}</p>
                      <p className={`text-xs ${item.status === "error" ? "text-danger" : "text-muted"}`}>
                        {item.status === "ready" && formatSize(item.file.size)}
                        {item.status === "uploading" && `Uploading… ${Math.round(item.progress * 100)}%`}
                        {item.status === "processing" && "Preparing photo…"}
                        {item.status === "done" &&
                          (item.photo?.takenAt
                            ? `Taken ${new Date(item.photo.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                            : "Uploaded · no date found")}
                        {item.status === "error" && item.error}
                        {item.status === "cancelled" && "Cancelled"}
                      </p>
                      {(item.status === "uploading" || item.status === "processing") && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-200"
                            style={{ width: `${Math.round(item.progress * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {item.status === "processing" && <Spinner className="h-4 w-4 text-muted" />}
                    {item.status === "uploading" && (
                      <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => cancelItem(item)}>
                        Cancel
                      </Button>
                    )}
                    {item.status === "ready" && (
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-xs"
                        onClick={() => (running ? cancelItem(item) : removeItem(item))}
                      >
                        {running ? "Cancel" : "Remove"}
                      </Button>
                    )}
                    {item.status === "error" && item.type && !running && (
                      <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => retry(item)}>
                        Retry
                      </Button>
                    )}
                    {item.status === "done" && item.photo && (
                      <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setEditing(item.photo)}>
                        Edit details
                      </Button>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[var(--radius-card)] bg-card/60 p-5">
          <h2 className="font-hand text-3xl font-bold">Tag these photos</h2>
          <p className="mt-1 text-sm text-muted">
            Applied to every photo in this upload. You can fine-tune each photo afterwards, or leave it for later —
            untagged photos wait in “Needs tagging”.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            <TagPicker kind="people" value={personIds} onChange={setPersonIds} />
            <TagPicker kind="categories" value={categoryIds} onChange={setCategoryIds} />
            <TagPicker kind="events" value={eventIds} onChange={setEventIds} />
          </div>
        </div>
        <Button variant="primary" className="h-12 text-base" onClick={startUpload} disabled={running || readyCount === 0}>
          {running ? (
            <>
              <Spinner /> Uploading…
            </>
          ) : readyCount > 0 ? (
            `Upload ${readyCount} photo${readyCount === 1 ? "" : "s"}`
          ) : (
            "Upload photos"
          )}
        </Button>
        <p className="text-center text-xs text-muted">Dates are read from each photo automatically when available.</p>
      </aside>

      <PhotoEditor
        photo={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </div>
  );
}
