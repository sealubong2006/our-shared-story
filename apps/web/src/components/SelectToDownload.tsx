import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PhotoDto } from "@family-album/shared";
import { MAX_ZIP_PHOTOS } from "@family-album/shared/constants";
import { useDownloader } from "../lib/download";
import type { GridSelection } from "./PhotoGrid";
import { Button, Spinner } from "./ui";

/**
 * "Select" mode for any photo list: pick photos, then download them together as a ZIP
 * (download code required, asked for when needed).
 */
export function useSelectToDownload(photos: PhotoDto[]) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const downloader = useDownloader();

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_ZIP_PHOTOS) next.add(id);
      return next;
    });
  }, []);

  const stop = () => {
    setActive(false);
    setSelected(new Set());
  };

  const selection: GridSelection | undefined = active ? { selected, toggle } : undefined;

  const toggleButton = photos.length > 0 && (
    <Button variant={active ? "primary" : "secondary"} className="h-9 text-xs" onClick={() => (active ? stop() : setActive(true))}>
      {active ? "Done selecting" : "Select to download"}
    </Button>
  );

  const allSelected = photos.length > 0 && photos.slice(0, MAX_ZIP_PHOTOS).every((p) => selected.has(p.id));

  const bar = (
    <>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-paper shadow-[var(--shadow-lift)]"
          >
            <span className="mr-auto text-sm">
              {selected.size ? `${selected.size} selected` : "Tap photos to select them"}
              {selected.size >= MAX_ZIP_PHOTOS && <span className="block text-xs text-paper/60">That's the most for one download.</span>}
            </span>
            <Button
              variant="ghost"
              className="h-9 text-paper/80 hover:bg-white/10 hover:text-paper"
              onClick={() => setSelected(allSelected ? new Set() : new Set(photos.slice(0, MAX_ZIP_PHOTOS).map((p) => p.id)))}
            >
              {allSelected ? "Clear" : "Select all"}
            </Button>
            <Button
              className="h-9"
              disabled={selected.size === 0 || downloader.busy}
              onClick={() => void downloader.downloadPhotos([...selected])}
            >
              {downloader.busy ? <Spinner /> : `Download${selected.size ? ` ${selected.size}` : ""}`}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {downloader.dialog}
    </>
  );

  return { selection, toggleButton, bar };
}
