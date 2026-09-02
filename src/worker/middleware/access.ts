import type { Context, Next } from "hono";
import type { Env } from "../types";

const TEAM_DOMAIN = "https://aspadani.cloudflareaccess.com";

type AccessCerts = { keys: Array<JsonWebKey & { kid: string }> };

let cachedKey: JsonWebKey | null = null;
let cachedKid: string | null = null;

/**
 * Verifikasi JWT Cloudflare Access (EdDSA) pada header Cf-Access-Jwt-Assertion.
 * Cek iss → aud → exp → signature. Tanpa secret ACCESS_AUD (dev lokal/test),
 * middleware teruskan (Access belum dikonfigurasi).
 */
export async function verifyAccess(c: Context<{ Bindings: Env }>, next: Next) {
  const aud = c.env.ACCESS_AUD;
  if (!aud) return next(); // dev/test: Access belum aktif

  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (!assertion) return c.json({ error: "unauthorized" }, 401);

  try {
    const [hB64, pB64, sB64] = assertion.split(".");
    const header = JSON.parse(b64urlDecode(hB64)) as { kid: string };
    const payload = JSON.parse(b64urlDecode(pB64)) as {
      iss: string;
      aud: string | string[];
      exp: number;
    };

    if (payload.iss !== TEAM_DOMAIN) return c.json({ error: "issuer salah" }, 401);
    const audOk = payload.aud === aud || (Array.isArray(payload.aud) && payload.aud.includes(aud));
    if (!audOk) return c.json({ error: "audience mismatch" }, 401);
    if (payload.exp * 1000 < Date.now()) return c.json({ error: "token kadaluarsa" }, 401);

    const key = await getCertKey(header.kid);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      b64urlToBuffer(sB64),
      b64urlToBuffer(`${hB64}.${pB64}`),
    );
    if (!ok) return c.json({ error: "signature tidak valid" }, 401);

    return next();
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
}

async function getCertKey(kid: string): Promise<CryptoKey> {
  if (cachedKey && cachedKid === kid) {
    return crypto.subtle.importKey("jwk", cachedKey, { name: "Ed25519" }, true, ["verify"]);
  }
  const res = await fetch(`${TEAM_DOMAIN}/cdn-cgi/access/certs`);
  const certs = (await res.json()) as AccessCerts;
  const jwk = certs.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("kid tidak ditemukan");
  cachedKey = jwk;
  cachedKid = kid;
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["verify"]);
}

function b64urlToBuffer(s: string): ArrayBuffer {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}
