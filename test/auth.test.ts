import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * Suite auth. Password test diinjeksikan via binding miniflare
 * (lihat vitest.config.ts → injectFields APP_PASSWORD).
 */

async function login(password: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/login", () => {
  it("gagal 401 untuk password salah", async () => {
    const res = await login("salah-sekali");
    expect(res.status).toBe(401);
  });

  it("sukses 200 untuk password benar + set cookie", async () => {
    const res = await login(env.APP_PASSWORD as string);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ap_session=");
    expect(setCookie).toMatch(/HttpOnly/i);
  });
});

describe("guard sesi", () => {
  const PROTECTED = "https://example.com/api/projects";

  it("401 tanpa cookie", async () => {
    const res = await SELF.fetch(PROTECTED);
    expect(res.status).toBe(401);
  });

  it("401 dengan cookie sampah", async () => {
    const res = await SELF.fetch(PROTECTED, {
      headers: { Cookie: "ap_session=token-palsu" },
    });
    expect(res.status).toBe(401);
  });

  it("200 setelah login sukses; 401 lagi setelah logout", async () => {
    const loginRes = await login(env.APP_PASSWORD as string);
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    const ok = await SELF.fetch(PROTECTED, {
      headers: { Cookie: cookie },
    });
    expect(ok.status).toBe(200);

    const out = await SELF.fetch("https://example.com/api/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(out.status).toBe(200);

    const after = await SELF.fetch(PROTECTED, {
      headers: { Cookie: cookie },
    });
    expect(after.status).toBe(401);
  });
});
