import { useState } from "react";
import { Button } from "./ui";

/** A read-only value with a Copy button, for codes and links shown once. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-white p-1.5 pl-3.5">
      <code aria-label={label} className="min-w-0 flex-1 select-all break-all font-mono text-sm text-ink">
        {value}
      </code>
      <Button
        variant="primary"
        className="h-9 shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked: the text is selectable, so it can still be copied by hand.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
