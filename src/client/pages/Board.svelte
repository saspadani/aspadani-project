<script lang="ts">
  import { onMount } from "svelte";
  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import { api } from "../lib/api";
  import type { Column, Task, RecurringTask } from "../lib/types";
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

  // ---- recurring tasks UI state ----------------------------------------------
  let showRecurring = $state(false);

  // ---- recurring tasks ------------------------------------------------------
  let recurring = $state<RecurringTask[]>([]);
  let recurringLoaded = $state(false);
  let showRecurringForm = $state(false);
  let editingRecurring = $state<RecurringTask | null>(null);
  let recurringForm = $state({
    title: "",
    notes: "",
    priority: "none" as "none" | "low" | "med" | "high",
    columnId: "",
    freqType: "daily" as "daily" | "weekly" | "monthly",
    freqInterval: 1,
    dayOfWeek: 0,
    dayOfMonth: 1,
  });
  let recurringBusy = $state(false);

  async function loadRecurring() {
    try {
      const data = await api<{ recurring: RecurringTask[] }>(
        `/api/projects/${projectId}/recurring`,
      );
      recurring = data.recurring;
    } catch {
      recurring = [];
    } finally {
      recurringLoaded = true;
    }
  }

  $effect(() => {
    if (showRecurring && !recurringLoaded) loadRecurring();
  });

  function resetRecurringForm() {
    editingRecurring = null;
    recurringForm = {
      title: "",
      notes: "",
      priority: "none",
      columnId: cols[0]?.id ?? "",
      freqType: "daily",
      freqInterval: 1,
      dayOfWeek: 0,
      dayOfMonth: 1,
    };
  }

  function editRecurring(r: RecurringTask) {
    editingRecurring = r;
    showRecurringForm = true;
    recurringForm = {
      title: r.title,
      notes: r.notes,
      priority: r.priority,
      columnId: r.columnId,
      freqType: r.freqType,
      freqInterval: r.freqInterval,
      dayOfWeek: r.dayOfWeek ?? 0,
      dayOfMonth: r.dayOfMonth ?? 1,
    };
  }

  async function saveRecurring() {
    const { title, columnId } = recurringForm;
    if (!title.trim() || !columnId || recurringBusy) return;
    recurringBusy = true;
    try {
      if (editingRecurring) {
        const { recurring: updated } = await api<{ recurring: RecurringTask }>(
          `/api/recurring/${editingRecurring.id}`,
          { method: "PATCH", body: JSON.stringify(recurringForm) },
        );
        recurring = recurring.map((r) => (r.id === updated.id ? updated : r));
      } else {
        const { recurring: created } = await api<{ recurring: RecurringTask }>(
          `/api/projects/${projectId}/recurring`,
          { method: "POST", body: JSON.stringify(recurringForm) },
        );
        recurring = [...recurring, created];
      }
      showRecurringForm = false;
      resetRecurringForm();
    } catch {
      error = "Gagal menyimpan recurring task";
    } finally {
      recurringBusy = false;
    }
  }

  async function deleteRecurring(r: RecurringTask) {
    if (!confirm(`Hapus recurring "${r.title}"?`)) return;
    recurring = recurring.filter((x) => x.id !== r.id);
    try {
      await api(`/api/recurring/${r.id}`, { method: "DELETE" });
    } catch {
      recurring = [...recurring, r];
    }
  }

  async function toggleRecurringActive(r: RecurringTask) {
    const newActive = r.active === 1 ? 0 : 1;
    recurring = recurring.map((x) => (x.id === r.id ? { ...x, active: newActive } : x));
    try {
      await api(`/api/recurring/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: newActive === 1 }),
      });
    } catch {
      recurring = recurring.map((x) => (x.id === r.id ? { ...x, active: r.active } : x));
    }
  }

  // ---- quick complete -------------------------------------------------------
  let completing = $state<Set<string>>(new Set());

  /** Cari kolom selesai (isDone=1) pertama di project ini. */
  function findDoneColumn(): string | null {
    const doneCol = cols.find((c) => c.isDone === 1);
    return doneCol?.id ?? null;
  }

  async function quickComplete(t: Task) {
    if (completing.has(t.id)) return;
    const targetColId = findDoneColumn();
    if (!targetColId || targetColId === t.columnId) return;

    completing.add(t.id);
    try {
      cols = cols.map((c) => {
        if (c.id === t.columnId) return { ...c, cards: c.cards.filter((x) => x.id !== t.id) };
        if (c.id === targetColId) return { ...c, cards: [...c.cards, { ...t, columnId: targetColId }] };
        return c;
      });
      await api(`/api/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ columnId: targetColId }),
      });
      queueOrderSync();
    } catch {
      error = "Gagal menyelesaikan task";
      load();
    } finally {
      completing.delete(t.id);
    }
  }

  // ---- filter & sort --------------------------------------------------------
  type PrioFilter = "all" | "none" | "low" | "med" | "high";
  type SortMode = "manual" | "dueDate" | "priority";
  let prioFilter = $state<PrioFilter>("all");
  let sortMode = $state<SortMode>("manual");

  const PRIO_RANK: Record<string, number> = { none: 0, low: 1, med: 2, high: 3 };

  /** Status tenggat dibandingkan hari ini. */
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

  /** Cek apakah kolom sudah melebihi WIP limit */
  function isWipExceeded(col: ColVM): boolean {
    if (col.wipLimit < 0) return false; // -1 = no limit
    return col.cards.length > col.wipLimit;
  }

  /** Cek apakah kolom penuh (WIP limit reached) */
  function isWipFull(col: ColVM): boolean {
    if (col.wipLimit < 0) return false;
    return col.cards.length >= col.wipLimit;
  }

  /** Filter + sort kolom secara reaktif setiap state berubah. */
  let visibleCols = $derived.by(() => {
    return cols.map((c) => {
      let cards = c.cards;
      if (prioFilter !== "all") {
        cards = cards.filter((t) => t.priority === prioFilter);
      }
      if (sortMode === "dueDate") {
        cards = [...cards].sort((a, b) => {
          if (!a.dueDate) return 1;
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

  async function toggleBlocked(c: ColVM) {
    const isBlocked = c.isBlocked === 1;
    try {
      await api(`/api/columns/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isBlocked: !isBlocked }),
      });
      cols = cols.map((x) => (x.id === c.id ? { ...x, isBlocked: isBlocked ? 0 : 1 } : x));
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  async function setWipLimit(c: ColVM, limit: number) {
    try {
      await api(`/api/columns/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ wipLimit: limit }),
      });
      cols = cols.map((x) => (x.id === c.id ? { ...x, wipLimit: limit } : x));
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }
  }

  // ---- aksi kartu ------------------------------------------------------------
  async function addCard(c: ColVM) {
    const title = (drafts[c.id] ?? "").trim();
    if (!title || adding[c.id]) return;

    // Check WIP limit before adding
    if (isWipFull(c)) {
      error = `WIP limit reached! Complete current tasks before adding new ones.`;
      return;
    }

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

  async function toggleTaskBlocked(t: Task) {
    const newBlocked = t.isBlocked === 1 ? 0 : 1;
    try {
      await api(`/api/tasks/${t.id}/block`, {
        method: "PATCH",
        body: JSON.stringify({ isBlocked: newBlocked === 1 }),
      });
      cols = cols.map((c) => ({
        ...c,
        cards: c.cards.map((x) => (x.id === t.id ? { ...x, isBlocked: newBlocked } : x)),
      }));
    } catch {
      error = "Gagal update blocked status";
    }
  }

  // ---- keyboard shortcuts ---------------------------------------------------
  function handleKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.key === "Escape") {
      selected = null;
      renaming = null;
      return;
    }

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      const firstInput = document.querySelector("form.add input") as HTMLInputElement;
      firstInput?.focus();
      return;
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  });
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
      <button
        class="recurring-btn"
        class:active={showRecurring}
        onclick={() => showRecurring = !showRecurring}
        title="Kelola task berulang"
      >
        🔁 Recurring
      </button>
      <a class="recurring-btn help-link" href="#/bantuan" title="Panduan penggunaan">? Panduan</a>
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
          <li
            class="col"
            class:wip-exceeded={isWipExceeded(c)}
            class:blocked-col={c.isBlocked === 1}
            animate:flip={{ duration: FLIP_MS }}
          >
            <div class="col-head">
              {#if renaming === c.id}
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
                <div
                  class="colname"
                  role="button"
                  tabindex="0"
                  title="Klik untuk ganti nama"
                  onclick={() => startRename(c)}
                  onkeydown={(e) => e.key === "Enter" && startRename(c)}
                >
                  {#if c.isBlocked === 1}<span class="blocked-icon">🚫</span>{/if}
                  {c.name}
                </div>
              {/if}
              <span class="count" class:wip-warn={isWipFull(c)} class:wip-exceeded={isWipExceeded(c)}>
                {c.cards.length}{#if c.wipLimit >= 0}/{c.wipLimit}{/if}
              </span>
            </div>
            <div class="col-actions">
              <button class="mini" onclick={() => toggleDone(c)}>
                {c.isDone ? "selesai ✓" : "tandai selesai"}
              </button>
              <button class="mini" onclick={() => toggleBlocked(c)} class:active={c.isBlocked === 1}>
                {c.isBlocked ? "🚫 Blocked" : "Block"}
              </button>
              <button class="mini" onclick={() => {
                const limit = prompt("WIP Limit (-1 untuk tidak ada):", String(c.wipLimit));
                if (limit !== null) setWipLimit(c, parseInt(limit) || -1);
              }}>
                WIP
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
                {@const status = dueStatus(t.dueDate)}
                <li class="card-item" animate:flip={{ duration: FLIP_MS }}>
                  <div
                    class="card"
                    class:due-overdue={status === "overdue"}
                    class:due-soon={status === "soon"}
                    class:blocked={t.isBlocked === 1}
                    role="button"
                    tabindex="0"
                    onclick={() => (selected = t)}
                    onkeydown={(e) => e.key === "Enter" && (selected = t)}
                  >
                    <span class="title">
                      {#if t.isBlocked === 1}<span class="blocked-tag">🚫</span>{/if}
                      {t.title}
                    </span>
                    {#if t.blockedReason}
                      <span class="blocked-reason">{t.blockedReason}</span>
                    {/if}
                    <span class="meta">
                      {#if t.dueDate}<span class="due {status ? `due-${status}` : ''}">📅 {t.dueDate}</span>{/if}
                      {#if t.priority !== 'none'}<span class="prio prio-{t.priority}">{t.priority}</span>{/if}
                    </span>
                  </div>
                  {#if c.isDone !== 1}
                    <div class="card-actions">
                      <button
                        class="quick-complete"
                        title="Selesai"
                        disabled={completing.has(t.id)}
                        onclick={(e) => { e.stopPropagation(); quickComplete(t); }}
                      >
                        {completing.has(t.id) ? "…" : "✓"}
                      </button>
                      <button
                        class="block-toggle"
                        title={t.isBlocked ? "Unblock" : "Block"}
                        onclick={(e) => { e.stopPropagation(); toggleTaskBlocked(t); }}
                      >
                        {t.isBlocked ? "🔓" : "🚫"}
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>

            {#if isWipExceeded(c)}
              <div class="wip-warning">
                ⚠️ WIP limit exceeded! Complete tasks before adding new ones.
              </div>
            {/if}

            <form class="add" onsubmit={(e) => { e.preventDefault(); addCard(c); }}>
              <input
                placeholder={isWipFull(c) ? "WIP limit reached" : "+ tugas"}
                bind:value={drafts[c.id]}
                maxlength={140}
                disabled={isWipFull(c)}
              />
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

{#if showRecurring}
  <div class="recurring-panel">
    <div class="recurring-header">
      <h3>Task Berulang</h3>
      <div class="recurring-actions">
        {#if !showRecurringForm}
          <button class="add-recurring" onclick={() => { resetRecurringForm(); showRecurringForm = true; }}>
            + Baru
          </button>
        {:else}
          <button class="cancel-recurring" onclick={() => { showRecurringForm = false; resetRecurringForm(); }}>
            Batal
          </button>
        {/if}
        <button class="close-recurring" onclick={() => showRecurring = false}>✕</button>
      </div>
    </div>

    {#if showRecurringForm}
      <form class="recurring-form" onsubmit={(e) => { e.preventDefault(); saveRecurring(); }}>
        <label>
          <span>Judul</span>
          <input bind:value={recurringForm.title} maxlength={140} placeholder="Task berulang…" />
        </label>
        <div class="form-row">
          <label>
            <span>Kolom</span>
            <select bind:value={recurringForm.columnId}>
              {#each cols as c}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Frekuensi</span>
            <select bind:value={recurringForm.freqType}>
              <option value="daily">Harian</option>
              <option value="weekly">Mingguan</option>
              <option value="monthly">Bulanan</option>
            </select>
          </label>
        </div>

        {#if recurringForm.freqType === "daily"}
          <label>
            <span>Setiap (hari)</span>
            <input type="number" bind:value={recurringForm.freqInterval} min={1} max={365} />
          </label>
        {:else if recurringForm.freqType === "weekly"}
          <label>
            <span>Hari dalam seminggu</span>
            <select bind:value={recurringForm.dayOfWeek}>
              <option value={0}>Minggu</option>
              <option value={1}>Senin</option>
              <option value={2}>Selasa</option>
              <option value={3}>Rabu</option>
              <option value={4}>Kamis</option>
              <option value={5}>Jumat</option>
              <option value={6}>Sabtu</option>
            </select>
          </label>
        {:else if recurringForm.freqType === "monthly"}
          <label>
            <span>Tanggal dalam bulan</span>
            <input type="number" bind:value={recurringForm.dayOfMonth} min={1} max={31} />
          </label>
        {/if}
        <div class="form-row">
          <label>
            <span>Prioritas</span>
            <select bind:value={recurringForm.priority}>
              <option value="none">—</option>
              <option value="low">Rendah</option>
              <option value="med">Sedang</option>
              <option value="high">Tinggi</option>
            </select>
          </label>
          <label>
            <span>Catatan</span>
            <input bind:value={recurringForm.notes} maxlength={200} placeholder="Opsional" />
          </label>
        </div>
        <div class="recurring-form-actions">
          <button type="submit" disabled={recurringBusy}>
            {recurringBusy ? "Menyimpan…" : editingRecurring ? "Update" : "Buat"}
          </button>
        </div>
      </form>
    {:else}
      <ul class="recurring-list">
        {#each recurring as r}
          <li class="recurring-item">
            <div class="recurring-info">
              <span class="recurring-title">{r.title}</span>
              <span class="recurring-meta">{r.freqType} · {r.priority}</span>
            </div>
            <div class="recurring-item-actions">
              <button class="mini" onclick={() => toggleRecurringActive(r)}>
                {r.active ? "⏸" : "▶"}
              </button>
              <button class="mini" onclick={() => editRecurring(r)}>✏️</button>
              <button class="mini" onclick={() => deleteRecurring(r)}>🗑</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
