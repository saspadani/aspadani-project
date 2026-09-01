import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { requireSession } from "./middleware/auth";

const app = new Hono<{ Bindings: Env }>();

// Publik
app.get("/api/health", (c) => c.json({ ok: true, app: "aspadani-project" }));
app.route("/api", authRoutes); // /api/login, /api/logout, /api/me

// Terlindungi: semua /api/* setelah titik ini wajib sesi valid
app.use("/api/*", requireSession);

app.get("/api/protected-test", (c) => c.json({ ok: true, authed: true }));

export default app;
