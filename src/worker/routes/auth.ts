import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { eq, lt } from "drizzle-orm";
import type { Env } from "../types";
import { db } from "../db";
import { sessions } from "../db/schema";
import {
  SESSION_COOKIE,
  SESSION_TTL_S,
  generateToken,
  hashToken,
  verifyPassword,
} from "../lib/session";

export const authRoutes = new Hono<{ Bindings: Env }>();

/** Rate limit login sederhana: 5 percobaan / IP / menit (in-memory, per isolate). */
const attempts = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) return true;
  recent.push(now);
  attempts.set(ip, recent);
  return false;
}

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (rateLimited(ip)) return c.json({ error: "terlalu banyak percobaan" }, 429);

  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  const ok = await verifyPassword(body.password, c.env.APP_PASSWORD);
  if (!ok) return c.json({ error: "password salah" }, 401);

  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_S * 1000);
  const token = generateToken();
  await db(c.env).insert(sessions).values({
    tokenHash: await hashToken(token),
    expiresAt: expires.toISOString(),
  });
  // Bersihkan sesi kadaluarsa (murah, sekali per login)
  await db(c.env).delete(sessions).where(lt(sessions.expiresAt, now.toISOString()));

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await db(c.env).delete(sessions).where(eq(sessions.tokenHash, await hashToken(token)));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => c.json({ user: "pribadi" }));
