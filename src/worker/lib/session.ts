/**
 * Sesi login: token acak → SHA-256 hash disimpan di D1.
 * Cookie berisi token mentah; DB hanya menyimpan hash (aman bila DB bocor).
 */
export const SESSION_COOKIE = "ap_session";
export const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 hari

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verifikasi password resisten-timing (konstanta waktu). */
export async function verifyPassword(
  given: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
