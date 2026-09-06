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
  };
  const body = await c.req.json<ColPatch>().catch(() => ({}) as ColPatch);
  const patch: Record<string, unknown> = {};
  if (body.name?.trim()) patch.name = body.name.trim();
  if (typeof body.isDone === "boolean") patch.isDone = body.isDone ? 1 : 0;
  if (typeof body.isBlocked === "boolean") patch.isBlocked = body.isBlocked ? 1 : 0;
  if (typeof body.wipLimit === "number") patch.wipLimit = body.wipLimit;
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

/** PATCH task: update blocked status */
boardRoutes.patch("/tasks/:id/block", async (c) => {
  const id = c.req.param("id");
  type BlockBody = { isBlocked?: boolean; blockedReason?: string };
  const body = await c.req.json<BlockBody>().catch(() => ({}) as BlockBody);
  const patch: Record<string, unknown> = {};
  if (typeof body.isBlocked === "boolean") patch.isBlocked = body.isBlocked ? 1 : 0;
  if (body.blockedReason !== undefined) patch.blockedReason = body.blockedReason;
  if (Object.keys(patch).length === 0) return c.json({ error: "tidak ada perubahan" }, 400);

  const result = await db(c.env).update(tasks).set(patch).where(eq(tasks.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ task: result[0] });
});
