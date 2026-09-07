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

  const ROLE_LABEL: Record<string, string> = {
    backlog: "📥 backlog",
    doing: "🔧 doing",
    waiting: "⏳ waiting",
    done: "✅ done",
  };

  // ---- menu & popover kolom ---------------------------------------------------
  let menuCol = $state<string | null>(null);
  let wipEditCol = $state<string | null>(null);
  let wipEditValue = $state(0);
  let roleEditCol = $state<string | null>(null);

  function startWipEdit(c: ColVM) {
    wipEditValue = c.wipLimit;
    wipEditCol = c.id;
  }

  async function commitWipEdit(c: ColVM) {
    const limit = Number.isFinite(wipEditValue) ? Math.trunc(wipEditValue) : -1;
    await setWipLimit(c, limit);
    wipEditCol = null;
  }

  async function applyRole(c: ColVM, role: "backlog" | "doing" | "waiting" | "done" | null) {
    try {
      await api(`/api/columns/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      cols = cols.map((x) => (x.id === c.id ? { ...x, role } : x));
      roleEditCol = null;
      error = "";
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
    const unblock = t.isBlocked === 1;
    if (unblock) {
      try {
        await api(`/api/tasks/${t.id}/block`, {
          method: "PATCH",
          body: JSON.stringify({ isBlocked: false, blockedReason: null }),
        });
        cols = cols.map((c) => ({
          ...c,
          cards: c.cards.map((x) =>
            x.id === t.id ? { ...x, isBlocked: 0, blockedReason: null } : x,
          ),
        }));
      } catch {
        error = "Gagal update blocked status";
      }
      return;
    }
    const reason = prompt(
      'Alasan task ini diblokir? (mis. "menunggu balasan Pak X")',
      t.blockedReason ?? "",
    );
    if (reason === null) return; // dibatalkan — jangan ubah status
    try {
      const { task } = await api<{ task: Task }>(`/api/tasks/${t.id}/block`, {
        method: "PATCH",
        body: JSON.stringify({ isBlocked: true, blockedReason: reason.trim() || null }),
      });
      cols = cols.map((c) => ({
        ...c,
        cards: c.cards.map((x) =>
          x.id === t.id
            ? { ...x, isBlocked: task.isBlocked ?? 1, blockedReason: task.blockedReason ?? null }
            : x,
        ),
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
      if (menuCol !== null) { menuCol = null; return; }
      if (wipEditCol !== null) { wipEditCol = null; return; }
      if (roleEditCol !== null) { roleEditCol = null; return; }
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
              <button class="mini" onclick={() => toggleBlocked(c)} class:active={c.isBlocked === 1}>
                {c.isBlocked ? "🚫 Blocked" : "Block"}
              </button>
              <button
                class="mini"
                class:active={menuCol === c.id}
                onclick={(e) => { e.stopPropagation(); menuCol = menuCol === c.id ? null : c.id; }}
                aria-haspopup="menu"
                aria-expanded={menuCol === c.id}
                title="Opsi kolom"
              >
                ⋯
              </button>
            </div>

            {#if menuCol === c.id}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div class="col-menu-backdrop" onclick={() => (menuCol = null)}></div>
              <div class="col-menu" role="menu">
                <button role="menuitem" onclick={() => { menuCol = null; toggleDone(c); }}>
                  {c.isDone ? "↩ Tandai belum selesai" : "✓ Tandai selesai"}
                </button>
                <button role="menuitem" onclick={() => { menuCol = null; startWipEdit(c); }}>
                  WIP Limit… <span class="menu-value">{c.wipLimit >= 0 ? c.wipLimit : "∞"}</span>
                </button>
                <button role="menuitem" onclick={() => { menuCol = null; roleEditCol = c.id; }}>
                  Role… <span class="menu-value">{ROLE_LABEL[c.role ?? ""] ?? "—"}</span>
                </button>
                <hr />
                <button role="menuitem" class="danger" onclick={() => { menuCol = null; removeColumn(c); }}>
                  Hapus kolom
                </button>
              </div>
            {/if}

            {#if wipEditCol === c.id}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div class="col-pop">
                <div class="col-pop-title">WIP Limit — {c.name}</div>
                <div class="wip-stepper">
                  <button type="button" onclick={() => (wipEditValue = wipEditValue - 1)} aria-label="Kurangi">−</button>
                  <input
                    type="number"
                    bind:value={wipEditValue}
                    min={-1}
                    max={99}
                    onkeydown={(e) => { if (e.key === "Enter") commitWipEdit(c); }}
                  />
                  <button type="button" onclick={() => (wipEditValue = wipEditValue + 1)} aria-label="Tambah">＋</button>
                </div>
                <p class="col-pop-hint">-1 = tanpa batas. Saran riset: <strong>doing = 1–2</strong>.</p>
                <div class="col-pop-actions">
                  <button class="pop-cancel" onclick={() => (wipEditCol = null)}>Batal</button>
                  <button class="pop-save" onclick={() => commitWipEdit(c)}>Simpan</button>
                </div>
              </div>
            {:else if roleEditCol === c.id}
              <div class="col-pop">
                <div class="col-pop-title">Peran Kolom — {c.name}</div>
                <div class="role-choices">
                  {#each Object.entries(ROLE_LABEL) as [value, label]}
                    <button
                      class="role-choice"
                      class:selected={c.role === value}
                      onclick={() => applyRole(c, value as "backlog" | "doing" | "waiting" | "done")}
                    >
                      {label}
                    </button>
                  {/each}
                </div>
                <p class="col-pop-hint">Role menentukan isi daftar <strong>Fokus Hari Ini</strong>.</p>
                <div class="col-pop-actions">
                  {#if c.role}
                    <button class="pop-clear" onclick={() => applyRole(c, null)}>Hapus peran</button>
                  {/if}
                  <span class="spacer"></span>
                  <button class="pop-cancel" onclick={() => (roleEditCol = null)}>Tutup</button>
                </div>
              </div>
            {/if}

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
    color: #525252;
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
    padding: 0.35rem 1.7rem 0.35rem 0.5rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
    background-color: #fff;
  }
  .controls select:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
  }
  .recurring-btn {
    margin-left: 0.6rem;
    padding: 0.35rem 0.65rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    color: #525252;
    white-space: nowrap;
  }
  .recurring-btn:hover {
    background: #f5f5f5;
  }
  .recurring-btn.active {
    background: #eef2ff;
    border-color: #6366f1;
    color: #4f46e5;
  }
  a.recurring-btn {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
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
    align-items: stretch;
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    flex: 1;
    min-height: 70vh;
  }
  .col {
    flex: 0 0 17rem;
    min-height: 15rem;
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
    color: #525252;
    background: #fff;
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .col-actions {
    display: flex;
    gap: 0.4rem;
  }

  /* Menu & popover kolom */
  .col-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .col-menu {
    position: absolute;
    top: 2.4rem;
    right: 0.5rem;
    z-index: 31;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    min-width: 12rem;
  }
  .col-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border: none;
    background: none;
    font: inherit;
    font-size: 0.85rem;
    color: #171717;
    text-align: left;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    min-height: 40px;
  }
  .col-menu button:hover {
    background: #f5f5f5;
  }
  .col-menu button.danger {
    color: #dc2626;
  }
  .col-menu button.danger:hover {
    background: #fef2f2;
  }
  .col-menu hr {
    border: none;
    border-top: 1px solid #f0f0f0;
    margin: 0.25rem 0;
  }
  .menu-value {
    font-size: 0.75rem;
    color: #737373;
  }
  .col-pop {
    position: absolute;
    top: 2.4rem;
    right: 0.5rem;
    z-index: 31;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    padding: 0.75rem;
    width: min(15rem, calc(100vw - 2rem));
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .col-pop-title {
    font-size: 0.82rem;
    font-weight: 600;
  }
  .col-pop-hint {
    font-size: 0.72rem;
    color: #737373;
    margin: 0;
    line-height: 1.4;
  }
  .col-pop-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .col-pop-actions .spacer {
    flex: 1;
  }
  .col-pop-actions button {
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    min-height: 36px;
  }
  .col-pop-actions button:hover {
    background: #f5f5f5;
  }
  .pop-save {
    background: #6366f1 !important;
    border-color: #6366f1 !important;
    color: #fff !important;
  }
  .pop-save:hover {
    background: #4f46e5 !important;
  }
  .pop-clear {
    color: #dc2626;
  }
  .wip-stepper {
    display: flex;
    gap: 0.35rem;
  }
  .wip-stepper button {
    width: 2.2rem;
    min-height: 38px;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font-size: 1rem;
    cursor: pointer;
  }
  .wip-stepper button:hover {
    background: #f5f5f5;
  }
  .wip-stepper input {
    flex: 1;
    width: 100%;
    min-width: 0;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font: inherit;
    font-size: 0.9rem;
    text-align: center;
  }
  .wip-stepper input:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
  }
  .role-choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
  .role-choice {
    border: 1px solid #d4d4d4;
    border-radius: 8px;
    background: #fff;
    font: inherit;
    font-size: 0.82rem;
    padding: 0.5rem 0.4rem;
    cursor: pointer;
    min-height: 40px;
    text-align: left;
  }
  .role-choice:hover {
    background: #f5f5f5;
  }
  .role-choice.selected {
    border-color: #6366f1;
    background: #eef2ff;
    color: #4f46e5;
    font-weight: 600;
  }
  button.mini {
    border: none;
    background: none;
    color: #525252;
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
  button.mini.active {
    background: #fee2e2;
    color: #dc2626;
    font-weight: 600;
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
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
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
  .card.due-overdue {
    border-left: 3px solid #ef4444;
    background: #fef2f2;
  }
  .card.due-soon {
    border-left: 3px solid #f59e0b;
    background: #fffbeb;
  }
  .card.blocked {
    border-left: 3px solid #dc2626;
    background: #fef2f2;
    opacity: 0.85;
  }
  .blocked-tag {
    margin-right: 0.25rem;
  }
  .blocked-reason {
    font-size: 0.75rem;
    color: #dc2626;
    font-style: italic;
  }
  .blocked-icon {
    margin-right: 0.25rem;
  }
  .blocked-col {
    border-color: #fca5a5;
    background: #fef2f2;
  }
  .quick-complete {
    flex: none;
    width: 2rem;
    align-self: stretch;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font-size: 0.9rem;
    color: #6b7280;
    cursor: pointer;
    padding: 0;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .quick-complete:hover {
    background: #ecfdf5;
    border-color: #10b981;
    color: #059669;
  }
  .quick-complete:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .card-actions {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .block-toggle {
    flex: none;
    width: 2rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.15rem 0;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .block-toggle:hover {
    background: #fef2f2;
    border-color: #dc2626;
  }
  .count.wip-warn {
    background: #fef3c7;
    color: #92400e;
    font-weight: 600;
  }
  .count.wip-exceeded {
    background: #fee2e2;
    color: #dc2626;
    font-weight: 700;
  }
  .col.wip-exceeded {
    border-color: #fca5a5;
  }
  .wip-warning {
    font-size: 0.75rem;
    color: #dc2626;
    background: #fee2e2;
    border: 1px solid #fca5a5;
    border-radius: 6px;
    padding: 0.4rem 0.55rem;
    line-height: 1.35;
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
  .due-overdue {
    color: #dc2626;
    font-weight: 600;
  }
  .due-soon {
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
  form.add input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
    .card-actions {
      flex-direction: row;
    }
  }

  /* Recurring panel */
  .recurring-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: min(24rem, 92vw);
    height: 100vh;
    background: #fff;
    border-left: 1px solid #e5e5e5;
    z-index: 40;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
  }
  .recurring-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .recurring-header h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }
  .recurring-actions {
    display: flex;
    gap: 0.4rem;
  }
  .recurring-actions button {
    padding: 0.35rem 0.6rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .recurring-actions button:hover {
    background: #f5f5f5;
  }
  .add-recurring {
    background: #6366f1 !important;
    color: #fff !important;
    border-color: #6366f1 !important;
  }
  .add-recurring:hover {
    background: #4f46e5 !important;
  }
  .recurring-form {
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    border-bottom: 1px solid #f0f0f0;
    overflow-y: auto;
  }
  .recurring-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: #525252;
  }
  .recurring-form input,
  .recurring-form select,
  .recurring-form textarea {
    padding: 0.4rem 0.55rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
  }
  .recurring-form input:focus,
  .recurring-form select:focus,
  .recurring-form textarea:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
  }
  .form-row {
    display: flex;
    gap: 0.75rem;
  }
  .form-row label {
    flex: 1;
  }
  .save-recurring {
    padding: 0.5rem;
    border: none;
    border-radius: 6px;
    background: #6366f1;
    color: #fff;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .save-recurring:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .save-recurring:not(:disabled):hover {
    background: #4f46e5;
  }
  .recurring-empty {
    padding: 1.5rem 1.25rem;
    color: #737373;
    font-size: 0.85rem;
    text-align: center;
  }
  .recurring-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow-y: auto;
  }
  .recurring-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
  }
  .recurring-toggle {
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    color: #10b981;
    flex-shrink: 0;
  }
  .recurring-toggle.inactive {
    color: #a3a3a3;
  }
  .recurring-toggle:hover {
    border-color: #10b981;
  }
  .recurring-toggle.inactive:hover {
    border-color: #a3a3a3;
  }
  .recurring-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .recurring-title {
    font-size: 0.88rem;
    font-weight: 500;
  }
  .recurring-freq {
    font-size: 0.75rem;
    color: #737373;
  }
  .recurring-item-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .recurring-item-actions button {
    padding: 0.25rem 0.5rem;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    background: #fff;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .recurring-item-actions button:hover {
    background: #f5f5f5;
  }
  .delete-recurring:hover {
    color: #dc2626;
    border-color: #dc2626;
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
</style>
