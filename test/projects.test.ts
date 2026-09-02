import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env as WorkerEnv } from "../src/worker/types";

const e = env as unknown as WorkerEnv & { DB: D1Database };
const H = () => ({ "Content-Type": "application/json" });

describe("POST /api/projects", () => {
  it("buat project → 3 kolom default ikut terbentuk", async () => {
    const res = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ name: "Uji Coba" }),
    });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: { id: string } };

    const cols = await e.DB.prepare(
      "SELECT name, is_done FROM columns WHERE project_id = ? ORDER BY sort",
    )
      .bind(project.id)
      .all<{ name: string; is_done: number }>();
    expect(cols.results.map((c) => c.name)).toEqual([
      "Backlog",
      "Sedang Dikerjakan",
      "Selesai",
    ]);
    expect(cols.results[2].is_done).toBe(1);
  });

  it("nama kosong → 400", async () => {
    const res = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("menghitung tugas aktif (bukan yang di kolom selesai)", async () => {
    const created = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ name: "Hitung" }),
    });
    const { project } = (await created.json()) as { project: { id: string } };
    const cols = await e.DB.prepare(
      "SELECT id, is_done FROM columns WHERE project_id = ? ORDER BY sort",
    )
      .bind(project.id)
      .all<{ id: string; is_done: number }>();
    const backlog = cols.results[0].id;
    const done = cols.results[2].id;
    await e.DB.batch([
      e.DB.prepare("INSERT INTO tasks (id, project_id, column_id, title) VALUES ('t1', ?, ?, 'a')").bind(project.id, backlog),
      e.DB.prepare("INSERT INTO tasks (id, project_id, column_id, title) VALUES ('t2', ?, ?, 'b')").bind(project.id, done),
    ]);

    const list = await SELF.fetch("https://example.com/api/projects");
    const { projects } = (await list.json()) as { projects: Array<{ id: string; activeTaskCount: number }> };
    const target = projects.find((p) => p.id === project.id)!;
    expect(target.activeTaskCount).toBe(1);
  });
});

describe("PATCH & DELETE /api/projects/:id", () => {
  it("arsip → hilang dari list", async () => {
    const created = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ name: "Sementara" }),
    });
    const { project } = (await created.json()) as { project: { id: string } };

    const patched = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      method: "PATCH",
      headers: H(),
      body: JSON.stringify({ archived: true }),
    });
    expect(patched.status).toBe(200);

    const list = await SELF.fetch("https://example.com/api/projects");
    const { projects } = (await list.json()) as { projects: Array<{ id: string }> };
    expect(projects.find((p) => p.id === project.id)).toBeUndefined();
  });

  it("hapus permanen → tasks & columns ikut (cascade)", async () => {
    const created = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ name: "Dihapus" }),
    });
    const { project } = (await created.json()) as { project: { id: string } };

    const del = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    const tasks = await e.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?")
      .bind(project.id)
      .first<{ n: number }>();
    const cols = await e.DB.prepare("SELECT COUNT(*) AS n FROM columns WHERE project_id = ?")
      .bind(project.id)
      .first<{ n: number }>();
    expect(tasks!.n).toBe(0);
    expect(cols!.n).toBe(0);

    const delAgain = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      method: "DELETE",
    });
    expect(delAgain.status).toBe(404);
  });
});
