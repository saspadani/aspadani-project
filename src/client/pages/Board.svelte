<script lang="ts">
  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import { api } from "../lib/api";
  import type { Column, Task } from "../lib/types";
  import CardDetail from "./CardDetail.svelte";

  let { projectId }: { projectId: string } = $props();

  type ColVM = Column & { cards: Task[] };

  let projectName = $state("");
  let cols = $state<ColVM[]>([]);
  let loaded = $state(false);
  let error = $state("");

  let newColName = $state("");
  let drafts = $state<Record<string, string>>({});
  let adding = $state<Record<string, boolean>>({});

  let selected = $state<Task | null>(null);

  // ---- filter & sort --------------------------------------------------------
  type PrioFilter = "all" | "none" | "low" | "med" | "high";
  type SortMode = "manual" | "dueDate" | "priority";
  let prioFilter = $state<PrioFilter>("all");
  let sortMode = $state<SortMode>("manual");

  const PRIO_RANK: Record<string, number> = { none: 0, low: 1, med: 2, high: 3 };

  /** Filter + sort kolom secara reaktif setiap state berubah. */
  let visibleCols = $derived.by(() => {
    return cols.map((c) => {
      let cards = c.cards;
      if (prioFilter !== "all") {
        cards = cards.filter((t) => t.priority === prioFilter);
      }
      if (sortMode === "dueDate") {
        cards = [...cards].sort((a, b) => {
          if (!a.dueDate) return 1; // tanpa tenggat → bawah
          if (!b.dueDate) return 1;
          if (a.dueDate === b.dueDate) return 0;
          return a.dueDate < b.dueDate ? -1 : 1;
        });
      } else if (sortMode === "priority") {
        cards = [...cards].sort(
          (a, b) => (PRIO_RANK[b.priority] ?? 0) - (PRIO_RANK[a.priority] ?? 0),
        );
      }
      return { ...c, cards };
    });
  });

  const FLIP_MS = 160;

  async function load() {
    try {
      const data = await api<{
        project: { name: string };
        columns: Column[];
        tasks: Task[];
      }>(`/api/projects/${projectId}/board`);
      projectName = data.project.name;
      cols = data.columns.map((c) => ({
        ...c,
        cards: data.tasks.filter((t) => t.columnId === c.id),
      }));
      loaded = true;
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }
  load();

  // ---- optimistic order sync -------------------------------------------------
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  function queueOrderSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(pushOrder, 600);
  }
  async function pushOrder() {
    const body = {
      columns: cols.map((c, i) => ({ id: c.id, sort: i })),
      tasks: cols.flatMap((c) => c.cards.map((t, i) => ({ id: t.id, columnId: c.id, sort: i }))),
    };
    try {
      await api(`/api/board/${projectId}/order`, { method: "PATCH", body: JSON.stringify(body) });
    } catch {
      error = "Gagal menyimpan urutan — memuat ulang…";
      load();
    }
  }

  // ---- dnd handlers (Svelte 5: atribut onconsider/onfinalize) ----------------
  function setCards(colId: string, e: CustomEvent) {
    const items = e.detail.items as Task[];
    cols = cols.map((c) => (c.id === colId ? { ...c, cards: items } : c));
  }
  function onColumnFinalize(e: CustomEvent) {
    cols = e.detail.items as ColVM[];
    queueOrderSync();
  }

  // ---- aksi kolom ------------------------------------------------------------
  async function addColumn() {
    const name = newColName.trim();
    if (!name) return;
    try {
      const { column } = await api<{ column: Column }>(`/api/projects/${projectId}/columns`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      cols = [...cols, { ...column, cards: [] }];
      newColName = "";
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  function startRename(c: ColVM) {
    renaming = c.id;
    renameValue = c.name;
  }
  async function commitRename() {
    const col = cols.find((x) => x.id === renaming);
    const name = renameValue.trim();
    renaming = null;
    if (!col || !name || name === col.name) return;
    try {
      await api(`/api/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      cols = cols.map((c) => (c.id === col.id ? { ...c, name } : c));
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  async function removeColumn(c: ColVM) {
    const n = c.cards.length;
    const msg =
      n > 0 ? `Hapus kolom "${c.name}" beserta ${n} tugasnya?` : `Hapus kolom "${c.name}"?`;
    if (!confirm(msg)) return;
    try {
      await api(`/api/columns/${c.id}`, { method: "DELETE" });
      cols = cols.filter((x) => x.id !== c.id);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  async function toggleDone(c: ColVM) {
    const isDone = c.isDone === 1;
    try {
      await api(`/api/columns/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDone: !isDone }),
      });
      cols = cols.map((x) => (x.id === c.id ? { ...x, isDone: isDone ? 0 : 1 } : x));
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  // ---- aksi kartu ------------------------------------------------------------
  async function addCard(c: ColVM) {
    const title = (drafts[c.id] ?? "").trim();
    if (!title || adding[c.id]) return;
    adding[c.id] = true;
    try {
      const { task } = await api<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, columnId: c.id }),
      });
      cols = cols.map((x) =>
        x.id === c.id ? { ...x, cards: [...x.cards, task] } : x,
      );
      drafts[c.id] = "";
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    } finally {
      adding[c.id] = false;
    }
  }

  async function deleteCard(t: Task) {
    if (!confirm(`Hapus tugas "${t.title}"?`)) return;
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      cols = cols.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== t.id) }));
      if (selected?.id === t.id) selected = null;
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  function saveCard(updated: Task) {
    cols = cols.map((c) => ({
      ...c,
      cards: c.cards.map((t) => (t.id === updated.id ? updated : t)),
    }));
    selected = updated;
  }
