import { Outlet, Link, createRootRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { CallLayer } from "@/components/calls/CallLayer";
import { CallProvider } from "@/contexts/CallContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { initializeNativeShell } from "@/lib/native";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Lost in the void</h2>
        <p className="mt-2 text-sm text-muted-foreground">This page slipped through the cracks.</p>
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
  notFoundComponent: NotFoundComponent,
  component: RootComponent,
});

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
  useEffect(() => {
    function updateAppHeight() {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
    }

    updateAppHeight();
    window.addEventListener("resize", updateAppHeight);
    window.visualViewport?.addEventListener("resize", updateAppHeight);
    window.visualViewport?.addEventListener("scroll", updateAppHeight);

    return () => {
      window.removeEventListener("resize", updateAppHeight);
      window.visualViewport?.removeEventListener("resize", updateAppHeight);
      window.visualViewport?.removeEventListener("scroll", updateAppHeight);
    };
  }, []);

  useEffect(() => {
    void initializeNativeShell();
  }, []);

  return (
    <AuthProvider>
      <PushBootstrap />
      <CallProvider>
        <AuthGate>
          <Outlet />
        </AuthGate>
        <CallLayer />
      </CallProvider>
      <Toaster
        theme="dark"
        position="top-center"
        richColors
        offset="calc(env(safe-area-inset-top) + 0.75rem)"
      />
    </AuthProvider>
  );
}

function PushBootstrap() {
  usePushNotifications();
  return null;
}
