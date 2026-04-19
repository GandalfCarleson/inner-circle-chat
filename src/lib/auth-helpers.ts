// Username-only auth: we shim a fake email so Supabase auth (which requires
// email format) accepts username/password without ever exposing email to the user.
// Use a reserved, syntactically valid domain instead of `.local`, which some
// validators reject.
const EMAIL_DOMAIN = "example.com";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

export function isValidUsername(u: string): boolean {
  return /^[a-z0-9_]{3,24}$/i.test(u);
}
