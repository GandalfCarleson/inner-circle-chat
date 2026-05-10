import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeUsername } from "@/lib/auth-helpers";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function isUsernamePatternValid(value: string) {
  return /^[a-z0-9_]+$/.test(value);
}

function SignupPage() {
  const { signUp } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const normalizedUsername = normalizeUsername(username);

  const usernameError = useMemo(() => {
    if (normalizedUsername.length === 0) return "Username is required.";
    if (normalizedUsername.length < 3) return "Username must be at least 3 characters.";
    if (normalizedUsername.length > 20) return "Username must be 20 characters or fewer.";
    if (/\s/.test(normalizedUsername)) return "Username cannot contain spaces.";
    if (!isUsernamePatternValid(normalizedUsername)) {
      return "Use only letters, numbers, and underscore.";
    }
    return null;
  }, [normalizedUsername]);

  const passwordError = useMemo(() => {
    if (password.length === 0) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }, [password]);

  const confirmPasswordError = useMemo(() => {
    if (confirmPassword.length === 0) return "Please confirm your password.";
    if (confirmPassword !== password) return "Passwords do not match.";
    return null;
  }, [confirmPassword, password]);

  const isFormValid = !usernameError && !passwordError && !confirmPasswordError;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setFormError(null);

    if (!isFormValid) {
      setFormError("Please fix the highlighted fields.");
      return;
    }

    setBusy(true);
    try {
      await signUp(normalizedUsername, password, displayName || normalizedUsername);
      toast.success("Welcome to Void");
      router.navigate({ to: "/" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signup failed";
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="safe-inset mobile-page-gutter relative flex min-h-app items-start justify-center overflow-x-hidden overflow-y-auto bg-background py-4 sm:items-center sm:py-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
      <div className="relative w-full max-w-sm pb-8">
        <div className="mb-6 flex flex-col items-center gap-3 sm:mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-tight">Create your Void</h1>
          <p className="text-center text-sm leading-6 text-muted-foreground">
            Pick a username and password. No phone number required.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-[1.75rem] border border-border bg-card p-5 shadow-xl sm:p-6"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Username</label>
            <input
              autoFocus
              value={username}
              onChange={(event) => {
                setUsername(event.target.value.toLowerCase());
                setFormError(null);
              }}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              placeholder="yourname"
              autoComplete="username"
              aria-invalid={Boolean(usernameError)}
              required
            />
            <div className="mt-1 space-y-1 text-[11px] leading-5 text-muted-foreground">
              <p>Username is automatically lowercased.</p>
              <p>Rules: 3-20 characters, letters/numbers/underscore only, no spaces.</p>
            </div>
            {usernameError && (
              <p className="mt-1 whitespace-normal break-words text-xs leading-5 text-destructive">
                {usernameError}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Display name (optional)
            </label>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              placeholder="What friends call you"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFormError(null);
                }}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 pr-12 text-base outline-none ring-ring focus:ring-2 md:text-sm"
                autoComplete="new-password"
                aria-invalid={Boolean(passwordError)}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-muted-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordError && (
              <p className="mt-1 whitespace-normal break-words text-xs leading-5 text-destructive">
                {passwordError}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Confirm password
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setFormError(null);
                }}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 pr-12 text-base outline-none ring-ring focus:ring-2 md:text-sm"
                autoComplete="new-password"
                aria-invalid={Boolean(confirmPasswordError)}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
                className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-muted-foreground"
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPasswordError && (
              <p className="mt-1 whitespace-normal break-words text-xs leading-5 text-destructive">
                {confirmPasswordError}
              </p>
            )}
          </div>

          {formError && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive whitespace-normal break-words">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !isFormValid}
            className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Creating account..." : "Create account"}
          </button>
          <p className="text-center text-[11px] leading-5 text-muted-foreground">
            We do not ask for your personal email address.
          </p>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already on Void?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
