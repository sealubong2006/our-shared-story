import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/AppShell";
import { AccessPage } from "./pages/AccessPage";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { PhotosPage } from "./pages/PhotosPage";
import { CollectionIndexPage, CollectionPage } from "./pages/CollectionPages";
import { TimelinePage } from "./pages/TimelinePage";
import { FavouritesPage } from "./pages/FavouritesPage";
import { useAccess } from "./lib/access";
import { MotionSettingsProvider } from "./lib/motion";
import "./index.css";

// Admin screens and share links are loaded on demand, so family members browsing the album
// never download the admin code.
const SharedPage = lazy(() => import("./pages/SharedPage").then((m) => ({ default: m.SharedPage })));
const UploadPage = lazy(() => import("./pages/admin/UploadPage").then((m) => ({ default: m.UploadPage })));
const ManagePhotosPage = lazy(() =>
  import("./pages/admin/ManagePhotosPage").then((m) => ({ default: m.ManagePhotosPage })),
);
const CollectionsAdminPage = lazy(() =>
  import("./pages/admin/CollectionsAdminPage").then((m) => ({ default: m.CollectionsAdminPage })),
);
const SharingAdminPage = lazy(() =>
  import("./pages/admin/SharingAdminPage").then((m) => ({ default: m.SharingAdminPage })),
);
const SettingsAdminPage = lazy(() =>
  import("./pages/admin/SettingsAdminPage").then((m) => ({ default: m.SettingsAdminPage })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-frame" aria-busy="true" aria-label="Loading">
      <div className="h-24 w-24 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="flex justify-center py-16" aria-busy="true" aria-label="Loading">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-ink" />
    </div>
  );
}

const later = (node: ReactNode) => <Suspense fallback={<SectionLoading />}>{node}</Suspense>;

/**
 * Shows the access screen in place of any page until the visitor has viewing access, so a
 * deep link still lands on the right page after the code is entered. This only controls
 * what is *shown*: the API independently refuses every request without a valid session.
 */
function RequireView({ children }: { children: ReactNode }) {
  const { data, isPending, isError } = useAccess();
  if (isPending) return <Splash />;
  if (isError || !data.view) return <AccessPage />;
  return <>{children}</>;
}

/** /admin is reachable without the family code: an admin code grants viewing access too. */
function AdminRoute() {
  const { data, isPending } = useAccess();
  if (isPending) return <Splash />;
  if (!data?.view) return <AdminPage />;
  return <AppShell />;
}

const router = createBrowserRouter([
  // Share links work without the family code.
  { path: "/s/:token", element: <Suspense fallback={<Splash />}><SharedPage /></Suspense> },
  {
    path: "/admin",
    element: <AdminRoute />,
    children: [
      {
        element: <AdminPage />,
        children: [
          { index: true, element: <Navigate to="upload" replace /> },
          { path: "upload", element: later(<UploadPage />) },
          { path: "photos", element: later(<ManagePhotosPage />) },
          { path: "people", element: later(<CollectionsAdminPage kind="people" key="people" />) },
          { path: "categories", element: later(<CollectionsAdminPage kind="categories" key="categories" />) },
          { path: "events", element: later(<CollectionsAdminPage kind="events" key="events" />) },
          { path: "sharing", element: later(<SharingAdminPage />) },
          { path: "settings", element: later(<SettingsAdminPage />) },
        ],
      },
    ],
  },
  {
    path: "/",
    element: (
      <RequireView>
        <AppShell />
      </RequireView>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: "photos", element: <PhotosPage /> },
      ...(["people", "categories", "events"] as const).flatMap((kind) => [
        { path: kind, element: <CollectionIndexPage kind={kind} key={kind} /> },
        { path: `${kind}/:slug`, element: <CollectionPage kind={kind} key={`${kind}-page`} /> },
      ]),
      { path: "timeline", element: <TimelinePage /> },
      { path: "favourites", element: <FavouritesPage /> },
    ],
  },
  {
    path: "*",
    element: (
      <RequireView>
        <main className="grid min-h-dvh place-items-center px-4 text-center">
          <div>
            <h1 className="font-hand text-4xl font-bold">This page isn't in the album</h1>
            <a href="/" className="mt-4 inline-block text-sm underline underline-offset-4">
              Go to the album
            </a>
          </div>
        </main>
      </RequireView>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionSettingsProvider>
        <RouterProvider router={router} />
      </MotionSettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
