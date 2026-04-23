import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Clock3,
  ImagePlus,
  MessageSquare,
  Paperclip,
  TriangleAlert,
  Trash2,
  Users2,
  X,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ConstellationLayer, type ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import { MobileDock } from "@/components/MobileDock";
import { useAuth } from "@/contexts/AuthContext";
import { useGradient } from "@/hooks/useGradient";
import { supabase } from "@/integrations/supabase/client";
import { buildAvatarStoragePath, resolveAvatarUrl } from "@/lib/avatar";
import { listConversations } from "@/lib/messaging";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Settings - Void" }],
  }),
  component: SettingsPage,
});

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface DashboardStats {
  messagesSent: number;
  activeDays: number;
  conversationCount: number;
  filesShared: number;
  mostActiveTime: string;
  recentActivity: string;
}

interface ConnectionPreview {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  lastInteractionAt: string | null;
}

const DEFAULT_STATS: DashboardStats = {
  messagesSent: 0,
  activeDays: 0,
  conversationCount: 0,
  filesShared: 0,
  mostActiveTime: "No activity yet",
  recentActivity: "No recent messages yet",
};

const PROGRESS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];

function buildProgressSeries(stats: DashboardStats) {
  const seed = Math.max(stats.messagesSent, 12);
  return PROGRESS_MONTHS.map((_, index) => {
    const raw = seed / (index + 4) + stats.activeDays * 3 + index * 7 + stats.filesShared * 2;
    return 32 + (raw % 48);
  });
}

function SettingsPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editSectionRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [connections, setConnections] = useState<ConnectionPreview[]>([]);
  const [constellationSignal, setConstellationSignal] = useState<ConstellationSignal>({
    kind: "focus",
    key: 0,
  });

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setBio(profile?.bio ?? "");
  }, [profile?.display_name, profile?.bio]);

  useEffect(() => {
    if (!profile) {
      setStats(DEFAULT_STATS);
      setConnections([]);
      return;
    }

    let cancelled = false;

    async function loadDashboardData() {
      try {
        const [messageRowsResult, conversationCountResult, filesCountResult, conversationList] =
          await Promise.all([
            supabase
              .from("messages")
              .select("id, created_at, type, conversation_id", { count: "exact" })
              .eq("sender_id", profile.id)
              .order("created_at", { ascending: false })
              .limit(500),
            supabase
              .from("conversation_members")
              .select("conversation_id", { count: "exact", head: true })
              .eq("user_id", profile.id),
            supabase
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("sender_id", profile.id)
              .in("type", ["image", "voice"]),
            listConversations(profile.id),
          ]);

        if (messageRowsResult.error) throw messageRowsResult.error;
        if (conversationCountResult.error) throw conversationCountResult.error;
        if (filesCountResult.error) throw filesCountResult.error;
        if (cancelled) return;

        const sentMessages = messageRowsResult.data ?? [];
        const activeDaySet = new Set(
          sentMessages.map((message) => message.created_at.slice(0, 10)),
        );

        const daytimeBuckets = {
          "Late night": 0,
          Morning: 0,
          Afternoon: 0,
          Evening: 0,
        };
        for (const message of sentMessages) {
          const hour = new Date(message.created_at).getHours();
          if (hour < 6) daytimeBuckets["Late night"] += 1;
          else if (hour < 12) daytimeBuckets.Morning += 1;
          else if (hour < 18) daytimeBuckets.Afternoon += 1;
          else daytimeBuckets.Evening += 1;
        }

        const mostActiveTime =
          Object.entries(daytimeBuckets).sort((a, b) => b[1] - a[1])[0]?.[1] > 0
            ? Object.entries(daytimeBuckets).sort((a, b) => b[1] - a[1])[0][0]
            : "No activity yet";

        const recentActivity = sentMessages[0]?.created_at
          ? `Last sent ${formatDistanceToNowStrict(new Date(sentMessages[0].created_at))} ago`
          : "No recent messages yet";

        const connectionById = new Map<string, ConnectionPreview>();
        for (const conversation of conversationList) {
          for (const member of conversation.members) {
            if (member.user_id === profile.id) continue;
            const interactionAt = conversation.last_message?.created_at ?? conversation.updated_at;
            const existing = connectionById.get(member.user_id);
            const candidate: ConnectionPreview = {
              id: member.user_id,
              name: member.display_name || member.username || "Unknown",
              username: member.username || "unknown",
              avatarUrl: member.avatar_url,
              lastInteractionAt: interactionAt,
            };

            if (!existing) {
              connectionById.set(member.user_id, candidate);
              continue;
            }

            const existingTime = existing.lastInteractionAt
              ? new Date(existing.lastInteractionAt).getTime()
              : 0;
            const candidateTime = candidate.lastInteractionAt
              ? new Date(candidate.lastInteractionAt).getTime()
              : 0;
            if (candidateTime > existingTime) {
              connectionById.set(member.user_id, candidate);
            }
          }
        }

        setStats({
          messagesSent: messageRowsResult.count ?? sentMessages.length,
          activeDays: activeDaySet.size,
          conversationCount: conversationCountResult.count ?? 0,
          filesShared: filesCountResult.count ?? 0,
          mostActiveTime,
          recentActivity,
        });

        setConnections(
          Array.from(connectionById.values())
            .sort((a, b) => {
              const aTime = a.lastInteractionAt ? new Date(a.lastInteractionAt).getTime() : 0;
              const bTime = b.lastInteractionAt ? new Date(b.lastInteractionAt).getTime() : 0;
              return bTime - aTime;
            })
            .slice(0, 10),
        );
      } catch (error) {
        console.error("Failed to load profile dashboard stats", error);
        if (!cancelled) {
          setStats(DEFAULT_STATS);
          setConnections([]);
        }
      }
    }

    void loadDashboardData();

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const avatarName = profile?.display_name || profile?.username || "Unknown";
  const avatarPreviewUrl = useMemo(
    () => resolveAvatarUrl(profile?.avatar_url),
    [profile?.avatar_url],
  );
  const mostInteractedConnection = connections[0] ?? null;
  const progressSeries = useMemo(() => buildProgressSeries(stats), [stats]);
  const profileGradient = useGradient("profile", {
    activity: Math.min(
      1,
      (stats.messagesSent > 0 ? 0.18 : 0.08) +
        Math.min(0.46, stats.activeDays / 50) +
        Math.min(0.3, connections.length / 14),
    ),
  });

  function emitConstellationSignal(kind: ConstellationSignal["kind"]) {
    setConstellationSignal((current) => ({ kind, key: current.key + 1 }));
  }

  useEffect(() => {
    emitConstellationSignal("focus");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mostInteractedConnection) return;
    emitConstellationSignal("highlight");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostInteractedConnection?.id]);

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    router.navigate({ to: "/" });
  }

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
      emitConstellationSignal("highlight");
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

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: nextAvatarUrl })
      .eq("id", profile.id);
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
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(storagePath, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(storagePath);
      const cacheBustedUrl = `${data.publicUrl}?v=${Date.now()}`;

      await updateAvatarField(cacheBustedUrl);
      toast.success("Avatar updated");
      emitConstellationSignal("highlight");
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
      emitConstellationSignal("highlight");
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
    <div
      className="screen-theme-profile profile-shell-bg screen-enter immersive-root dynamic-gradient-transition flex h-app overflow-hidden"
      style={profileGradient.style}
    >
      <div className="hidden md:block">
        <ChatSidebar />
      </div>
      <main className="safe-inset mobile-page-gutter flex-1 overflow-y-auto pb-28 md:pb-0">
        <div className="mx-auto max-w-2xl py-4 md:px-8 md:py-10">
          <button
            type="button"
            onClick={goBack}
            className="interactive-surface mb-4 inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="profile-hero-shell mb-8 px-1 py-1 md:px-2">
            <div className="profile-hero-card">
              <ConstellationLayer
                mode="profile"
                signal={constellationSignal}
                className="profile-constellation-layer opacity-[0.76]"
              />
              <div className="profile-hero-glow" />
              <div className="profile-hero-avatar-ring relative z-10">
                <Avatar
                  name={avatarName}
                  url={avatarPreviewUrl}
                  size="lg"
                  className="relative z-10 h-[5.5rem] w-[5.5rem] text-lg"
                />
              </div>
              <div className="relative z-10 mt-4 text-center">
                <div className="inline-flex items-center gap-2">
                  <h1 className="lux-title text-2xl">{profile?.display_name || profile?.username}</h1>
                  <span className="profile-pro-pill">Pro</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">@{profile?.username}</p>
                <p className="mt-1 text-xs tracking-[0.08em] text-white/52">Building the future</p>
                <button
                  type="button"
                  onClick={() => {
                    editSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="profile-edit-button quiet-hover mt-4 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm text-foreground"
                >
                  Edit Profile
                </button>
              </div>
            </div>
          </div>

          <ProfileProgressCard series={progressSeries} />

          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatCard
              icon={<MessageSquare className="h-4 w-4" />}
              value={stats.messagesSent}
              label="Messages sent"
              tone="highlight"
            />
            <StatCard
              icon={<CalendarDays className="h-4 w-4" />}
              value={stats.activeDays}
              label="Active days"
              tone="primary"
            />
            <StatCard
              icon={<Users2 className="h-4 w-4" />}
              value={stats.conversationCount}
              label="Conversations"
              tone="flat"
            />
            <StatCard
              icon={<Paperclip className="h-4 w-4" />}
              value={stats.filesShared}
              label="Files shared"
              tone="flat"
            />
          </div>

          <div className="section-blend mb-8 rounded-[24px] p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm text-foreground">Connections</h2>
              <span className="text-xs text-white/36">{connections.length} active</span>
            </div>
            {mostInteractedConnection && (
              <p className="mb-3 text-xs text-white/42">
                Most interacted:{" "}
                <span className="text-foreground">{mostInteractedConnection.name}</span>
              </p>
            )}
            {connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Start chatting to build your connections.
              </p>
            ) : (
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                {connections.map((connection) => (
                  <button
                    key={connection.id}
                    type="button"
                    onClick={() => {
                      router.navigate({ to: "/friends" });
                    }}
                    className="quiet-hover section-blend-soft flex shrink-0 flex-col items-center gap-1.5 rounded-[16px] px-1.5 py-2"
                  >
                    <Avatar
                      name={connection.name}
                      url={connection.avatarUrl}
                      size="sm"
                      className="h-12 w-12 text-[11px]"
                    />
                    <p className="max-w-[3.8rem] truncate text-[11px] text-foreground/90">
                      {connection.name}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mb-8 grid gap-3 md:grid-cols-2 md:gap-4">
            <div className="surface-highlight rounded-[20px] p-4">
              <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-white/72">
                <Clock3 className="h-4 w-4" />
              </div>
              <p className="text-xs uppercase tracking-[0.14em] text-white/35">Most active time</p>
              <p className="mt-2 text-sm text-foreground">{stats.mostActiveTime}</p>
            </div>
            <div className="flat-section rounded-[20px] p-4">
              <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-white/72">
                <Activity className="h-4 w-4" />
              </div>
              <p className="text-xs uppercase tracking-[0.14em] text-white/35">Recent activity</p>
              <p className="mt-2 text-sm text-foreground">{stats.recentActivity}</p>
            </div>
          </div>

          <div ref={editSectionRef} className="section-blend mb-8 space-y-5 rounded-[28px] p-4 sm:p-5">
            <div className="surface-primary rounded-[1.5rem] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar
                  name={avatarName}
                  url={avatarPreviewUrl}
                  size="lg"
                  className="h-16 w-16 text-base"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Profile photo</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Upload a square image for the cleanest result. JPG, PNG, WEBP, or GIF up to 5
                    MB.
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
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground premium-elevated quiet-hover hover:bg-primary/90 disabled:opacity-60"
                  >
                    <ImagePlus className="h-4 w-4" />
                    {uploadingAvatar
                      ? "Uploading..."
                      : profile?.avatar_url
                        ? "Replace avatar"
                        : "Upload avatar"}
                  </button>

                  {profile?.avatar_url && (
                    <button
                      type="button"
                      onClick={() => void removeAvatar()}
                      disabled={uploadingAvatar || deletingAvatar}
                      className="interactive-surface inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                      {deletingAvatar ? "Removing..." : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Display name</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full rounded-xl border border-white/12 bg-black/[0.18] px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Bio</label>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/12 bg-black/[0.18] px-4 py-3 text-base outline-none ring-ring focus:ring-2 md:text-sm"
                placeholder="Anything you want friends to know"
              />
            </div>

            <button
              onClick={() => void save()}
              disabled={busy || uploadingAvatar || deletingAvatar}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground premium-elevated hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>

          <div className="section-blend mt-6 rounded-[24px] p-4 sm:p-5">
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm text-foreground">Account</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Account deletion is permanent. Your profile, chats, friendships, and uploaded media
              are removed with the account.
            </p>
            <button
              onClick={() => void deleteAccount()}
              disabled={deleting}
              className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-destructive px-4 py-3 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete account"}
            </button>
            <button
              type="button"
              onClick={goBack}
              className="interactive-surface mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
        </div>
      </main>

      <MobileDock active="profile" />
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  tone: "highlight" | "primary" | "flat";
}) {
  const toneClass =
    tone === "highlight"
      ? "surface-highlight"
      : tone === "primary"
        ? "surface-primary"
        : "flat-section";

  return (
    <div className={`${toneClass} quiet-hover rounded-[18px] p-3.5`}>
      <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-white/72">
        {icon}
      </div>
      <p className="text-[1.7rem] tracking-[-0.03em] text-foreground">{value.toLocaleString()}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/90">{label}</p>
    </div>
  );
}

function ProfileProgressCard({ series }: { series: number[] }) {
  const maxValue = Math.max(...series, 1);
  const points = series
    .map((value, index) => {
      const x = (index / (series.length - 1)) * 100;
      const y = 78 - (value / maxValue) * 52;
      return `${x},${y}`;
    })
    .join(" ");
  const focusIndex = Math.min(3, series.length - 1);
  const focusX = (focusIndex / (series.length - 1)) * 100;
  const focusY = 78 - (series[focusIndex] / maxValue) * 52;

  return (
    <div className="profile-progress-card surface-secondary mb-8 rounded-[24px] p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm text-foreground">Your Progress</h2>
        <span className="text-xs text-white/44">This month</span>
      </div>
      <div className="relative h-[8.5rem]">
        <svg viewBox="0 0 100 86" className="h-full w-full">
          <defs>
            <linearGradient id="profile-progress-line" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(152,115,222,0.95)" />
              <stop offset="55%" stopColor="rgba(194,143,92,0.9)" />
              <stop offset="100%" stopColor="rgba(238,178,120,0.85)" />
            </linearGradient>
            <linearGradient id="profile-progress-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(152,115,222,0.22)" />
              <stop offset="100%" stopColor="rgba(152,115,222,0)" />
            </linearGradient>
          </defs>
          <polyline
            points={`0,82 ${points} 100,82`}
            fill="url(#profile-progress-fill)"
            stroke="none"
          />
          <polyline
            points={points}
            fill="none"
            stroke="url(#profile-progress-line)"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={focusX} cy={focusY} r="2.6" fill="rgba(230,186,141,0.98)" />
        </svg>
        <span
          className="profile-progress-pill absolute -translate-x-1/2 -translate-y-1/2 text-[10px]"
          style={{ left: `${focusX}%`, top: `${focusY}%` }}
        >
          +12.5%
        </span>
      </div>
      <div className="mt-1 grid grid-cols-7 text-center text-[11px] text-white/34">
        {PROGRESS_MONTHS.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
    </div>
  );
}
