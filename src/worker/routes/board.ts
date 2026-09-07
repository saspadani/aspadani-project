import { Hono } from "hono";
import { eq, asc, and, sql } from "drizzle-orm";
import type { Env } from "../types";
import { db } from "../db";
import { projects, columns, tasks } from "../db/schema";

export const boardRoutes = new Hono<{ Bindings: Env }>();

/** GET board lengkap: project + kolom terurut + task terurut. */
boardRoutes.get("/projects/:id/board", async (c) => {
  const projectId = c.req.param("id");
  const [project] = await db(c.env)
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.archived, 0)))
    .limit(1);
  if (!project) return c.json({ error: "tidak ditemukan" }, 404);

  const cols = await db(c.env)
    .select()
    .from(columns)
    .where(eq(columns.projectId, projectId))
    .orderBy(asc(columns.sort));
  const allTasks = await db(c.env)
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.sort));

  return c.json({ project, columns: cols, tasks: allTasks });
});

/** Tambah kolom di posisi terakhir. */
boardRoutes.post("/projects/:id/columns", async (c) => {
  const projectId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    isBlocked?: boolean;
    wipLimit?: number;
  }>().catch(() => ({}) as { name?: string; isBlocked?: boolean; wipLimit?: number });
  const name = body.name?.trim();
  if (!name) return c.json({ error: "nama wajib diisi" }, 400);

  const [project] = await db(c.env)
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return c.json({ error: "tidak ditemukan" }, 404);

  const existing = await db(c.env)
    .select({ sort: columns.sort })
    .from(columns)
    .where(eq(columns.projectId, projectId))
    .orderBy(asc(columns.sort));
  const maxSort = existing.length > 0 ? existing[existing.length - 1].sort : -1;

  const id = crypto.randomUUID();
  await db(c.env).insert(columns).values({
    id,
    projectId,
    name,
    sort: maxSort + 1,
    isBlocked: body.isBlocked ? 1 : 0,
    wipLimit: body.wipLimit ?? -1,
  });
  const [col] = await db(c.env).select().from(columns).where(eq(columns.id, id)).limit(1);
  return c.json({ column: col }, 201);
});

boardRoutes.patch("/columns/:id", async (c) => {
  const id = c.req.param("id");
  type ColPatch = {
    name?: string;
    isDone?: boolean;
    isBlocked?: boolean;
    wipLimit?: number;
    role?: string | null;
  };
  const VALID_ROLES = ["backlog", "doing", "waiting", "done"];
  const body = await c.req.json<ColPatch>().catch(() => ({}) as ColPatch);
  const patch: Record<string, unknown> = {};
  if (body.name?.trim()) patch.name = body.name.trim();
  if (typeof body.isDone === "boolean") patch.isDone = body.isDone ? 1 : 0;
  if (typeof body.isBlocked === "boolean") patch.isBlocked = body.isBlocked ? 1 : 0;
  if (typeof body.wipLimit === "number") patch.wipLimit = body.wipLimit;
  if (body.role === null || body.role === "") patch.role = null;
  else if (typeof body.role === "string") {
    if (!VALID_ROLES.includes(body.role)) return c.json({ error: "role tidak valid" }, 400);
    patch.role = body.role;
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "tidak ada perubahan" }, 400);

  const result = await db(c.env).update(columns).set(patch).where(eq(columns.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ column: result[0] });
});

boardRoutes.delete("/columns/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db(c.env).delete(columns).where(eq(columns.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ ok: true }); // task di kolom ikut (cascade)
});

/**
 * Hasil drag: reindex kolom & task sekaligus (atomik via batch).
 * Body: { columns?: [{id, sort}], tasks?: [{id, columnId, sort}] }
 */
