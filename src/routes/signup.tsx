import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await signUp(username, password, displayName || username);
      toast.success("Welcome to Halo");
      router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="safe-inset mobile-page-gutter relative flex min-h-app items-center justify-center overflow-hidden bg-background py-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 sm:mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-tight">Create your Halo</h1>
          <p className="text-center text-sm leading-6 text-muted-foreground">
            Pick a username and password. No phone number required.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-[1.75rem] border border-border bg-card p-5 shadow-xl sm:p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Username</label>
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              placeholder="yourname"
              autoComplete="username"
              required
            />
            <p className="mt-1 text-[11px] text-muted-foreground">3-24 chars. Letters, numbers, underscore.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Display name (optional)</label>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              placeholder="What friends call you"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Min 8 characters.</p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create account"}
          </button>
          <p className="text-center text-[11px] leading-5 text-muted-foreground">
            We do not ask for your personal email address.
          </p>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already on Halo?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
