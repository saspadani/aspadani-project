import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { boardRoutes } from "./routes/board";
import { taskRoutes } from "./routes/tasks";
import { requireSession } from "./middleware/auth";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  console.error("[worker-error]", err);
  return c.json({ error: "internal" }, 500);
});

// Publik
app.get("/api/health", (c) => c.json({ ok: true, app: "aspadani-project" }));
app.route("/api", authRoutes); // /api/login, /api/logout

// Terlindungi: semua /api/* setelah titik ini wajib sesi valid
app.use("/api/*", requireSession);
app.get("/api/me", (c) => c.json({ user: "pribadi" })); // 401 bila tak bersesi → sinyal login UI
app.route("/api/projects", projectRoutes);
app.route("/api", boardRoutes);
app.route("/api", taskRoutes);

export default app;
