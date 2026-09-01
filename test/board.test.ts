import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { Env as WorkerEnv } from "../src/worker/types";

const e = env as unknown as WorkerEnv & { DB: D1Database };
let cookieCache = "";
async function ensureCookie() {
  if (cookieCache) return;
  const res = await SELF.fetch("https://example.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: e.APP_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookieCache = res.headers.get("set-cookie")!.split(";")[0];
}
const H = () => ({ Cookie: cookieCache, "Content-Type": "application/json" });

let projectId = "";

beforeAll(async () => {
  await ensureCookie();
  const res = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: H(),
    body: JSON.stringify({ name: "Papan Uji" }),
  });
  const { project } = (await res.json()) as { project: { id: string } };
  projectId = project.id;
});

async function getBoard() {
  const res = await SELF.fetch(`https://example.com/api/projects/${projectId}/board`, {
    headers: H(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    project: { id: string };
    columns: Array<{ id: string; name: string; isDone: number; sort: number }>;
    tasks: Array<{ id: string; title: string; columnId: string; sort: number }>;
  };
}

describe("GET board", () => {
  it("struktur board: project + 3 kolom default terurut", async () => {
    const board = await getBoard();
    expect(board.project.id).toBe(projectId);
    expect(board.columns.map((c) => c.name)).toEqual([
      "Backlog",
      "Sedang Dikerjakan",
      "Selesai",
    ]);
    expect(board.columns[2].isDone).toBe(1);
    expect(board.tasks).toEqual([]);
  });

  it("404 untuk project arsip/tidak ada", async () => {
    const res = await SELF.fetch("https://example.com/api/projects/id-ngasal/board", {
      headers: H(),
    });
    expect(res.status).toBe(404);
  });
});

describe("tasks", () => {
  it("tambah task di kolom Backlog → sort 0", async () => {
    const board = await getBoard();
    const backlog = board.columns[0].id;
    const res = await SELF.fetch(`https://example.com/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ title: "Tugas A", columnId: backlog }),
    });
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as { task: { sort: number } };
    expect(task.sort).toBe(0);
  });

  it("judul kosong → 400; kolom ngasal → 404", async () => {
    const board = await getBoard();
    const backlog = board.columns[0].id;
    const bad1 = await SELF.fetch(`https://example.com/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ title: "  ", columnId: backlog }),
    });
    expect(bad1.status).toBe(400);

    const bad2 = await SELF.fetch(`https://example.com/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ title: "X", columnId: "kolom-ngasal" }),
    });
    expect(bad2.status).toBe(404);
  });

  it("dua task di kolom sama → sort 0 lalu 1", async () => {
    const board = await getBoard();
    const done = board.columns[2].id;
    const r1 = await SELF.fetch(`https://example.com/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ title: "Selesai 1", columnId: done }),
    });
    const r2 = await SELF.fetch(`https://example.com/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ title: "Selesai 2", columnId: done }),
    });
    const t1 = ((await r1.json()) as { task: { sort: number } }).task;
    const t2 = ((await r2.json()) as { task: { sort: number } }).task;
    expect(t1.sort).toBe(0);
    expect(t2.sort).toBe(1);
  });

  it("PATCH task: prioritas + dueDate tervalidasi", async () => {
    const board = await getBoard();
    const taskId = board.tasks[0].id;
    const res = await SELF.fetch(`https://example.com/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: H(),
      body: JSON.stringify({ priority: "high", dueDate: "2026-09-10" }),
    });
    expect(res.status).toBe(200);
    const { task } = (await res.json()) as { task: { priority: string; dueDate: string | null } };
    expect(task.priority).toBe("high");
    expect(task.dueDate).toBe("2026-09-10");

    // prioritas tak dikenal → diabaikan (tetap high)
    const res2 = await SELF.fetch(`https://example.com/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: H(),
      body: JSON.stringify({ priority: "ultra" }),
    });
    const { task: task2 } = (await res2.json()) as { task: { priority: string } };
    expect(task2.priority).toBe("high");
  });

  it("DELETE task menghapus task", async () => {
    const board = await getBoard();
    const t = board.tasks.find((x) => x.title === "Selesai 1")!;
    const res = await SELF.fetch(`https://example.com/api/tasks/${t.id}`, {
      method: "DELETE",
      headers: H(),
    });
    expect(res.status).toBe(200);
    const after = await getBoard();
    expect(after.tasks.find((x) => x.id === t.id)).toBeUndefined();
  });
});

