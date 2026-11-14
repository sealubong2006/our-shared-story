import { useState, type ReactNode } from "react";
import type { ActivityDto } from "@family-album/shared";
import { ApiError } from "../../lib/api";
import {
  useActivity,
  useBackups,
  useAddAdmin,
  useDownloadLog,
  useResetAdminCode,
  useRevokeSessions,
  useRotateCode,
  useSetAdminActive,
  useSettings,
} from "../../lib/adminQueries";
import { formatShortDate } from "../../lib/format";
import { Modal } from "../../components/Modal";
import { CopyField } from "../../components/CopyField";
import { Button, ErrorText, Field, TextInput } from "../../components/ui";

const when = (iso: string) =>
  `${formatShortDate(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

function Section({ title, intro, action, children }: { title: string; intro?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] bg-card/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-hand text-3xl font-bold">{title}</h2>
          {intro && <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{intro}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * One dialog for every "issue a code" action: generate a memorable code or type one,
 * then show it once to copy. Codes are only ever stored as hashes.
 */
function CodeDialog({
  title,
  intro,
  warning,
  nameField,
  onIssue,
  onClose,
}: {
  title: string;
  intro: string;
  warning?: string;
  nameField?: boolean;
  onIssue: (input: { code?: string; name?: string }) => Promise<{ code: string }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"generate" | "choose">("generate");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (issued) {
    return (
      <Modal open onClose={onClose} title="New code" footer={<Button variant="primary" onClick={onClose}>I've saved it</Button>}>
        <div className="flex flex-col gap-4">
          <CopyField value={issued} label="New code" />
          <p className="rounded-xl bg-accent/10 p-3 text-xs leading-relaxed text-ink">
            Note it down or send it privately now. It can't be shown again — only a scrambled version is stored. Capitals
            and spaces don't matter when typing it.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || (nameField && !name.trim()) || (mode === "choose" && code.trim().length < 8)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await onIssue({ code: mode === "choose" ? code : undefined, name: nameField ? name : undefined });
                setIssued(res.code);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "That didn't work. Please try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Create code"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted">{intro}</p>
        {warning && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{warning}</p>}
        {nameField && (
          <Field label="Name">{(id) => <TextInput id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auntie Grace" />}</Field>
        )}
        <div className="flex gap-1 rounded-full bg-card p-1" role="group" aria-label="How to make the code">
          {(["generate", "choose"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full py-1.5 text-sm transition ${mode === m ? "bg-paper font-medium shadow-sm" : "text-muted"}`}
            >
              {m === "generate" ? "Make one for me" : "I'll choose"}
            </button>
          ))}
        </div>
        {mode === "generate" ? (
          <p className="text-xs text-muted">You'll get easy-to-say words, like “maple-river-otter-42”.</p>
        ) : (
          <Field label="New code" hint="At least 8 characters. Words are easier to share than random letters.">
            {(id) => <TextInput id={id} value={code} maxLength={128} autoComplete="off" onChange={(e) => setCode(e.target.value)} />}
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}

const ACTION_LABELS: Record<string, string> = {
  sign_in: "signed in",
  "photo.upload": "uploaded a photo",
  "photo.update": "edited a photo",
  "photo.bulk_tag": "tagged photos",
  "photo.delete": "deleted photos",
  "photo.restore": "restored photos",
  "person.create": "added a person",
  "person.update": "edited a person",
  "person.delete": "removed a person",
  "category.create": "added a category",
  "category.update": "edited a category",
  "category.delete": "removed a category",
  "event.create": "added an event",
  "event.update": "edited an event",
  "event.delete": "removed an event",
  "share.create": "created a share link",
  "share.revoke": "switched off a share link",
  "code.rotate_view": "changed the family code",
  "code.rotate_download": "changed the download code",
  "admin.create": "added an admin",
  "admin.reset_code": "gave an admin a new code",
  "admin.enable": "re-enabled an admin",
  "admin.disable": "disabled an admin",
  "sessions.revoke": "signed out family devices",
  "backup.download": "downloaded a copy of the database",
};

function describe(a: ActivityDto) {
  const label = ACTION_LABELS[a.action] ?? a.action;
  const d = a.details ?? {};
  const name = typeof d.name === "string" ? d.name : typeof d.label === "string" ? d.label : null;
  const count = Array.isArray(d.photoIds) ? d.photoIds.length : typeof d.count === "number" ? d.count : null;
  return `${label}${name ? ` “${name}”` : ""}${count !== null && a.action !== "sessions.revoke" ? ` (${count})` : ""}`;
}

export function SettingsAdminPage() {
  const settings = useSettings();
  const downloads = useDownloadLog();
  const activity = useActivity();
  const backups = useBackups();
  const rotate = useRotateCode();
  const addAdmin = useAddAdmin();
  const resetAdmin = useResetAdminCode();
  const setActive = useSetAdminActive();
  const revoke = useRevokeSessions();
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<null | "visitors" | "download">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => setDialog(null);

  const s = settings.data;

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Family codes"
        intro="The viewing code opens the album. The download code is asked for separately before anyone downloads. Changing a code signs out everyone who used the old one."
      >
        <ul className="flex flex-col gap-2">
          {(["view", "download"] as const).map((scope) => (
            <li key={scope} className="flex flex-wrap items-center gap-3 rounded-2xl bg-paper px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{scope === "view" ? "Viewing code" : "Download code"}</p>
                <p className="text-xs text-muted">
                  {s?.codes[scope] ? `Last changed ${when(s.codes[scope]!.rotatedAt)}` : settings.isPending ? " " : "Not set yet"}
                </p>
              </div>
              <Button
                className="h-9"
                onClick={() =>
                  setDialog(
                    <CodeDialog
                      title={scope === "view" ? "New viewing code" : "New download code"}
                      intro={scope === "view" ? "Everyone will need the new code to open the album." : "Everyone will need the new code to download photos."}
                      warning={
                        scope === "view"
                          ? "Every family device using the old code is signed out straight away."
                          : "Download access granted with the old code stops straight away."
                      }
                      onIssue={({ code }) => rotate.mutateAsync({ scope, code })}
                      onClose={close}
                    />,
                  )
                }
              >
                Change
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Admins"
        intro="Each admin has their own code, so the album knows who added or removed what. Giving someone a new code signs them out everywhere."
        action={
          <Button
            variant="primary"
            onClick={() =>
              setDialog(
                <CodeDialog
                  title="Add an admin"
                  intro="They'll be able to upload, organise, delete, share and change codes."
                  nameField
                  onIssue={({ code, name }) => addAdmin.mutateAsync({ name: name!, code })}
                  onClose={close}
                />,
              )
            }
          >
            Add admin
          </Button>
        }
      >
        <ul className="flex flex-col gap-2">
          {s?.admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-paper px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {a.name}
                  {a.isYou && <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-xs font-normal text-muted">you</span>}
                </p>
                <p className="text-xs text-muted">{a.active ? `Admin since ${formatShortDate(a.createdAt.slice(0, 10))}` : "Disabled — can't sign in"}</p>
              </div>
              <Button
                variant="ghost"
                className="h-9 text-xs"
                onClick={() =>
                  setDialog(
                    <CodeDialog
                      title={`New code for ${a.name}`}
                      intro={a.isYou ? "Your old code stops working and you're signed out of admin mode everywhere, including here — sign back in with the new code." : `${a.name}'s old code stops working and they're signed out everywhere.`}
                      onIssue={({ code }) => resetAdmin.mutateAsync({ id: a.id, code })}
                      onClose={close}
                    />,
                  )
                }
              >
                New code
              </Button>
              {!a.isYou && (
                <Button
                  variant={a.active ? "danger" : "secondary"}
                  className="h-9 text-xs"
                  disabled={setActive.isPending}
                  onClick={async () => {
                    setError(null);
                    try {
                      await setActive.mutateAsync({ id: a.id, active: !a.active });
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "That didn't work.");
                    }
                  }}
                >
                  {a.active ? "Disable" : "Enable"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </Section>

      <Section
        title="Signed-in devices"
        intro="If a phone is lost or a code was shared too widely, sign family devices out. Admins stay signed in."
      >
        {s && (
          <p className="text-sm">
            Right now: <strong>{s.activeSessions.view}</strong> device{s.activeSessions.view === 1 ? "" : "s"} viewing,{" "}
            <strong>{s.activeSessions.download}</strong> with download access, <strong>{s.activeSessions.share}</strong> through
            share links, <strong>{s.activeSessions.admin}</strong> admin.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {confirmRevoke ? (
            <>
              <span className="self-center text-sm text-muted">
                {confirmRevoke === "visitors" ? "Sign out every family device and share-link visitor?" : "Remove download access on every device?"}
              </span>
              <Button variant="ghost" onClick={() => setConfirmRevoke(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={revoke.isPending}
                onClick={async () => {
                  const res = await revoke.mutateAsync(confirmRevoke);
                  setNotice(`${res.count} session${res.count === 1 ? "" : "s"} ended. They can sign in again with the current codes.`);
                  setConfirmRevoke(null);
                }}
              >
                Yes, sign out
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirmRevoke("visitors")}>Sign out all family devices</Button>
              <Button variant="ghost" onClick={() => setConfirmRevoke("download")}>
                Remove download access everywhere
              </Button>
            </>
          )}
        </div>
        {notice && <p className="mt-3 text-sm text-[#3f6b37]">{notice}</p>}
      </Section>

      <Section
        title="Backups"
        intro="Every night the album saves a copy of its records (people, tags, captions, events, codes and settings) and keeps the last 30. The photos themselves are stored separately and aren't part of these copies. Now and then, download a copy to keep somewhere safe, away from the album."
        action={
          <a
            href="/api/admin/backups/download"
            download
            className="inline-flex items-center rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-black"
          >
            Download a copy
          </a>
        }
      >
        {backups.data?.length ? (
          <>
            <p className="text-sm">
              Latest: <strong className="font-medium">{when(backups.data[0]!.createdAt)}</strong> ·{" "}
              {backups.data.length} kept
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {backups.data.slice(1, 6).map((b) => (
                <li key={b.key}>{when(b.createdAt)}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">
            {backups.isPending ? "Loading…" : "No backups yet. The first is made within a few minutes of the server starting."}
          </p>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Downloads" intro="The latest downloads. Family members don't have accounts, so only admins are named.">
          {downloads.data?.length ? (
            <ul className="flex max-h-96 flex-col divide-y divide-line overflow-y-auto">
              {downloads.data.map((d) => (
                <li key={d.id} className="py-2.5 text-sm">
                  <p>
                    {d.who} downloaded {d.kind === "zip" ? `${d.photoCount} photos (ZIP)` : (d.photoFilename ?? "a photo")}
                  </p>
                  <p className="text-xs text-muted">{when(d.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{downloads.isPending ? "Loading…" : "No downloads yet."}</p>
          )}
        </Section>

        <Section title="Admin activity" intro="Who changed what, newest first.">
          {activity.data?.length ? (
            <ul className="flex max-h-96 flex-col divide-y divide-line overflow-y-auto">
              {activity.data.map((a) => (
                <li key={a.id} className="py-2.5 text-sm">
                  <p>
                    <strong className="font-medium">{a.adminName ?? "A removed admin"}</strong> {describe(a)}
                  </p>
                  <p className="text-xs text-muted">{when(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{activity.isPending ? "Loading…" : "Nothing yet."}</p>
          )}
        </Section>
      </div>

      {dialog}
    </div>
  );
}
