import { describe, it, expect } from "vitest";
import { padB64url } from "../src/worker/middleware/access";

/**
 * Regresi: JWT produksi Cloudflare Access memakai base64url TANPA padding,
 * sedangkan atob() menolak panjang yang bukan kelipatan 4. Sebelum fix,
 * setiap JWT sungguhan crash di middleware (terlihat via wrangler tail:
 * "atob() called with invalid base64-encoded data").
 *
 * Catatan domain: segmen JWT valid (base64 unpadded dari byte-array) hanya
 * berpanjang %4 ∈ {0,2,3} — sisa 1 mustahil terjadi dan memang invalid
 * sebagai base64.
 */
describe("padB64url", () => {
  it("panjang unpadded realistis (sisa %4 = 0,2,3) → atob tak crash", () => {
    for (let len = 2; len <= 21; len++) {
      const seg = "A".repeat(len); // base64 aman, tanpa -/_
      if (len % 4 === 1) continue; // mustahil di JWT sungguhan
      const padded = padB64url(seg);
      expect(() => atob(padded)).not.toThrow();
      expect(padded.length % 4).toBe(0);
    }
  });

  it("padding = btoa standar (pembanding)", () => {
    const raw = "hello world"; // panjang 11 → base64 butuh 1 char '='
    const std = btoa(raw).replace(/=+$/, ""); // unpadded
    expect(padB64url(std)).toBe(btoa(raw));
  });

  it("base64url (- _) dikonversi ke base64 (+ /)", () => {
    expect(padB64url("A-B_Cd")).toBe("A+B/Cd=="); // len 6 → 2 pad
    expect(padB64url("A-B_C")).toBe("A+B/C==="); // len 5 (sisa 1: tak di-JWT, tapi fungsi tetap deterministik)
  });

  it("sudah berpadding tetap idempoten", () => {
    expect(padB64url("ABCD")).toBe("ABCD");
    expect(padB64url("AB=")).toBe("AB==");
  });
});