describe("order (hasil drag)", () => {
  it("reorder dalam kolom + pindah kolom sekaligus, konsisten di DB", async () => {
    const board = await getBoard();
    const backlog = board.columns[0];
    const mid = board.columns[1];
    const colTasks = board.tasks.filter((t) => t.columnId === backlog.id);
    expect(colTasks.length).toBeGreaterThanOrEqual(1);

    // Pindahkan task pertama backlog ke kolom tengah posisi 0, dan balik urutan sisanya
    const moving = colTasks[0];
    const body = {
      tasks: [
        { id: moving.id, columnId: mid.id, sort: 0 },
        ...colTasks.slice(1).map((t, i) => ({ id: t.id, columnId: backlog.id, sort: i })),
      ],
    };
    const res = await SELF.fetch(`https://example.com/api/board/${projectId}/order`, {
      method: "PATCH",
      headers: H(),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);

    const after = await getBoard();
    const moved = after.tasks.find((t) => t.id === moving.id)!;
    expect(moved.columnId).toBe(mid.id);
    expect(moved.sort).toBe(0);

    // Reorder kolom juga bekerja
    const res2 = await SELF.fetch(`https://example.com/api/board/${projectId}/order`, {
      method: "PATCH",
      headers: H(),
      body: JSON.stringify({
        columns: [
          { id: after.columns[1].id, sort: 0 },
          { id: after.columns[0].id, sort: 1 },
        ],
      }),
    });
    expect(res2.status).toBe(200);
    const after2 = await getBoard();
    expect(after2.columns[0].id).toBe(mid.id);
  });

  it("PATCH order dengan task dari project lain → diabaikan (guard project_id)", async () => {
    // buat project kedua + task di kolom miliknya sendiri (operasi sah)
    const created = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ name: "Project Lain" }),
    });
    const { project: other } = (await created.json()) as { project: { id: string } };
    const otherBoard = (await (
      await SELF.fetch(`https://example.com/api/projects/${other.id}/board`, { headers: H() })
    ).json()) as { columns: Array<{ id: string }> };
    const otherBacklog = otherBoard.columns[0].id;

    const made = await SELF.fetch(`https://example.com/api/projects/${other.id}/tasks`, {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ title: "Tugas orang lain", columnId: otherBacklog }),
    });
    expect(made.status).toBe(201);
    const { task: foreignTask } = (await made.json()) as { task: { id: string } };

    // coba pindahkan task project lain lewat endpoint project pertama
    const firstBoard = await getBoard();
    const firstBacklog = firstBoard.columns[0].id;
    const res = await SELF.fetch(`https://example.com/api/board/${projectId}/order`, {
      method: "PATCH",
      headers: H(),
      body: JSON.stringify({
        tasks: [{ id: foreignTask.id, columnId: firstBacklog, sort: 5 }],
      }),
    });
    expect(res.status).toBe(200); // batch sukses, tapi…

    // …task asing TIDAK berubah (masih kolom asalnya, sort tetap 0)
    const check = await e.DB.prepare("SELECT column_id, sort FROM tasks WHERE id = ?")
      .bind(foreignTask.id)
      .first<{ column_id: string; sort: number }>();
    expect(check!.column_id).toBe(otherBacklog);
    expect(check!.sort).toBe(0);
  });
});
