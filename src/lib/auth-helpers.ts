// Supabase auth is still email/password under the hood.
// The product is username-first, so we map usernames to a reserved email domain
// and keep the transformation isolated here instead of spreading it through auth code.
const EMAIL_DOMAIN = "example.com";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(username);
}
