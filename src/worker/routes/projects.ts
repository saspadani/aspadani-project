import { Hono } from "hono";
import { eq, asc, sql, and } from "drizzle-orm";
import type { Env } from "../types";
import { db } from "../db";
import { projects, columns, tasks } from "../db/schema";

export const projectRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_COLUMNS = ["Backlog", "Sedang Dikerjakan", "Selesai"];

/** List project TERARSIP (untuk section Arsip di dashboard). */
projectRoutes.get("/archived", async (c) => {
  const rows = await db(c.env)
    .select({
      id: projects.id,
      name: projects.name,
      color: projects.color,
      sort: projects.sort,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.archived, 1))
    .orderBy(sql`${projects.updatedAt} DESC`)
    .limit(100);
  return c.json({ projects: rows });
});

/** List project aktif + jumlah task aktif (subquery ter-index). */
/** List kolom terurut (ringan — untuk quick-add). */
/** Search tasks by title/notes across all projects. */
projectRoutes.get("/search", async (c) => {
  const q = new URL(c.req.url).searchParams.get("q")?.trim();
  if (!q) return c.json({ results: [] });

  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db(c.env)
    .select({
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskNotes: tasks.notes,
      taskPriority: tasks.priority,
      taskDueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      projectColor: projects.color,
      colName: columns.name,
    })
    .from(tasks)
    .innerJoin(columns, eq(tasks.columnId, columns.id))
    .innerJoin(projects, and(eq(tasks.projectId, projects.id), eq(projects.archived, 0)))
    .where(sql`(${tasks.title} LIKE ${like} ESCAPE '\\' OR ${tasks.notes} LIKE ${like} ESCAPE '\\')`)
    .orderBy(projects.sort, tasks.sort)
    .limit(50);
  return c.json({ results: rows });
});

projectRoutes.get("/:id/columns", async (c) => {
  const projectId = c.req.param("id");
  const cols = await db(c.env)
    .select({ id: columns.id, name: columns.name, isDone: columns.isDone })
    .from(columns)
    .where(eq(columns.projectId, projectId))
    .orderBy(asc(columns.sort));
  return c.json({ columns: cols });
});

projectRoutes.get("/", async (c) => {
  const rows = await db(c.env)
    .select({
      id: projects.id,
      name: projects.name,
      color: projects.color,
      sort: projects.sort,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      activeTaskCount: sql<number>`(
        SELECT COUNT(*) FROM tasks t JOIN columns c ON c.id = t.column_id
        WHERE t.project_id = projects.id AND c.is_done = 0
      )`,
    })
    .from(projects)
    .where(eq(projects.archived, 0))
    .orderBy(asc(projects.sort), asc(projects.createdAt));
  return c.json({ projects: rows });
});

/** Buat project + 3 kolom default (atomik via batch). */
projectRoutes.post("/", async (c) => {
  const body = await c.req
    .json<{ name?: string; color?: string }>()
    .catch(() => ({}) as { name?: string; color?: string });
  const name = body.name?.trim();
  if (!name) return c.json({ error: "nama wajib diisi" }, 400);

  const id = crypto.randomUUID();
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color ?? "") ? body.color! : "#6366f1";
  const cols = DEFAULT_COLUMNS.map((name2, i) => ({
    id: crypto.randomUUID(),
    projectId: id,
    name: name2,
    sort: i,
    isDone: i === DEFAULT_COLUMNS.length - 1 ? 1 : 0,
  }));

  await db(c.env).batch([
    db(c.env).insert(projects).values({ id, name, color }),
    db(c.env).insert(columns).values(cols),
  ]);

  const [project] = await db(c.env).select().from(projects).where(eq(projects.id, id)).limit(1);
  return c.json({ project }, 201);
});

projectRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  type ProjectPatch = { name?: string; color?: string; archived?: boolean; sort?: number };
  const body = await c.req.json<ProjectPatch>().catch(() => ({}) as ProjectPatch);
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.color && /^#[0-9a-fA-F]{6}$/.test(body.color)) patch.color = body.color;
  if (typeof body.archived === "boolean") patch.archived = body.archived ? 1 : 0;
  if (typeof body.sort === "number") patch.sort = body.sort;

  const result = await db(c.env).update(projects).set(patch).where(eq(projects.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ project: result[0] });
});

projectRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db(c.env).delete(projects).where(eq(projects.id, id)).returning();
  if (result.length === 0) return c.json({ error: "tidak ditemukan" }, 404);
  return c.json({ ok: true }); // tasks & columns ikut terhapus (ON DELETE CASCADE)
});
