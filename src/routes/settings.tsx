import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, TriangleAlert, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildAvatarStoragePath, resolveAvatarUrl } from "@/lib/avatar";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Settings - Halo" }],
  }),
  component: SettingsPage,
});

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function SettingsPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setBio(profile?.bio ?? "");
  }, [profile?.display_name, profile?.bio]);

  const avatarName = profile?.display_name || profile?.username || "Unknown";
  const avatarPreviewUrl = useMemo(() => resolveAvatarUrl(profile?.avatar_url), [profile?.avatar_url]);

  async function save() {
    if (!profile || busy) return;
    setBusy(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName.trim() || null, bio: bio.trim() || null })
        .eq("id", profile.id);

      if (error) throw error;

      toast.success("Saved");
      await refreshProfile();
    } catch (error) {
      console.error("Failed to save profile settings", error);
      toast.error(error instanceof Error ? error.message : "Couldn't save your settings.");
    } finally {
      setBusy(false);
    }
  }

  async function updateAvatarField(nextAvatarUrl: string | null) {
    if (!profile) return;

    const { error } = await supabase.from("profiles").update({ avatar_url: nextAvatarUrl }).eq("id", profile.id);
    if (error) throw error;
    await refreshProfile();
  }

  async function uploadAvatar(file: File) {
    if (!profile || uploadingAvatar) return;

    if (!ACCEPTED_AVATAR_TYPES.has(file.type)) {
      toast.error("Use JPG, PNG, WEBP, or GIF for avatars.");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      toast.error("Avatar must be 5 MB or smaller.");
      return;
    }

    setUploadingAvatar(true);

    try {
      const storagePath = buildAvatarStoragePath(profile.id);
      const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: "3600",
      });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(storagePath);
      const cacheBustedUrl = `${data.publicUrl}?v=${Date.now()}`;

      await updateAvatarField(cacheBustedUrl);
      toast.success("Avatar updated");
    } catch (error) {
      console.error("Failed to upload avatar", error);
      toast.error(error instanceof Error ? error.message : "Couldn't upload avatar.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (!profile || deletingAvatar || !profile.avatar_url) return;

    setDeletingAvatar(true);

    try {
      await updateAvatarField(null);
      toast.success("Avatar removed");
    } catch (error) {
      console.error("Failed to remove avatar", error);
      toast.error(error instanceof Error ? error.message : "Couldn't remove avatar.");
    } finally {
      setDeletingAvatar(false);
    }
  }

  async function deleteAccount() {
    if (!profile || deleting) return;

    const confirmed = window.confirm(
      "Delete your account permanently? This removes your profile, friendships, conversations, and messages.",
    );
    if (!confirmed) return;

    setDeleting(true);

    try {
      // Account cleanup happens server-side via RPC so the client cannot leave partial data behind.
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;

      await signOut();
      router.navigate({ to: "/signup" });
      toast.success("Account deleted");
    } catch (error) {
      console.error("Failed to delete account", error);
      toast.error(error instanceof Error ? error.message : "Couldn't delete your account.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-app overflow-hidden bg-background">
      <div className="hidden md:block">
        <ChatSidebar />
      </div>
      <main className="safe-inset mobile-page-gutter flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl py-4 md:px-8 md:py-10">
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>

          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mb-6 text-sm text-muted-foreground">@{profile?.username}</p>

          <div className="space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="rounded-[1.5rem] border border-white/8 bg-black/10 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar name={avatarName} url={avatarPreviewUrl} size="lg" className="h-16 w-16 text-base" />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Profile photo</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Upload a square image for the cleanest result. JPG, PNG, WEBP, or GIF up to 5 MB.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAvatar(file);
                      event.target.value = "";
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar || deletingAvatar}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    <ImagePlus className="h-4 w-4" />
                    {uploadingAvatar ? "Uploading..." : profile?.avatar_url ? "Replace avatar" : "Upload avatar"}
                  </button>

                  {profile?.avatar_url && (
                    <button
                      type="button"
                      onClick={() => void removeAvatar()}
                      disabled={uploadingAvatar || deletingAvatar}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                      {deletingAvatar ? "Removing..." : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Display name</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Bio</label>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
                placeholder="Anything you want friends to know"
              />
            </div>

            <button
              onClick={() => void save()}
              disabled={busy || uploadingAvatar || deletingAvatar}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold">Account</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Account deletion is permanent. Your profile, chats, friendships, and uploaded media are removed with the account.
            </p>
            <button
              onClick={() => void deleteAccount()}
              disabled={deleting}
              className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
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
