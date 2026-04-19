import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { usernameToEmail, isValidUsername } from "@/lib/auth-helpers";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
      } else {
        setProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadProfile(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, bio")
      .eq("id", uid)
      .maybeSingle();
    if (data) setProfile(data as Profile);
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id);
  }

  async function signUp(username: string, password: string, displayName?: string) {
    if (!isValidUsername(username)) {
      throw new Error("Username must be 3-24 chars: letters, numbers, underscore.");
    }
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    const normalizedUsername = username.toLowerCase();

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
          display_name: displayName || username,
        },
      },
    });
    if (error) {
      if (/rate limit/i.test(error.message)) {
        throw new Error("Too many signup attempts. Wait a minute and try again.");
      }
      if (/email signups are disabled/i.test(error.message)) {
        throw new Error("Email signup is disabled in Supabase. Enable the Email provider but keep Confirm email turned off.");
      }
      if (/redirect/i.test(error.message)) {
        throw new Error("Your Supabase redirect URL settings are blocking signup. Add your local app URL to Auth redirect URLs.");
      }
      throw new Error(`Signup failed: ${error.message}`);
    }
    if (!data.user) throw new Error("Signup failed.");
  }

  async function signIn(username: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username.toLowerCase()),
      password,
    });
    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        throw new Error("This project still requires email confirmation. Disable it in Supabase Auth settings.");
      }
      throw new Error("Invalid username or password.");
    }
    if (!data.user) throw new Error("Sign in failed.");
  }

  async function signOut() {
    await supabase.auth.signOut();
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
