import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useAccess, useSignOut } from "../lib/access";
import { useMotionSettings } from "../lib/motion";
import { ALBUM_NAME } from "../lib/brand";

const NAV_ITEMS = [
  { to: "/", label: "Home", end: true },
  { to: "/photos", label: "Photos" },
  { to: "/people", label: "People" },
  { to: "/events", label: "Events" },
  { to: "/categories", label: "Categories" },
  { to: "/timeline", label: "Timeline" },
  { to: "/favourites", label: "Favourites" },
];

function NavItems() {
  return NAV_ITEMS.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${isActive ? "bg-card font-medium text-ink" : "text-muted hover:text-ink"}`
      }
    >
      {item.label}
    </NavLink>
  ));
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <rect x="5" y="7" width="18" height="20" rx="3" fill="#d9cfc3" transform="rotate(-10 14 17)" />
      <rect x="9" y="5" width="18" height="20" rx="3" fill="var(--color-accent)" />
      <rect x="11.5" y="7.5" width="13" height="10" rx="1.5" fill="var(--color-paper)" />
    </svg>
  );
}

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { animationsOn, setAnimationsOn } = useMotionSettings();
  const { data: access } = useAccess();
  const signOut = useSignOut();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings"
        className="grid h-10 w-10 place-items-center rounded-full bg-card text-ink transition hover:bg-card-hover"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <rect x="3" y="5" width="14" height="1.6" rx=".8" />
          <rect x="3" y="9.2" width="14" height="1.6" rx=".8" />
          <rect x="3" y="13.4" width="14" height="1.6" rx=".8" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-12 z-50 w-64 origin-top-right rounded-2xl border border-line bg-paper p-2 shadow-[var(--shadow-lift)]"
          >
            <label className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm hover:bg-card">
              <span>
                Animations
                <span className="block text-xs text-muted">Page turns, transitions and effects</span>
              </span>
              <input
                type="checkbox"
                role="menuitemcheckbox"
                checked={animationsOn}
                onChange={(e) => setAnimationsOn(e.target.checked)}
                className="h-5 w-5 accent-[var(--color-accent)]"
              />
            </label>
            <div className="my-1 h-px bg-line" />
            {access?.admin && (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await signOut.mutateAsync("admin");
                  setOpen(false);
                  navigate("/");
                }}
                className="w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-card"
              >
                Leave admin mode
                <span className="block text-xs text-muted">Signed in as {access.admin.name}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                await signOut.mutateAsync("all");
                navigate("/");
              }}
              className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-danger hover:bg-card"
            >
              Sign out on this device
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AppShell() {
  const { data: access } = useAccess();

  return (
    <div className="min-h-dvh bg-paper">
      <a
        href="#content"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-sm text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <NavLink to="/" className="flex min-w-0 items-center gap-2" aria-label={`${ALBUM_NAME} home`}>
            {/* The logo makes way for the name on the narrowest phones. */}
            <span className="hidden min-[400px]:contents">
              <Logo />
            </span>
            <span className="whitespace-nowrap pt-1 font-script text-2xl leading-none sm:text-[1.75rem]">{ALBUM_NAME}</span>
          </NavLink>

          <nav aria-label="Main" className="ml-2 hidden items-center gap-0.5 lg:flex">
            <NavItems />
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NavLink
              to="/admin"
              className="whitespace-nowrap rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-paper shadow-[var(--shadow-photo)] transition hover:bg-black sm:px-4"
            >
              {access?.admin ? (
                "Admin"
              ) : (
                <>
                  Add<span className="max-[379px]:sr-only"> photos</span>
                </>
              )}
            </NavLink>
            <SettingsMenu />
          </div>
        </div>
        {/* Smaller screens: the same links in a swipeable row under the header */}
        <nav aria-label="Main" className="border-t border-line/40 lg:hidden">
          <div className="mx-auto flex max-w-6xl gap-0.5 overflow-x-auto px-3 py-1.5 [scrollbar-width:none] sm:px-5">
            <NavItems />
          </div>
        </nav>
      </header>
      <div id="content" tabIndex={-1} className="outline-none">
        <Outlet />
      </div>
    </div>
  );
}
