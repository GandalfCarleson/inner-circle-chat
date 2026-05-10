import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { normalizeUsername, usernameToEmail, isValidUsername } from "@/lib/auth-helpers";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (username: string, password: string, displayName?: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function syncFromSession(nextSession: Session | null) {
      const nextUser = nextSession?.user ?? null;
      setSession(nextSession);
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        if (active) setLoading(false);
        return;
      }

      try {
        const nextProfile = await fetchProfile(nextUser.id);
        if (active) setProfile(nextProfile);
      } catch (error) {
        console.error("Failed to load profile", error);
        if (active) setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncFromSession(nextSession);
    });

    void supabase.auth.getSession().then(({ data }) => syncFromSession(data.session));

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    if (!user) return;
    setProfile(await fetchProfile(user.id));
  }

  async function signUp(username: string, password: string, displayName?: string) {
    const normalizedUsername = normalizeUsername(username);
    if (!isValidUsername(normalizedUsername)) {
      throw new Error(
        "Username must be 3-20 characters and use only letters, numbers, or underscore.",
      );
    }
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", normalizedUsername)
      .maybeSingle();
    if (existing) throw new Error("That username is taken.");

    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(normalizedUsername),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          username: normalizedUsername,
          display_name: displayName?.trim() || normalizedUsername,
        },
      },
    });

    if (error) {
      if (/already registered|user already exists/i.test(error.message)) {
        throw new Error("That username is already taken.");
      }
      if (/invalid/i.test(error.message) && /email/i.test(error.message)) {
        throw new Error("Username contains unsupported characters.");
      }
      if (/rate limit/i.test(error.message)) {
        throw new Error("Too many signup attempts. Wait a minute and try again.");
      }
      if (/email signups are disabled/i.test(error.message)) {
        throw new Error(
          "Email signup is disabled in Supabase. Enable the Email provider but keep Confirm email turned off.",
        );
      }
      if (/redirect/i.test(error.message)) {
        throw new Error(
          "Your Supabase redirect URL settings are blocking signup. Add your local app URL to Auth redirect URLs.",
        );
      }
      throw new Error(`Signup failed: ${error.message}`);
    }

    if (!data.user) throw new Error("Signup failed.");
  }

  async function signIn(username: string, password: string) {
    const normalizedUsername = normalizeUsername(username);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(normalizedUsername),
      password,
    });

    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        throw new Error(
          "This project still requires email confirmation. Disable it in Supabase Auth settings.",
        );
      }
      throw new Error("Invalid username or password.");
    }

    if (!data.user) throw new Error("Sign in failed.");
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, signUp, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside <AuthProvider>");
  return ctx;
}
