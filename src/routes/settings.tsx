import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, TriangleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Settings - Halo" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    if (!profile) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, bio })
      .eq("id", profile.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Saved");
      await refreshProfile();
    }
    setBusy(false);
  }

  async function deleteAccount() {
    if (!profile || deleting) return;
    const confirmed = window.confirm(
      "Delete your account permanently? This removes your profile, friendships, conversations, and messages.",
    );
    if (!confirmed) return;

    setDeleting(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      toast.error(error.message);
      setDeleting(false);
      return;
    }

    await signOut();
    router.navigate({ to: "/signup" });
    toast.success("Account deleted");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:block">
        <ChatSidebar />
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-10">
          <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mb-6 text-sm text-muted-foreground">@{profile?.username}</p>

          <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none ring-ring focus:ring-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none ring-ring focus:ring-2"
                placeholder="Anything you want friends to know"
              />
            </div>
            <button
              onClick={save}
              disabled={busy}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold">Account</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Account deletion is permanent. Your profile, chats, friendships, and uploaded media are removed with the account.
            </p>
            <button
              onClick={deleteAccount}
              disabled={deleting}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete account"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
