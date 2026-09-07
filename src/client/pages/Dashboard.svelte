<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import type { Project, ColumnOption, SearchResult, FocusItem, Task } from "../lib/types";
  import CardDetail from "./CardDetail.svelte";

  let projects = $state<Project[]>([]);
  let newName = $state("");
  let busy = $state(false);
  let error = $state("");

  // quick-add state: which project is expanded, drafts, columns cache
  let quickAddId = $state<string | null>(null);
  let quickTitle = $state("");
  let quickColId = $state("");
  let quickCols = $state<ColumnOption[]>([]);
  let quickBusy = $state(false);

  function dueStatus(dueDate: string | null): "overdue" | "soon" | null {
    if (!dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + "T00:00:00");
    const diffDays = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return "overdue";
    if (diffDays <= 2) return "soon";
    return null;
  }

  // search state
  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let searching = $state(false);
  let searchOpen = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function load() {
    const data = await api<{ projects: Project[] }>("/api/projects");
    projects = data.projects;
  }
  load();

  function open(p: Project) {
    location.hash = `#/p/${p.id}`;
  }

  function openTask(r: SearchResult) {
    location.hash = `#/p/${r.projectId}`;
    searchOpen = false;
    query = "";
    results = [];
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      searching = false;
      return;
    }
    searching = true;
    searchTimer = setTimeout(runSearch, 300);
  }

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) {
      searching = false;
      return;
    }
    try {
      const data = await api<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(q)}`,
      );
      results = data.results;
    } catch {
      results = [];
    } finally {
      searching = false;
    }
  }

  function closeSearch() {
    searchOpen = false;
    query = "";
    results = [];
  }

  // ---- keyboard shortcuts ---------------------------------------------------
  function handleKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      if (searchOpen) closeSearch();
      return;
    }

    if (isTyping) return;

    if (e.key === "/") {
      e.preventDefault();
      if (!searchOpen) searchOpen = true;
      setTimeout(() => {
        const el = document.querySelector(".search-input-wrap input") as HTMLInputElement;
        el?.focus();
      }, 50);
      return;
    }

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      const el = document.querySelector(".new input") as HTMLInputElement;
      el?.focus();
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  });

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
      open(project);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }

  async function startQuickAdd(p: Project) {
    quickAddId = p.id;
    quickTitle = "";
    quickBusy = false;
    try {
      const data = await api<{ columns: ColumnOption[] }>(
        `/api/projects/${p.id}/columns`,
      );
      quickCols = data.columns;
      quickColId = data.columns[0]?.id ?? "";
    } catch {
      error = "Gagal memuat kolom";
    }
  }

  async function submitQuickAdd() {
    if (!quickAddId || !quickTitle.trim() || !quickColId || quickBusy) return;
    quickBusy = true;
    try {
      await api(`/api/projects/${quickAddId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: quickTitle.trim(), columnId: quickColId }),
      });
      // update counter optimis
      projects = projects.map((p) =>
        p.id === quickAddId ? { ...p, activeTaskCount: (p.activeTaskCount ?? 0) + 1 } : p,
      );
      quickTitle = "";
      quickAddId = null;
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    } finally {
      quickBusy = false;
    }
  }

  function cancelQuickAdd() {
    quickAddId = null;
    quickTitle = "";
  }

  async function archive(p: Project) {
    if (!confirm(`Arsipkan "${p.name}"?`)) return;
    await api(`/api/projects/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    });
    projects = projects.filter((x) => x.id !== p.id);
    archived = [p, ...archived]; // muncul di daftar arsip tanpa reload
  }

  // ---- arsip ------------------------------------------------------------------
  let showArchive = $state(false);
  let archived = $state<Project[]>([]);
  let archiveLoaded = $state(false);

  async function toggleArchive() {
    showArchive = !showArchive;
    if (showArchive && !archiveLoaded) {
      try {
        const data = await api<{ projects: Project[] }>("/api/projects/archived");
        archived = data.projects;
        archiveLoaded = true;
      } catch (err) {
        error = String(err instanceof Error ? err.message : err);
      }
    }
  }

  async function restore(p: Project) {
    try {
      await api(`/api/projects/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      });
      archived = archived.filter((x) => x.id !== p.id);
      projects = [...projects, { ...p, activeTaskCount: 0 }];
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  async function removeArchived(p: Project) {
    if (!confirm(`Hapus PERMANEN "${p.name}" dari arsip beserta semua tugasnya?`)) return;
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      archived = archived.filter((x) => x.id !== p.id);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  async function remove(p: Project) {
    if (!confirm(`Hapus PERMANEN "${p.name}" beserta semua tugasnya?`)) return;
    await api(`/api/projects/${p.id}`, { method: "DELETE" });
    projects = projects.filter((x) => x.id !== p.id);
  }

  // ---- Fokus Hari Ini -------------------------------------------------------
  let focus = $state<{ blocked: FocusItem[]; doing: FocusItem[]; soon: FocusItem[] } | null>(null);
  let focusTask = $state<Task | null>(null);

  async function loadFocus() {
    try {
      focus = await api<{ blocked: FocusItem[]; doing: FocusItem[]; soon: FocusItem[] }>("/api/focus");
    } catch {
      focus = null;
    }
  }
  loadFocus();

  /** Umur blokir dalam hari (dari blockedSince), untuk label "terhambat N hari". */
  function blockedAge(since: string | null): string {
    if (!since) return "";
    const days = Math.floor((Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "hari ini";
    if (days === 1) return "1 hari";
    return `${days} hari`;
  }

  /** Buka modal detail task fokus lintas proyek. */
  async function openFocusItem(item: FocusItem) {
    try {
      const { task } = await api<{ task: Task }>(`/api/tasks/${item.id}`);
      focusTask = { ...task, projectId: item.projectId };
    } catch {
      error = "Gagal membuka task";
    }
  }

  function onFocusSaved(updated: Task) {
    // refetch fokus agar kelompok & isi terbaru
    loadFocus();
    focusTask = null;
    void updated;
  }

  function focusGoBoard(item: FocusItem) {
    location.hash = `#/p/${item.projectId}`;
  }

  const focusEmpty = $derived(
    focus && focus.blocked.length === 0 && focus.doing.length === 0 && focus.soon.length === 0,
  );
</script>

<main class="wrap">
  <header>
    <h1>Proyek</h1>
    <div class="head-actions">
      <a class="search-btn" href="#/bantuan" aria-label="Panduan" title="Panduan penggunaan">?</a>
      <button class="search-btn" onclick={() => searchOpen = !searchOpen} aria-label="Cari task">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
    </div>
  </header>

  {#if searchOpen}
    <div class="search-panel">
      <div class="search-input-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          type="text"
          placeholder="Cari task…"
          bind:value={query}
          oninput={onSearchInput}
          autofocus
        />
        {#if searching}<span class="spinner"></span>{/if}
        <button class="close-search" onclick={closeSearch}>✕</button>
      </div>

      {#if query.trim().length >= 2}
        {#if results.length === 0 && !searching}
          <p class="no-results">Tidak ada hasil untuk "{query.trim()}"</p>
        {:else if results.length > 0}
          <ul class="search-results">
            {#each results as r (r.taskId)}
              <li>
                <button class="result-row" onclick={() => openTask(r)}>
                  <span class="proj-dot" style="--c: {r.projectColor}"></span>
                  <span class="result-text">
                    <strong>{r.taskTitle}</strong>
                    <small>{r.projectName} · {r.colName}</small>
                  </span>
                  <span class="result-meta">
                    {#if r.taskDueDate}<span class="due due-{dueStatus(r.taskDueDate)}">📅 {r.taskDueDate}</span>{/if}
                    {#if r.taskPriority !== 'none'}<span class="prio prio-{r.taskPriority}">{r.taskPriority}</span>{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="search-hint">Ketik minimal 2 karakter untuk mencari</p>
      {/if}
    </div>
  {/if}

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

  {#if focus}
    <section class="focus">
      <h2>Fokus Hari Ini</h2>
      {#if focusEmpty}
        <p class="focus-empty">
          Belum ada yang perlu difokuskan. Tetapkan peran kolom (tombol <em>Role</em> di board):
          <strong>doing</strong> untuk pekerjaan aktif, <strong>waiting</strong> untuk yang menunggu pihak lain.
        </p>
      {:else}
        {#if focus.blocked.length > 0}
          <div class="focus-group">
            <h3>🚫 Terhambat <span class="focus-count">{focus.blocked.length}</span></h3>
            <ul>
              {#each focus.blocked as item (item.id)}
                <li>
                  <button class="focus-row" onclick={() => openFocusItem(item)}>
                    <span class="focus-info">
                      <strong>{item.title}</strong>
                      <small>
                        {item.projectName}
                        {#if item.blockedReason}· {item.blockedReason}{/if}
                        {#if item.blockedSince}· terhambat {blockedAge(item.blockedSince)}{/if}
                      </small>
                    </span>
                    {#if item.dueDate}<span class="due due-{dueStatus(item.dueDate)}">📅 {item.dueDate}</span>{/if}
                    {#if item.priority !== 'none'}<span class="prio prio-{item.priority}">{item.priority}</span>{/if}
                  </button>
                  <button class="ghost focus-open" onclick={() => focusGoBoard(item)} title="Buka board">↗</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if focus.doing.length > 0}
          <div class="focus-group">
            <h3>🔧 Sedang Dikerjakan <span class="focus-count">{focus.doing.length}</span></h3>
            <ul>
              {#each focus.doing as item (item.id)}
                <li>
                  <button class="focus-row" onclick={() => openFocusItem(item)}>
                    <span class="focus-info">
                      <strong>{item.title}</strong>
                      <small>{item.projectName}</small>
                    </span>
                    {#if item.dueDate}<span class="due due-{dueStatus(item.dueDate)}">📅 {item.dueDate}</span>{/if}
                    {#if item.priority !== 'none'}<span class="prio prio-{item.priority}">{item.priority}</span>{/if}
                  </button>
                  <button class="ghost focus-open" onclick={() => focusGoBoard(item)} title="Buka board">↗</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if focus.soon.length > 0}
          <div class="focus-group">
            <h3>📅 Mendatang (≤ 7 hari) <span class="focus-count">{focus.soon.length}</span></h3>
            <ul>
              {#each focus.soon as item (item.id)}
                <li>
                  <button class="focus-row" onclick={() => openFocusItem(item)}>
                    <span class="focus-info">
                      <strong>{item.title}</strong>
                      <small>{item.projectName}</small>
                    </span>
                    <span class="due due-{dueStatus(item.dueDate)}">📅 {item.dueDate}</span>
                    {#if item.priority !== 'none'}<span class="prio prio-{item.priority}">{item.priority}</span>{/if}
                  </button>
                  <button class="ghost focus-open" onclick={() => focusGoBoard(item)} title="Buka board">↗</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    </section>
  {/if}

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
            <button class="ghost" onclick={() => startQuickAdd(p)} title="Tambah tugas cepat">＋ tugas</button>
            <button class="ghost" onclick={(e) => { e.stopPropagation(); archive(p); }}>Arsipkan</button>
            <button class="ghost danger" onclick={(e) => { e.stopPropagation(); remove(p); }}>Hapus</button>
          </div>
        </li>

        <!-- Quick-add inline -->
        {#if quickAddId === p.id}
          <li class="quick-add" style="--accent: {p.color}">
            <form onsubmit={(e) => { e.preventDefault(); submitQuickAdd(); }}>
              <input
                type="text"
                placeholder="Judul tugas…"
                bind:value={quickTitle}
                maxlength={140}
                autofocus
              />
              <select bind:value={quickColId} aria-label="Pilih kolom">
                {#each quickCols as c}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
              <button type="submit" disabled={quickBusy || !quickTitle.trim() || !quickColId}>
                {quickBusy ? "…" : "Tambah"}
              </button>
              <button type="button" onclick={cancelQuickAdd}>Batal</button>
            </form>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}

  <!-- Section Arsip (collapsible) -->
  <section class="archive">
    <button class="archive-toggle" onclick={toggleArchive} aria-expanded={showArchive}>
      <span class="caret" class:open={showArchive}>▸</span> Arsip
    </button>
    {#if showArchive}
      {#if archived.length === 0}
        <p class="archive-empty">Tidak ada proyek terarsip.</p>
      {:else}
        <ul>
          {#each archived as p (p.id)}
            <li style="--accent: {p.color}">
              <button class="row" onclick={() => restore(p)} title="Klik untuk pulihkan ke daftar aktif">
                <span class="dot"></span>
                <span class="info">
                  <strong>{p.name}</strong>
                  <small>terarsip</small>
                </span>
              </button>
              <div class="actions">
                <button class="ghost" onclick={(e) => { e.stopPropagation(); restore(p); }}>Pulihkan</button>
                <button class="ghost danger" onclick={(e) => { e.stopPropagation(); removeArchived(p); }}>Hapus permanen</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
</main>

{#if focusTask}
  <CardDetail
    task={focusTask}
    onClose={() => (focusTask = null)}
    onSave={onFocusSaved}
    onDelete={onFocusSaved}
  />
{/if}

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
    color: #525252;
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
  .quick-add {
    padding: 0.5rem 0.5rem 0.5rem 0.5rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
  }
  .quick-add form {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .quick-add input {
    flex: 1;
    padding: 0.45rem 0.6rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
  }
  .quick-add input:focus {
    outline: 2px solid var(--accent, #6366f1);
    outline-offset: -1px;
  }
  .quick-add select {
    padding: 0.45rem 1.7rem 0.45rem 0.5rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
    background-color: #fff;
    max-width: 9rem;
  }
  .quick-add button {
    padding: 0.45rem 0.7rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .quick-add button[type="submit"] {
    background: var(--accent, #6366f1);
    color: #fff;
    border-color: var(--accent, #6366f1);
  }
  .quick-add button[type="submit"]:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .quick-add button[type="button"]:hover {
    background: #f5f5f5;
  }

  /* Search */
  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .search-btn {
    width: 2.2rem;
    height: 2.2rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #525252;
  }
  .search-btn:hover {
    background: #f5f5f5;
  }
  a.search-btn {
    text-decoration: none;
    font-weight: 600;
    font-size: 1rem;
    line-height: 1;
  }
  .search-panel {
    margin-bottom: 1rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow: hidden;
  }
  .search-input-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #f0f0f0;
  }
  .search-icon {
    color: #737373;
    flex-shrink: 0;
  }
  .search-input-wrap input {
    flex: 1;
    border: none;
    font: inherit;
    font-size: 0.95rem;
    padding: 0.3rem 0;
  }
  .search-input-wrap input:focus {
    outline: none;
  }
  .spinner {
    width: 0.8rem;
    height: 0.8rem;
    border: 2px solid #d4d4d4;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .close-search {
    border: none;
    background: none;
    color: #737373;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
  }
  .close-search:hover {
    background: #f5f5f5;
  }
  .search-hint,
  .no-results {
    padding: 0.75rem;
    color: #737373;
    font-size: 0.85rem;
    text-align: center;
  }
  .search-results {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 60vh;
    overflow-y: auto;
  }
  .result-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: none;
    border-bottom: 1px solid #f0f0f0;
    background: #fff;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .result-row:hover {
    background: #fafafa;
  }
  .result-row:last-child {
    border-bottom: none;
  }
  .proj-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--c);
    flex-shrink: 0;
  }
  .result-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .result-text small {
    color: #737373;
  }
  .result-meta {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-shrink: 0;
  }
  .due.due-overdue {
    color: #dc2626;
    font-weight: 600;
  }
  .due.due-soon {
    color: #d97706;
    font-weight: 600;
  }
  .prio {
    font-size: 0.68rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    color: #fff;
  }
  .prio-low { background: #6b7280; }
  .prio-med { background: #d97706; }
  .prio-high { background: #dc2626; }

  /* Arsip */
  .archive {
    margin-top: 2rem;
    border-top: 1px solid #e5e5e5;
    padding-top: 0.75rem;
  }
  .archive-toggle {
    border: none;
    background: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: #525252;
    cursor: pointer;
    padding: 0.35rem 0.45rem;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .archive-toggle:hover {
    background: #f0f0f0;
  }
  .caret {
    display: inline-block;
    transition: transform 0.15s;
    font-size: 0.7rem;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .archive-empty {
    color: #8a8a8a;
    font-size: 0.85rem;
    padding: 0.5rem 0.45rem;
    margin: 0;
  }
  .archive ul {
    margin-top: 0.5rem;
  }
  .archive li .info small {
    font-style: italic;
  }

  /* Fokus Hari Ini */
  .focus {
    margin: 0 0 1.25rem;
    padding: 0.75rem 0.9rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
  }
  .focus h2 {
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
  }
  .focus-group {
    margin-bottom: 0.6rem;
  }
  .focus-group:last-child {
    margin-bottom: 0;
  }
  .focus-group h3 {
    font-size: 0.8rem;
    font-weight: 600;
    color: #525252;
    margin: 0 0 0.25rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .focus-count {
    font-size: 0.7rem;
    background: #f0f0f0;
    border-radius: 999px;
    padding: 0 0.4rem;
    color: #525252;
  }
  .focus-group ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .focus-group li {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
  }
  .focus-row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    padding: 0.4rem 0.45rem;
    border-radius: 8px;
    cursor: pointer;
    min-height: 44px;
  }
  .focus-row:hover {
    background: #f5f5f5;
  }
  .focus-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
  }
  .focus-info strong {
    font-size: 0.88rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .focus-info small {
    font-size: 0.72rem;
    color: #737373;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .focus-open {
    flex: none;
    width: 2rem;
  }
  .focus-empty {
    font-size: 0.82rem;
    color: #737373;
    margin: 0;
    line-height: 1.5;
  }
</style>
