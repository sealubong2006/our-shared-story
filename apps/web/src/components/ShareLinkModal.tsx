import { useState } from "react";
import type { CreatedShareLink } from "@family-album/shared";
import { ApiError } from "../lib/api";
import { useCreateShareLink } from "../lib/adminQueries";
import { useCategories, useEvents, usePeople } from "../lib/queries";
import { Modal } from "./Modal";
import { CopyField } from "./CopyField";
import { Button, ErrorText, Field, TextInput } from "./ui";

type Target = "event" | "category" | "person";

const EXPIRY = [
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 0, label: "Until I switch it off" },
];

/**
 * Create a share link for an event, category or person — or, when `photoIds` is given,
 * for a hand-picked selection. The full link is shown once; only a hash is kept.
 */
export function ShareLinkModal({ onClose, photoIds }: { onClose: () => void; photoIds?: string[] }) {
  const create = useCreateShareLink();
  const events = useEvents();
  const categories = useCategories();
  const people = usePeople();
  const isSelection = Boolean(photoIds?.length);

  const [targetType, setTargetType] = useState<Target>("event");
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);

  const options = { event: events.data, category: categories.data, person: people.data }[targetType] ?? [];

  async function submit() {
    setError(null);
    try {
      const link = await create.mutateAsync({
        label: label.trim() || options.find((o) => o.id === targetId)?.name || "Shared photos",
        targetType: isSelection ? "selection" : targetType,
        targetId: isSelection ? undefined : targetId,
        photoIds: isSelection ? photoIds : undefined,
        expiresInDays: expiry || null,
      });
      setCreated(link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the link.");
    }
  }

  if (created) {
    const url = `${window.location.origin}${created.path}`;
    return (
      <Modal open onClose={onClose} title="Link ready" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            Anyone with this link can <strong className="text-ink">view</strong> “{created.targetName}” — without the family
            code, and without being able to download or see anything else.
            {created.expiresAt ? ` It stops working on ${new Date(created.expiresAt).toLocaleDateString("en-GB")}.` : " It works until you switch it off."}
          </p>
          <CopyField value={url} label="Share link" />
          <p className="rounded-xl bg-accent/10 p-3 text-xs leading-relaxed text-ink">
            Copy it now — for safety the full link isn't stored and can't be shown again. If it's lost, just make a new one.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isSelection ? `Share ${photoIds!.length} photo${photoIds!.length === 1 ? "" : "s"}` : "New share link"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending || (!isSelection && !targetId)}>
            {create.isPending ? "Creating…" : "Create link"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!isSelection && (
          <>
            <div className="flex gap-1 rounded-full bg-card p-1" role="group" aria-label="What to share">
              {(["event", "category", "person"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={targetType === t}
                  onClick={() => {
                    setTargetType(t);
                    setTargetId("");
                  }}
                  className={`flex-1 rounded-full py-1.5 text-sm transition ${targetType === t ? "bg-paper font-medium shadow-sm" : "text-muted"}`}
                >
                  {t === "event" ? "An event" : t === "category" ? "A category" : "A person"}
                </button>
              ))}
            </div>
            <Field label={targetType === "event" ? "Event" : targetType === "category" ? "Category" : "Person"}>
              {(id) => (
                <select
                  id={id}
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="h-11 rounded-xl border border-line bg-white/80 px-3 text-sm outline-none focus:border-accent"
                >
                  <option value="">Choose…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.photoCount} photo{o.photoCount === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
        <Field label="Name for this link" hint="Only admins see this, e.g. “For Grandma Ruth”.">
          {(id) => <TextInput id={id} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" />}
        </Field>
        <Field label="Link works for">
          {(id) => (
            <select
              id={id}
              value={expiry}
              onChange={(e) => setExpiry(Number(e.target.value))}
              className="h-11 rounded-xl border border-line bg-white/80 px-3 text-sm outline-none focus:border-accent"
            >
              {EXPIRY.map((e) => (
                <option key={e.days} value={e.days}>
                  {e.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}
