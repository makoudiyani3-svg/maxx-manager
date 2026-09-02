export const DEFAULT_ALLOWED_EMAILS = [
  "makoudilyes6@gmail.com",
  "yanimakoudi4@gmail.com",
  "djadoun26aghiles@gmail.com",
] as const;

export function getAllowedEmails(): string[] {
  const fromEnv = process.env.ALLOWED_EMAILS;
  if (fromEnv?.trim()) {
    return fromEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_EMAILS.map((e) => e.toLowerCase());
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAllowedEmails().includes(email.trim().toLowerCase());
}