</script>

<main class="board-page">
  <header>
    <a class="back" href="#/">‹ Proyek</a>
    <h1>{projectName}</h1>
    <div class="controls">
      <label>
        <span>Prioritas</span>
        <select bind:value={prioFilter} aria-label="Filter prioritas">
          <option value="all">Semua</option>
          <option value="high">Tinggi</option>
          <option value="med">Sedang</option>
          <option value="low">Rendah</option>
          <option value="none">—</option>
        </select>
      </label>
      <label>
        <span>Urutkan</span>
        <select bind:value={sortMode} aria-label="Urutkan task">
          <option value="manual">Manual</option>
          <option value="dueDate">Tenggat</option>
          <option value="priority">Prioritas</option>
        </select>
      </label>
    </div>
  </header>
  {#if error}<p class="err">{error}</p>{/if}

  {#if loaded}
    <div class="board-wrap">
      <section
        class="board"
        use:dndzone={{ items: cols, type: "column", flipDurationMs: FLIP_MS }}
        onconsider={(e: CustomEvent) => (cols = e.detail.items as ColVM[])}
        onfinalize={onColumnFinalize}
      >
        {#each visibleCols as c (c.id)}
          <li class="col" animate:flip={{ duration: FLIP_MS }}>
            <div class="col-head">
              {#if renaming === c.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="rename"
                  bind:value={renameValue}
                  onkeydown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") renaming = null;
                  }}
                  onblur={commitRename}
                  autofocus
                />
              {:else}
                <!-- div role=button: svelte-dnd-action menolak drag pada elemen ber-.value (button/input) -->
                <div
                  class="colname"
                  role="button"
                  tabindex="0"
                  title="Klik untuk ganti nama"
                  onclick={() => startRename(c)}
                  onkeydown={(e) => e.key === "Enter" && startRename(c)}
                >
                  {c.name}
                </div>
              {/if}
              <span class="count">{c.cards.length}</span>
            </div>
            <div class="col-actions">
              <button class="mini" onclick={() => toggleDone(c)}>
                {c.isDone ? "selesai ✓" : "tandai selesai"}
              </button>
              <button class="mini" onclick={() => removeColumn(c)}>hapus</button>
            </div>

            <!-- Zona level kartu: drag lintas kolom + reorder -->
            <ul
              class="cards"
              use:dndzone={{ items: c.cards, type: "card", flipDurationMs: FLIP_MS }}
              onconsider={(e: CustomEvent) => setCards(c.id, e)}
              onfinalize={(e: CustomEvent) => {
                setCards(c.id, e);
                queueOrderSync();
              }}
            >
              {#each c.cards as t (t.id)}
                <li class="card-item" animate:flip={{ duration: FLIP_MS }}>
                  <!-- div role=button, BUKAN <button>: HTMLButtonElement.value membuat drag ditolak library -->
                  <div
                    class="card"
                    role="button"
                    tabindex="0"
                    onclick={() => (selected = t)}
                    onkeydown={(e) => e.key === "Enter" && (selected = t)}
                  >
                    <span class="title">{t.title}</span>
                    <span class="meta">
                      {#if t.dueDate}<span class="due">📅 {t.dueDate}</span>{/if}
                      {#if t.priority !== 'none'}<span class="prio prio-{t.priority}">{t.priority}</span>{/if}
                    </span>
                  </div>
                </li>
              {/each}
            </ul>

            <form class="add" onsubmit={(e) => { e.preventDefault(); addCard(c); }}>
              <input placeholder="+ tugas" bind:value={drafts[c.id]} maxlength={140} />
            </form>
          </li>
        {/each}
      </section>

      <form class="addcol" onsubmit={(e) => { e.preventDefault(); addColumn(); }}>
        <input placeholder="+ kolom" bind:value={newColName} maxlength={40} />
      </form>
    </div>
  {:else}
    <p class="loading">Memuat papan…</p>
  {/if}
</main>

{#if selected}
  <CardDetail
    task={selected}
    onClose={() => (selected = null)}
    onSave={saveCard}
    onDelete={deleteCard}
  />
{/if}

<style>
  .board-page {
    min-height: 100vh;
    background: var(--bg, #fafafa);
    color: #171717;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: 1.25rem 1.5rem 0.5rem;
    flex-wrap: wrap;
  }
  .back {
    color: #737373;
    text-decoration: none;
    font-size: 0.9rem;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .back:hover {
    color: #171717;
  }
  h1 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .controls {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
    flex-wrap: wrap;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: #525252;
    font-weight: 500;
  }
  .controls select {
    padding: 0.35rem 0.5rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
    background: #fff;
  }
  .controls select:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
  }
  .err {
    color: #dc2626;
    font-size: 0.85rem;
    padding: 0 1.5rem;
  }
  .board-wrap {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem 1.5rem 2rem;
  }
  .board {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    flex: 1;
    min-height: 70vh;
  }
  .col {
    flex: 0 0 17rem;
    background: #f0f0f0;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    padding: 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    max-height: calc(100vh - 9rem);
    list-style: none;
  }
  .col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .col-head .colname {
    font-size: 0.92rem;
    font-weight: 600;
    margin: 0;
    cursor: text;
    border: none;
    background: none;
    padding: 0;
    color: #171717;
    font-family: inherit;
  }
  .count {
    font-size: 0.75rem;
    color: #737373;
    background: #fff;
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .col-actions {
    display: flex;
    gap: 0.4rem;
  }
  button.mini {
    border: none;
    background: none;
    color: #a3a3a3;
    font-size: 0.72rem;
    cursor: pointer;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  button.mini:hover {
    background: #e5e5e5;
    color: #525252;
  }
  .rename {
    font: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 0.2rem 0.4rem;
    width: 100%;
  }
  ul.cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 2.5rem;
    flex: 1;
    overflow-y: auto;
  }
  .card-item {
    list-style: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    width: 100%;
    text-align: left;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
    font: inherit;
    cursor: pointer;
    min-height: 44px;
  }
  .card:hover {
    border-color: #d4d4d4;
  }
  .title {
    font-size: 0.88rem;
    color: #171717;
  }
  .meta {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .due {
    font-size: 0.72rem;
    color: #737373;
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
  form.add input {
    width: 100%;
    border: 1px dashed #d4d4d4;
    border-radius: 8px;
    background: transparent;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    color: #737373;
    min-height: 44px;
  }
  form.add input:focus,
  form.addcol input:focus {
    outline: none;
    border-style: solid;
    border-color: #6366f1;
    background: #fff;
    color: #171717;
  }
  form.addcol {
    flex: 0 0 12rem;
    padding-top: 0.65rem;
  }
  form.addcol input {
    width: 100%;
    border: 1px dashed #d4d4d4;
    border-radius: 10px;
    background: transparent;
    padding: 0.55rem 0.7rem;
    font: inherit;
    font-size: 0.85rem;
    color: #737373;
    min-height: 44px;
  }
  .loading {
    color: #737373;
    padding: 2rem 1.5rem;
  }

  /* Mobile: vertical stack, full-width columns */
  @media (max-width: 768px) {
    header {
      padding: 0.75rem 1rem 0.25rem;
      gap: 0.5rem;
    }
    h1 {
      font-size: 1rem;
    }
    .board-wrap {
      flex-direction: column;
      padding: 0.5rem 1rem 1.5rem;
      gap: 0.5rem;
    }
    .board {
      flex-direction: column;
      overflow-x: visible;
      gap: 0.5rem;
      min-height: auto;
    }
    .col {
      flex: 1 1 auto;
      width: 100%;
      max-height: none;
    }
    .col-actions {
      flex-wrap: wrap;
    }
    form.addcol {
      flex: 1 1 auto;
      width: 100%;
      padding-top: 0;
    }
    form.addcol input {
      min-height: 48px;
    }
    .card {
      padding: 0.65rem 0.8rem;
    }
    .title {
      font-size: 0.95rem;
    }
    .controls select {
      font-size: 0.85rem;
      min-height: 44px;
    }
    button.mini {
      font-size: 0.85rem;
      flex: 1;
    }
  }
</style>
