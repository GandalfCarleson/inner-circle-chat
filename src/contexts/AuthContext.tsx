import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import {
  generateKeypair,
  getPrivateKey,
  storePrivateKey,
  clearKeys,
  initCrypto,
} from "@/lib/crypto";
import { usernameToEmail, isValidUsername } from "@/lib/auth-helpers";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  public_key: string | null;
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
    initCrypto();
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
      .select("id, username, display_name, avatar_url, public_key, bio")
      .eq("id", uid)
      .maybeSingle();
    if (data) setProfile(data as Profile);
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id);
  }

  async function signUp(username: string, password: string, displayName?: string) {
    if (!isValidUsername(username)) {
      throw new Error("Username must be 3–24 chars: letters, numbers, underscore.");
    }
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    // Pre-check username uniqueness for a clean error
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username.toLowerCase())
      .maybeSingle();
    if (existing) throw new Error("That username is taken.");

    const kp = await generateKeypair();

    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          username: username.toLowerCase(),
          display_name: displayName || username,
          public_key: kp.publicKey,
        },
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error("Signup failed.");

    await storePrivateKey(data.user.id, kp.privateKey);
  }

  async function signIn(username: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    if (error) throw new Error("Invalid username or password.");
    if (!data.user) throw new Error("Sign in failed.");

    // Verify private key exists locally; if not, the user lost it (E2EE trade-off).
    const priv = await getPrivateKey(data.user.id);
    if (!priv) {
      console.warn("No local private key — old messages will be unreadable on this device.");
    }
  }

  async function signOut() {
    if (user) await clearKeys(user.id);
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
