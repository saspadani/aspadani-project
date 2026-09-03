import { Hono } from "hono";
import type { Env } from "./types";
import { projectRoutes } from "./routes/projects";
import { boardRoutes } from "./routes/board";
import { taskRoutes } from "./routes/tasks";
import { subtaskRoutes } from "./routes/subtasks";
import { verifyAccess } from "./middleware/access";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  console.error("[worker-error]", err);
  return c.json({ error: "internal" }, 500);
});

// Cloudflare Access (dashboard) menjaga seluruh worker; middleware ini
// memverifikasi JWT Access-nya. Aktif hanya bila ACCESS_AUD diset sebagai secret.
app.use("/api/*", verifyAccess);
app.get("/api/me", (c) => c.json({ user: "pribadi" }));
app.route("/api/projects", projectRoutes);
app.route("/api", boardRoutes);
app.route("/api", taskRoutes);
app.route("/api", subtaskRoutes);

export default app;
