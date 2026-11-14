import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "../lib/api";
import { type CollectionKind, useCollection, useCreateCollection } from "../lib/queries";
import { Spinner } from "./ui";

const LABELS: Record<CollectionKind, { label: string; placeholder: string; noun: string }> = {
  people: { label: "People", placeholder: "Who's in it?", noun: "person" },
  categories: { label: "Categories", placeholder: "Add a category", noun: "category" },
  events: { label: "Events", placeholder: "Add an event", noun: "event" },
};

interface TagPickerProps {
  kind: CollectionKind;
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Multi-select combobox with chips. Typing a name that doesn't exist offers
 * "Create …", which adds it to the album and selects it straight away.
 */
export function TagPicker({ kind, value, onChange }: TagPickerProps) {
  const { label, placeholder, noun } = LABELS[kind];
  const { data: options = [], isPending } = useCollection(kind);
  const create = useCreateCollection(kind);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();

  const selected = value.map((id) => options.find((o) => o.id === id)).filter((o): o is (typeof options)[number] => Boolean(o));
  const trimmed = query.trim();
  const matches = useMemo(
    () =>
      options.filter((o) => !value.includes(o.id) && o.name.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 8),
    [options, value, trimmed],
  );
  const exact = options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !exact;
  const itemCount = matches.length + (canCreate ? 1 : 0);

  function pick(id: string) {
    onChange([...value, id]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  async function createAndPick() {
    setError(null);
    try {
      const created = await create.mutateAsync({ name: trimmed });
      pick(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't create that ${noun}.`);
    }
  }

  function choose(index: number) {
    if (index < matches.length) pick(matches[index]!.id);
    else if (canCreate) void createAndPick();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(itemCount - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && itemCount > 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div
        className="relative flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white/80 px-2 py-1.5 transition focus-within:border-accent focus-within:bg-white"
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-card py-1 pl-3 pr-1 text-sm">
            {o.name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((v) => v !== o.id));
              }}
              aria-label={`Remove ${o.name}`}
              className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-card-hover hover:text-ink"
            >
              <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open && itemCount > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && itemCount > 0 ? `${listId}-${active}` : undefined}
          value={query}
          placeholder={selected.length ? "" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="h-8 min-w-[8rem] flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted/70"
        />
        {(isPending || create.isPending) && <Spinner className="mr-1 h-4 w-4 text-muted" />}

        {open && itemCount > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-64 overflow-auto rounded-xl border border-line bg-paper p-1 shadow-[var(--shadow-lift)]"
          >
            {matches.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${i === active ? "bg-card" : ""}`}
              >
                {o.name}
              </li>
            ))}
            {canCreate && (
              <li
                id={`${listId}-${matches.length}`}
                role="option"
                aria-selected={active === matches.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(matches.length)}
                onMouseEnter={() => setActive(matches.length)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm text-accent-strong ${active === matches.length ? "bg-card" : ""}`}
              >
                + Create {noun} “{trimmed}”
              </li>
            )}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