boardRoutes.patch("/board/:projectId/order", async (c) => {
  const projectId = c.req.param("projectId");
  type OrderBody = {
    columns?: Array<{ id: string; sort: number }>;
    tasks?: Array<{ id: string; columnId: string; sort: number }>;
  };
  const body = await c.req.json<OrderBody>().catch(() => ({}) as OrderBody);
  const statements = [];

  for (const col of body.columns ?? []) {
    statements.push(
      db(c.env).update(columns).set({ sort: col.sort }).where(eq(columns.id, col.id)),
    );
  }
  for (const t of body.tasks ?? []) {
    statements.push(
      db(c.env)
        .update(tasks)
        .set({ columnId: t.columnId, sort: t.sort, updatedAt: new Date().toISOString() })
        .where(and(eq(tasks.id, t.id), eq(tasks.projectId, projectId))),
    );
  }
  if (statements.length === 0) return c.json({ error: "kosong" }, 400);

  const d = db(c.env);
  await d.batch(statements as unknown as Parameters<typeof d.batch>[0]);
  return c.json({ ok: true });
});

/** PATCH task: update blocked status (isBlocked + blockedReason + blockedSince) */
boardRoutes.patch("/tasks/:id/block", async (c) => {
  const id = c.req.param("id");
  type BlockBody = { isBlocked?: boolean; blockedReason?: string | null };
  const body = await c.req.json<BlockBody>().catch(() => ({}) as BlockBody);
  const patch: Record<string, unknown> = {};
  if (typeof body.isBlocked === "boolean") {
    patch.isBlocked = body.isBlocked ? 1 : 0;
    patch.blockedSince = body.isBlocked ? new Date().toISOString() : null;
  }
  if (body.blockedReason !== undefined) patch.blockedReason = body.blockedReason;
  if (Object.keys(patch).length === 0) return c.json({ error: "tidak ada perubahan" }, 400);

  const result = await db(c.env).update(tasks).set(patch).where(eq(tasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ task: result[0] });
});

/**
 * GET /api/focus — daftar "Fokus Hari Ini" lintas proyek aktif.
 * Kelompok (dedup, prioritas atas ke bawah):
 *   1. terhambat : isBlocked=1 ATAU kolom.role='waiting' (kolom done dikecualikan)
 *   2. doing     : kolom.role='doing', tidak terhambat
 *   3. soon      : due_date ≤ 7 hari ke depan (termasuk overdue), belum masuk 1/2, bukan done
 * Max 8 item per kelompok.
 */
boardRoutes.get("/focus", async (c) => {
  const rows = await db(c.env)
    .select({
      taskId: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      isBlocked: tasks.isBlocked,
      blockedReason: tasks.blockedReason,
      blockedSince: tasks.blockedSince,
      columnId: tasks.columnId,
      columnRole: columns.role,
      columnDone: columns.isDone,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(columns, eq(tasks.columnId, columns.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(projects.archived, 0));

  type FocusItem = {
    id: string;
    title: string;
    priority: string;
    dueDate: string | null;
    blockedReason: string | null;
    blockedSince: string | null;
    projectId: string;
    projectName: string;
  };
  const toVM = (r: (typeof rows)[number]): FocusItem => ({
    id: r.taskId,
    title: r.title,
    priority: r.priority,
    dueDate: r.dueDate,
    blockedReason: r.blockedReason,
    blockedSince: r.blockedSince,
    projectId: r.projectId,
    projectName: r.projectName,
  });

  const notDone = (r: (typeof rows)[number]) => r.columnDone !== 1;
  const blocked = rows.filter((r) => notDone(r) && (r.isBlocked === 1 || r.columnRole === "waiting")).map(toVM);
  const doing = rows
    .filter((r) => notDone(r) && r.columnRole === "doing" && r.isBlocked !== 1)
    .map(toVM);
  const limit = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const soon = rows
    .filter((r) => {
      if (!notDone(r) || r.isBlocked === 1 || r.columnRole === "waiting" || r.columnRole === "doing") return false;
      if (!r.dueDate) return false;
      const due = new Date(r.dueDate + "T00:00:00").getTime();
      return due - now <= limit;
    })
    .map(toVM);

  const byBlockedAge = (a: FocusItem, b: FocusItem) =>
    (a.blockedSince ?? "9999").localeCompare(b.blockedSince ?? "9999");
  const byDue = (a: FocusItem, b: FocusItem) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

  return c.json({
    blocked: blocked.sort(byBlockedAge).slice(0, 8),
    doing: doing.slice(0, 8),
    soon: soon.sort(byDue).slice(0, 8),
  });
});
