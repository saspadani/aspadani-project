import { Hono } from "hono";
import { eq, and, asc } from "drizzle-orm";
import type { Env } from "../types";
import { db } from "../db";
import { recurringTasks, tasks, columns } from "../db/schema";

export const recurringRoutes = new Hono<{ Bindings: Env }>();

/** List all recurring tasks (across all projects). */
recurringRoutes.get("/", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(recurringTasks)
    .where(eq(recurringTasks.active, 1))
    .orderBy(asc(recurringTasks.createdAt));
  return c.json({ recurring: rows });
});

/** List recurring tasks for a project. */
recurringRoutes.get("/projects/:projectId/recurring", async (c) => {
  const projectId = c.req.param("projectId");
  const rows = await db(c.env)
    .select()
    .from(recurringTasks)
    .where(and(eq(recurringTasks.projectId, projectId), eq(recurringTasks.active, 1)))
    .orderBy(asc(recurringTasks.createdAt));
  return c.json({ recurring: rows });
});

/** Create recurring task. */
recurringRoutes.post("/projects/:projectId/recurring", async (c) => {
  const projectId = c.req.param("projectId");
  type Body = {
    title?: string;
    notes?: string;
    priority?: string;
    columnId?: string;
    freqType?: string;
    freqInterval?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
  };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const title = body.title?.trim();
  if (!title) return c.json({ error: "judul wajib diisi" }, 400);
  if (!body.columnId) return c.json({ error: "kolom wajib" }, 400);

  // Verify column exists and belongs to project
  const [col] = await db(c.env)
    .select({ id: columns.id })
    .from(columns)
    .where(and(eq(columns.id, body.columnId), eq(columns.projectId, projectId)))
    .limit(1);
  if (!col) return c.json({ error: "kolom tidak ditemukan" }, 404);

  const freqType = body.freqType ?? "daily";
  if (!["daily", "weekly", "monthly"].includes(freqType)) {
    return c.json({ error: "frekuensi tidak valid" }, 400);
  }
  const validPriority = ["none", "low", "med", "high"].includes(body.priority ?? "")
    ? (body.priority ?? "none")
    : "none";

  const id = crypto.randomUUID();
  await db(c.env).insert(recurringTasks).values({
    id,
    projectId,
    columnId: body.columnId,
    title,
    notes: body.notes ?? "",
    priority: validPriority,
    freqType,
    freqInterval: body.freqInterval ?? 1,
    dayOfWeek: freqType === "weekly" ? (body.dayOfWeek ?? 0) : null,
    dayOfMonth: freqType === "monthly" ? (body.dayOfMonth ?? 1) : null,
  });
  const [row] = await db(c.env).select().from(recurringTasks).where(eq(recurringTasks.id, id)).limit(1);
  return c.json({ recurring: row }, 201);
});

/** Update recurring task. */
recurringRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  type Body = {
    title?: string;
    notes?: string;
    priority?: string;
    freqType?: string;
    freqInterval?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
    active?: boolean;
  };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.title?.trim()) patch.title = body.title.trim();
  if (typeof body.notes === "string") patch.notes = body.notes;
  if (body.priority && ["none", "low", "med", "high"].includes(body.priority)) {
    patch.priority = body.priority;
  }
  if (body.freqType && ["daily", "weekly", "monthly"].includes(body.freqType)) {
    patch.freqType = body.freqType;
  }
  if (typeof body.freqInterval === "number") patch.freqInterval = body.freqInterval;
  if (typeof body.dayOfWeek === "number") patch.dayOfWeek = body.dayOfWeek;
  if (typeof body.dayOfMonth === "number") patch.dayOfMonth = body.dayOfMonth;
  if (typeof body.active === "boolean") patch.active = body.active ? 1 : 0;

  if (Object.keys(patch).length === 1) return c.json({ error: "tidak ada perubahan" }, 400);

  const result = await db(c.env).update(recurringTasks).set(patch).where(eq(recurringTasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ recurring: result[0] });
});

/** Delete recurring task. */
recurringRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db(c.env).delete(recurringTasks).where(eq(recurringTasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ ok: true });
});

/**
 * Generate tasks from recurring templates.
 * Call this periodically (e.g., via cron or on each board load).
 * For each active recurring task, check if a task should be created today.
 */
recurringRoutes.post("/generate", async (c) => {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayOfWeek = today.getDay(); // 0-6
  const dayOfMonth = today.getDate(); // 1-31

  const allRecurring = await db(c.env)
    .select()
    .from(recurringTasks)
    .where(eq(recurringTasks.active, 1));

  const generated: Array<{ id: string, title: string }> = [];

  for (const rt of allRecurring) {
    // Skip if already generated today
    if (rt.lastGeneratedDate === todayStr) continue;

    let shouldGenerate = false;

    if (rt.freqType === "daily") {
      // Generate every N days (simplified: every day if interval=1)
      if (rt.freqInterval <= 1) {
        shouldGenerate = true;
      } else {
        // Check if enough days have passed since last generation
        if (!rt.lastGeneratedDate) {
          shouldGenerate = true;
        } else {
          const last = new Date(rt.lastGeneratedDate + "T00:00:00");
          const daysSince = Math.floor((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
          shouldGenerate = daysSince >= rt.freqInterval;
        }
      }
    } else if (rt.freqType === "weekly") {
      // Generate on specific day of week
      shouldGenerate = rt.dayOfWeek === dayOfWeek;
    } else if (rt.freqType === "monthly") {
      // Generate on specific day of month
      shouldGenerate = rt.dayOfMonth === dayOfMonth;
    }

    if (!shouldGenerate) continue;

    // Create the task
    const taskId = crypto.randomUUID();
    const existingTasks = await db(c.env)
      .select({ sort: tasks.sort })
      .from(tasks)
      .where(eq(tasks.columnId, rt.columnId))
      .orderBy(asc(tasks.sort));
    const maxSort = existingTasks.length > 0 ? existingTasks[existingTasks.length - 1].sort : -1;

    await db(c.env).insert(tasks).values({
      id: taskId,
      projectId: rt.projectId,
      columnId: rt.columnId,
      title: rt.title,
      notes: rt.notes,
      priority: rt.priority,
      sort: maxSort + 1,
    });

    // Update last generated date
    await db(c.env)
      .update(recurringTasks)
      .set({ lastGeneratedDate: todayStr })
      .where(eq(recurringTasks.id, rt.id));

    generated.push({ id: taskId, title: rt.title });
  }

  return c.json({ generated, count: generated.length });
});
