import { motion } from "motion/react";
import { Link, NavLink, Outlet } from "react-router";
import { CodeEntryForm } from "../components/CodeEntryForm";
import { useAccess, useEnterCode } from "../lib/access";

function AdminSignIn({ standalone }: { standalone: boolean }) {
  const enter = useEnterCode("admin");
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-md rounded-[1.75rem] bg-paper px-6 pb-8 pt-9 shadow-[var(--shadow-lift)] sm:px-10"
    >
      <h1 className="font-hand text-4xl font-bold">Admin sign-in</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Enter your personal admin code to add photos, organise the album and manage access.
      </p>
      <div className="mt-6">
        <CodeEntryForm
          label="Your admin code"
          submitLabel="Sign in"
          pendingLabel="Checking…"
          onSubmit={(code) => enter.mutateAsync(code)}
          autoFocus
        />
      </div>
      <p className="mt-6 text-center text-xs text-muted">
        <Link to="/" className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          {standalone ? "Back to the family code" : "Back to the album"}
        </Link>
      </p>
    </motion.div>
  );
}

const SECTIONS = [
  { to: "/admin/upload", label: "Upload" },
  { to: "/admin/photos", label: "Photos" },
  { to: "/admin/people", label: "People" },
  { to: "/admin/categories", label: "Categories" },
  { to: "/admin/events", label: "Events" },
  { to: "/admin/sharing", label: "Sharing" },
  { to: "/admin/settings", label: "Settings" },
];

/**
 * /admin — sign-in for admins, then the admin area with its own section tabs.
 * Hiding this UI is a convenience only: every admin request is checked by the API.
 */
export function AdminPage() {
  const { data: access } = useAccess();

  if (!access?.admin) {
    const standalone = !access?.view;
    return (
      <main className={`flex items-center justify-center px-4 py-10 ${standalone ? "min-h-dvh bg-frame" : "pt-16"}`}>
        <AdminSignIn standalone={standalone} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Signed in as {access.admin.name}</p>
          <h1 className="font-hand text-5xl font-bold leading-tight">Organise the album</h1>
        </div>
      </div>
      <nav aria-label="Admin sections" className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1 border-b border-line">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
                className={({ isActive }) =>
                  `-mb-px block whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
                    isActive ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"
                  }`
                }
              >
                {s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-8">
        <Outlet />
      </div>
    </main>
  );
}
