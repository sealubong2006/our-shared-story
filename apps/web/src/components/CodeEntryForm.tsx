import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";

interface CodeEntryFormProps {
  label: string;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (code: string) => Promise<unknown>;
  autoFocus?: boolean;
}

function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Code input with error display and a live countdown while locked out. */
export function CodeEntryForm({ label, submitLabel, pendingLabel, onSubmit, autoFocus }: CodeEntryFormProps) {
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setInterval(() => setLockedFor((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockedFor > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || pending || lockedFor > 0) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setError(apiError?.message ?? "Something went wrong. Please try again.");
      if (apiError?.retryAfter) setLockedFor(apiError.retryAfter);
      setCode("");
    } finally {
      setPending(false);
    }
  }

  const locked = lockedFor > 0;

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3" noValidate>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={show ? "text" : "password"}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={locked}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="h-12 w-full rounded-xl border border-line bg-white/80 px-4 pr-20 text-base text-ink shadow-inner shadow-black/[0.02] outline-none transition placeholder:text-muted/70 focus:border-accent focus:bg-white disabled:opacity-60"
          placeholder="e.g. maple-river-otter-42"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-card hover:text-ink"
          aria-pressed={show}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>

      <p id={errorId} role="alert" className="min-h-5 text-sm text-danger">
        {locked ? `Too many incorrect attempts. Try again in ${formatWait(lockedFor)}.` : error}
      </p>

      <button
        type="submit"
        disabled={!code.trim() || pending || locked}
        className="h-12 rounded-full bg-ink px-6 text-sm font-semibold text-paper shadow-[var(--shadow-photo)] transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
