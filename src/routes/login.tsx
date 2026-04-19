import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await signIn(username, password);
      router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="safe-inset mobile-page-gutter relative flex min-h-app items-center justify-center overflow-hidden bg-background py-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 sm:mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-tight">Welcome back to Halo</h1>
          <p className="text-center text-sm leading-6 text-muted-foreground">
            Sign in with your username and password.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-[1.75rem] border border-border bg-card p-5 shadow-xl sm:p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Username</label>
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              placeholder="yourname"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
