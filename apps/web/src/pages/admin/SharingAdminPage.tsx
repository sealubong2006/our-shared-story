import { useState } from "react";
import type { ShareLinkDto } from "@family-album/shared";
import { useRevokeShareLink, useShareLinks } from "../../lib/adminQueries";
import { formatShortDate } from "../../lib/format";
import { ShareLinkModal } from "../../components/ShareLinkModal";
import { Button } from "../../components/ui";

const STATUS_STYLE: Record<ShareLinkDto["status"], string> = {
  active: "bg-[#e4efe0] text-[#3f6b37]",
  expired: "bg-card text-muted",
  revoked: "bg-danger/10 text-danger",
};

function LinkRow({ link }: { link: ShareLinkDto }) {
  const revoke = useRevokeShareLink();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-card/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{link.label}</p>
        <p className="text-xs text-muted">
          {link.targetName} · made {formatShortDate(link.createdAt.slice(0, 10))}
          {link.createdBy ? ` by ${link.createdBy}` : ""}
          {link.status === "active" && (link.expiresAt ? ` · until ${formatShortDate(link.expiresAt.slice(0, 10))}` : " · no end date")}
        </p>
      </div>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[link.status]}`}>
        {link.status === "revoked" ? "switched off" : link.status}
      </span>
      {link.status === "active" &&
        (confirming ? (
          <span className="flex items-center gap-1">
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button variant="danger" className="h-8 px-3 text-xs" disabled={revoke.isPending} onClick={() => revoke.mutate(link.id)}>
              Switch off
            </Button>
          </span>
        ) : (
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setConfirming(true)}>
            Switch off
          </Button>
        ))}
    </li>
  );
}

/** Admin → Sharing: view-only links for people outside the family code. */
export function SharingAdminPage() {
  const { data, isPending, isError, error } = useShareLinks();
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Share an event, category or person with someone who doesn't have the family code. They can look but not
          download, and see nothing else. To share hand-picked photos, select them under Photos and choose “Share”.
        </p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New share link
        </Button>
      </div>

      <div className="mt-6">
        {isPending ? (
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
        ) : isError ? (
          <p className="text-sm text-danger">Couldn't load links. {error.message}</p>
        ) : data.length === 0 ? (
          <p className="py-12 text-center font-hand text-2xl text-muted">No share links yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.map((link) => (
              <LinkRow key={link.id} link={link} />
            ))}
          </ul>
        )}
      </div>

      {creating && <ShareLinkModal onClose={() => setCreating(false)} />}
    </section>
  );
}
