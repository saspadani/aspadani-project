import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import type { Env } from "../types";
import { db } from "../db";
import { subtasks } from "../db/schema";

export const subtaskRoutes = new Hono<{ Bindings: Env }>();

/** List subtasks for a task (ordered). */
subtaskRoutes.get("/tasks/:taskId/subtasks", async (c) => {
  const taskId = c.req.param("taskId");
  const rows = await db(c.env)
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.sort));
  return c.json({ subtasks: rows });
});

/** Add subtask. */
subtaskRoutes.post("/tasks/:taskId/subtasks", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const title = body.title?.trim();
  if (!title) return c.json({ error: "judul wajib diisi" }, 400);

  const existing = await db(c.env)
    .select({ sort: subtasks.sort })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.sort));
  const maxSort = existing.length > 0 ? existing[existing.length - 1].sort : -1;

  const id = crypto.randomUUID();
  await db(c.env).insert(subtasks).values({ id, taskId, title, sort: maxSort + 1 });
  const [row] = await db(c.env).select().from(subtasks).where(eq(subtasks.id, id)).limit(1);
  return c.json({ subtask: row }, 201);
});

/** Toggle done / edit title. */
subtaskRoutes.patch("/subtasks/:id", async (c) => {
  const id = c.req.param("id");
  type Patch = { title?: string; done?: boolean };
  const body = await c.req.json<Patch>().catch(() => ({}) as Patch);
  const patch: Record<string, unknown> = {};
  if (body.title?.trim()) patch.title = body.title.trim();
  if (typeof body.done === "boolean") patch.done = body.done ? 1 : 0;
  if (Object.keys(patch).length === 0) return c.json({ error: "tidak ada perubahan" }, 400);

  const result = await db(c.env).update(subtasks).set(patch).where(eq(subtasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ subtask: result[0] });
});

/** Delete subtask. */
subtaskRoutes.delete("/subtasks/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db(c.env).delete(subtasks).where(eq(subtasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ ok: true });
});
