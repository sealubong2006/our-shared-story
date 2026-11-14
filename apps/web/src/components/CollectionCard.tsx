import { Link } from "react-router";
import type { CollectionDto, EventDto } from "@family-album/shared";
import { formatRange } from "../lib/format";
import { PhotoStack } from "./PhotoStack";

interface CollectionCardProps {
  name: string;
  subtitle: string;
  previewUrls: string[];
  /** Link destination, or… */
  to?: string;
  /** …a click handler (admin editing). */
  onClick?: () => void;
  /** Shows a visible "Edit" tag and labels the card as an edit button. */
  editable?: boolean;
}

const cardClass =
  "group relative flex w-full flex-col rounded-[var(--radius-card)] bg-card/70 p-4 text-left transition hover:bg-card focus-visible:outline-offset-4";

/** A "bookshelf" card: handwritten name, count, and a fanned stack of the collection's photos. */
export function CollectionCard({ name, subtitle, previewUrls, to, onClick, editable }: CollectionCardProps) {
  const body = (
    <>
      {editable && (
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink shadow-[0_1px_2px_rgb(36_37_43/0.1)] transition group-hover:bg-ink group-hover:text-paper"
        >
          <PencilIcon />
          Edit
        </span>
      )}
      <span className="font-hand text-2xl font-bold leading-tight">{name}</span>
      <span className="text-xs text-muted">{subtitle}</span>
      <PhotoStack images={previewUrls} className="mx-auto mt-3 w-full max-w-44" interactive />
    </>
  );
  return to ? (
    <Link to={to} className={cardClass}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cardClass} aria-label={editable ? `Edit ${name}` : undefined}>
      {body}
    </button>
  );
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M13.5 3.5l3 3L7 16H4v-3z" strokeLinejoin="round" />
    </svg>
  );
}

export function CollectionGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="aspect-[4/3.6] animate-pulse rounded-[var(--radius-card)] bg-card" />
      ))}
    </div>
  );
}

export const photoCount = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/** "3 Aug 2024 – 10 Aug 2024 · 12 photos" for events, "12 photos" otherwise. */
export function collectionSubtitle(item: CollectionDto): string {
  const range = "startsOn" in item ? formatRange((item as EventDto).startsOn, (item as EventDto).endsOn) : null;
  return range ? `${range} · ${photoCount(item.photoCount)}` : photoCount(item.photoCount);
}
