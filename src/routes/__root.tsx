import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Lost in the void</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page slipped through the cracks.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#1a1525" },
      { title: "Halo — private messaging for friend groups" },
      {
        name: "description",
        content:
          "End-to-end encrypted messaging built for real friend groups. No ads, no tracking, no data selling.",
      },
      { property: "og:title", content: "Halo — private messaging for friend groups" },
      {
        property: "og:description",
        content: "E2E encrypted chat, group rooms, and disappearing messages — without the noise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = router.state.location.pathname;
  const isAuthRoute = path === "/login" || path === "/signup";

  useEffect(() => {
    if (loading) return;
    if (!user && !isAuthRoute) router.navigate({ to: "/login" });
    if (user && isAuthRoute) router.navigate({ to: "/" });
  }, [user, loading, isAuthRoute, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  return <>{children}</>;
}

function RootComponent() {
  return (
    <AuthProvider>
      <AuthGate>
        <Outlet />
      </AuthGate>
      <Toaster theme="dark" position="top-center" richColors />
    </AuthProvider>
  );
}
