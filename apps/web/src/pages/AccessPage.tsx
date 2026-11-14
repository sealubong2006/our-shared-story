import { motion } from "motion/react";
import { Link } from "react-router";
import { CodeEntryForm } from "../components/CodeEntryForm";
import { PhotoStack } from "../components/PhotoStack";
import { useEnterCode } from "../lib/access";
import { ALBUM_NAME, ALBUM_TAGLINE } from "../lib/brand";

/** First screen for anyone without viewing access. */
export function AccessPage() {
  const enter = useEnterCode("view");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-frame px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md rounded-[1.75rem] bg-paper px-6 pb-8 pt-10 shadow-[var(--shadow-lift)] sm:px-10"
      >
        <PhotoStack className="mx-auto w-56" />

        <h1 className="mt-6 text-center font-script text-6xl leading-tight text-ink">{ALBUM_NAME}</h1>
        <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-muted">{ALBUM_TAGLINE}</p>

        <div className="mt-8">
          <CodeEntryForm
            label="Family code"
            submitLabel="Open the album"
            pendingLabel="Opening…"
            onSubmit={(code) => enter.mutateAsync(code)}
            autoFocus
          />
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Adding photos?{" "}
          <Link to="/admin" className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            Admin sign-in
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
