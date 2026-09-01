<script lang="ts">
  import { api, logout } from "../lib/api";
  import type { Project } from "../lib/types";

  let projects = $state<Project[]>([]);
  let newName = $state("");
  let busy = $state(false);
  let error = $state("");

  async function load() {
    const data = await api<{ projects: Project[] }>("/api/projects");
    projects = data.projects;
  }
  load();

  function open(p: Project) {
    location.hash = `#/p/${p.id}`;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    busy = true;
    error = "";
    try {
      const { project } = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      projects = [...projects, { ...project, activeTaskCount: 0 }];
      newName = "";
      open(project); // langsung ke board baru
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }

  async function archive(p: Project) {
    if (!confirm(`Arsipkan "${p.name}"?`)) return;
    await api(`/api/projects/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    });
    projects = projects.filter((x) => x.id !== p.id);
  }

  async function remove(p: Project) {
    if (!confirm(`Hapus PERMANEN "${p.name}" beserta semua tugasnya?`)) return;
    await api(`/api/projects/${p.id}`, { method: "DELETE" });
    projects = projects.filter((x) => x.id !== p.id);
  }
</script>

<main class="wrap">
  <header>
    <h1>Proyek</h1>
    <button class="ghost" onclick={() => logout().then(() => window.location.reload())}>
      Keluar
    </button>
  </header>

  <form class="new" onsubmit={create}>
    <input
      placeholder="Nama proyek baru…"
      bind:value={newName}
      maxlength={80}
      disabled={busy}
    />
    <button type="submit" disabled={busy || !newName.trim()} aria-label="Tambah proyek">＋</button>
  </form>
  {#if error}<p class="err">{error}</p>{/if}

  {#if projects.length === 0}
    <p class="empty">Belum ada proyek. Mulai dengan mengetik nama di atas.</p>
  {:else}
    <ul>
      {#each projects as p (p.id)}
        <li style="--accent: {p.color}">
          <button class="row" onclick={() => open(p)}>
            <span class="dot"></span>
            <span class="info">
              <strong>{p.name}</strong>
              <small>{p.activeTaskCount ?? 0} tugas aktif</small>
            </span>
          </button>
          <div class="actions">
            <button class="ghost" onclick={(e) => { e.stopPropagation(); archive(p); }}>Arsipkan</button>
            <button class="ghost danger" onclick={(e) => { e.stopPropagation(); remove(p); }}>Hapus</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .wrap {
    max-width: 34rem;
    margin: 0 auto;
    padding: 2.5rem 1rem;
    background: var(--bg, #fafafa);
    min-height: 100vh;
    color: #171717;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0;
  }
  .new {
    display: flex;
    gap: 0.5rem;
    margin: 1.25rem 0;
  }
  .new input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font: inherit;
  }
  .new input:focus {
    outline: 2px solid var(--accent, #6366f1);
    outline-offset: -1px;
  }
  .new button {
    width: 2.4rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font-size: 1.1rem;
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
  }
  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.45rem;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    border-radius: 6px;
  }
  .row:hover {
    background: #f5f5f5;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .info {
    display: flex;
    flex-direction: column;
  }
  small {
    color: #737373;
  }
  .actions {
    display: flex;
    gap: 0.35rem;
    flex: none;
  }
  button.ghost {
    border: none;
    background: none;
    color: #737373;
    font-size: 0.82rem;
    cursor: pointer;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
  }
  button.ghost:hover {
    background: #f5f5f5;
    color: #171717;
  }
  button.ghost.danger:hover {
    color: #dc2626;
    background: #fef2f2;
  }
  .empty {
    color: #737373;
    text-align: center;
    margin-top: 3rem;
  }
  .err {
    color: #dc2626;
    font-size: 0.85rem;
  }
</style>
