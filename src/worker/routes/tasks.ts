import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { Env } from "../types";
import { db } from "../db";
import { tasks, columns } from "../db/schema";

export const taskRoutes = new Hono<{ Bindings: Env }>();

const PRIORITIES = new Set(["none", "low", "med", "high"]);

/** Tambah task ke kolom (default: posisi terakhir di kolom tsb). */
taskRoutes.post("/projects/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");
  type TaskBody = { title?: string; columnId?: string };
  const body = await c.req.json<TaskBody>().catch(() => ({}) as TaskBody);
  const title = body.title?.trim();
  if (!title) return c.json({ error: "judul wajib diisi" }, 400);
  if (!body.columnId) return c.json({ error: "kolom wajib" }, 400);

  // Kolom harus ada DAN milik project ini
  const [col] = await db(c.env)
    .select({ id: columns.id })
    .from(columns)
    .where(and(eq(columns.id, body.columnId), eq(columns.projectId, projectId)))
    .limit(1);
  if (!col) return c.json({ error: "kolom tidak ditemukan" }, 404);

  const existing = await db(c.env)
    .select({ sort: tasks.sort })
    .from(tasks)
    .where(eq(tasks.columnId, body.columnId))
    .orderBy(tasks.sort);
  const maxSort = existing.length > 0 ? existing[existing.length - 1].sort : -1;

  const id = crypto.randomUUID();
  await db(c.env).insert(tasks).values({
    id,
    projectId,
    columnId: body.columnId,
    title,
    sort: maxSort + 1,
  });
  const [task] = await db(c.env).select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return c.json({ task }, 201);
});

/** Ambil satu task berdasarkan id (dipakai daftar Fokus di dashboard). */
taskRoutes.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const [task] = await db(c.env).select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ task });
});

taskRoutes.patch("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  type TaskPatch = {
    title?: string;
    notes?: string;
    priority?: string;
    dueDate?: string | null;
    columnId?: string;
    sort?: number;
  };
  const body = await c.req.json<TaskPatch>().catch(() => ({}) as TaskPatch);
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.title?.trim()) patch.title = body.title.trim();
  if (typeof body.notes === "string") patch.notes = body.notes;
  if (body.priority && PRIORITIES.has(body.priority)) patch.priority = body.priority;
  if (body.dueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate ?? ""))
    patch.dueDate = body.dueDate;
  if (typeof body.sort === "number") patch.sort = body.sort;
  if (body.columnId) {
    // Cari task dulu untuk tahu project-nya, lalu pastikan kolom target se-project
    const [current] = await db(c.env)
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!current) return c.json({ error: "tidak ditemukan" }, 404);
    const [col] = await db(c.env)
      .select({ id: columns.id })
      .from(columns)
      .where(and(eq(columns.id, body.columnId), eq(columns.projectId, current.projectId)))
      .limit(1);
    if (!col) return c.json({ error: "kolom tidak ditemukan" }, 404);
    patch.columnId = body.columnId;
  }

  const result = await db(c.env).update(tasks).set(patch).where(eq(tasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ task: result[0] });
});

taskRoutes.delete("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db(c.env).delete(tasks).where(eq(tasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ ok: true });
});
