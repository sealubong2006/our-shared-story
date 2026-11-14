import { useCallback, useRef, useState } from "react";
import type { DownloadLink } from "@family-album/shared";
import { api, ApiError } from "./api";
import { useAccess, useEnterCode } from "./access";
import { Modal } from "../components/Modal";
import { CodeEntryForm } from "../components/CodeEntryForm";
import { ErrorText } from "../components/ui";

/** Navigating to a signed attachment URL saves the file without leaving the page. */
function startBrowserDownload(url: string) {
  window.location.assign(url);
}

/**
 * Downloads with the family download code. If this device hasn't entered it yet,
 * a small dialog asks for it first, then the download carries on by itself.
 * The server checks the download permission on every request regardless.
 */
export function useDownloader() {
  const { data: access } = useAccess();
  const enter = useEnterCode("download");
  const pending = useRef<(() => Promise<void>) | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The download didn't start. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const withPermission = useCallback(
    (action: () => Promise<void>) => {
      if (access?.download) return run(action);
      pending.current = action;
      setAsking(true);
      return Promise.resolve();
    },
    [access?.download, run],
  );

  const downloadPhoto = useCallback(
    (photoId: string) =>
      withPermission(async () => {
        const { url } = await api<DownloadLink>(`/downloads/photos/${photoId}`);
        startBrowserDownload(url);
      }),
    [withPermission],
  );

  const downloadPhotos = useCallback(
    (photoIds: string[]) =>
      withPermission(async () => {
        const { url } = await api<DownloadLink>("/downloads/zip", { body: { photoIds } });
        startBrowserDownload(url);
      }),
    [withPermission],
  );

  const dialog = (
    <>
      <Modal open={asking} onClose={() => setAsking(false)} title="Download photos">
        <p className="mb-5 text-sm leading-relaxed text-muted">
          Downloading full-quality photos needs the family download code. You'll only need to enter it once on this
          device for the next couple of hours.
        </p>
        <CodeEntryForm
          label="Download code"
          submitLabel="Download"
          pendingLabel="Checking…"
          autoFocus
          onSubmit={async (code) => {
            await enter.mutateAsync(code);
            setAsking(false);
            const action = pending.current;
            pending.current = null;
            if (action) await run(action);
          }}
        />
      </Modal>
      {error && !asking && (
        <div className="fixed inset-x-4 bottom-4 z-[120] mx-auto max-w-md rounded-2xl bg-paper p-4 shadow-[var(--shadow-lift)]">
          <ErrorText>{error}</ErrorText>
          <button type="button" onClick={() => setError(null)} className="mt-2 text-xs text-muted underline">
            Dismiss
          </button>
        </div>
      )}
    </>
  );

  return { downloadPhoto, downloadPhotos, busy, dialog };
}
