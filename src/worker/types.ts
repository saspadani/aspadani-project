export type Env = {
  DB: D1Database;
  /** AUD tag aplikasi Cloudflare Access — diset via `wrangler secret put ACCESS_AUD`. */
  ACCESS_AUD?: string;
};
