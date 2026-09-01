import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";
import { SESSION_COOKIE, hashToken } from "../lib/session";

/**
 * Guard semua /api/* kecuali /api/login.
 * Valid: cookie ada → hash ada di sessions & belum kadaluarsa.
 */
export async function requireSession(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await hashToken(token);
    const now = new Date().toISOString();
    const stored = await db(c.env)
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);
    if (stored.length > 0) {
      await next();
      return;
    }
  }
  return c.json({ error: "unauthorized" }, 401);
}
