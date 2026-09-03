import type { Context, Next } from "hono";
import type { Env } from "../types";

const TEAM_DOMAIN = "https://little-waterfall-121b.cloudflareaccess.com";

type AccessCerts = { keys: Array<JsonWebKey & { kid: string }> };

let cachedKey: CryptoKey | null = null;
let cachedKid: string | null = null;

/**
 * Verifikasi JWT Cloudflare Access (RS256) pada header Cf-Access-Jwt-Assertion.
 * Cek iss → aud → exp → signature. Tanpa ACCESS_AUD (dev lokal/test),
 * middleware teruskan (Access belum dikonfigurasi).
 */
export async function verifyAccess(c: Context<{ Bindings: Env }>, next: Next) {
  const aud = c.env.ACCESS_AUD;
  if (!aud) return next(); // dev/test: Access belum aktif

  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (!assertion) {
    console.log("access deny: header Cf-Access-Jwt-Assertion tidak ada");
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const [hB64, pB64, sB64] = assertion.split(".");
    const header = JSON.parse(b64urlDecode(hB64)) as { kid: string; alg: string };
    const payload = JSON.parse(b64urlDecode(pB64)) as {
      iss: string;
      aud: string | string[];
      exp: number;
    };

    if (header.alg !== "RS256") {
      console.log("access deny: alg =", header.alg);
      return c.json({ error: "alg tidak didukung" }, 401);
    }
    if (payload.iss !== TEAM_DOMAIN) {
      console.log("access deny: iss =", payload.iss);
      return c.json({ error: "issuer salah" }, 401);
    }
    const audOk = payload.aud === aud || (Array.isArray(payload.aud) && payload.aud.includes(aud));
    if (!audOk) {
      console.log("access deny: aud jwt =", JSON.stringify(payload.aud), "| vars =", aud);
      return c.json({ error: "audience mismatch" }, 401);
    }
    if (payload.exp * 1000 < Date.now()) {
      console.log("access deny: exp =", payload.exp, "| now =", Date.now() / 1000);
      return c.json({ error: "token kadaluarsa" }, 401);
    }

    const key = await getCertKey(header.kid);
    const enc = new TextEncoder();
    const data = enc.encode(`${hB64}.${pB64}`);
    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      b64urlToBuffer(sB64),
      data,
    );
    if (!ok) {
      console.log("access deny: signature tidak valid | kid =", header.kid);
      return c.json({ error: "signature tidak valid" }, 401);
    }

    return next();
  } catch (e) {
    console.log("access deny: exception =", e instanceof Error ? e.message : String(e));
    return c.json({ error: "unauthorized" }, 401);
  }
}

async function getCertKey(kid: string): Promise<CryptoKey> {
  if (cachedKey && cachedKid === kid) return cachedKey;
  const res = await fetch(`${TEAM_DOMAIN}/cdn-cgi/access/certs`);
  const certs = (await res.json()) as AccessCerts;
  const jwk = certs.keys.find((k) => k.kid === kid && k.alg === "RS256");
  if (!jwk) throw new Error("kid tidak ditemukan");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  cachedKey = key;
  cachedKid = kid;
  return key;
}

function b64urlToBuffer(s: string): ArrayBuffer {
  const bin = atob(padB64url(s));
  const buf = new ArrayBuffer(bin.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return buf;
}

function b64urlDecode(s: string): string {
  return atob(padB64url(s));
}

/** JWT memakai base64url TANPA padding; atob() menuntut kelipatan 4. */
export function padB64url(s: string): string {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  return std + "=".repeat((4 - (std.length % 4)) % 4);
}
