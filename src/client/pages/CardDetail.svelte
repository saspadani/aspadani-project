<script lang="ts">
  import { api } from "../lib/api";
  import type { Task, Subtask } from "../lib/types";

  let {
    task,
    onClose,
    onSave,
    onDelete,
  }: {
    task: Task;
    onClose: () => void;
    onSave: (t: Task) => void;
    onDelete: (t: Task) => void;
  } = $props();

  // Form lokal; di-reset bila prop task berubah (panel dipakai ulang)
  let form = $state({ title: "", notes: "", priority: "none", dueDate: "" });
  $effect(() => {
    form = {
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      dueDate: task.dueDate ?? "",
    };
  });

  let busy = $state(false);
  let error = $state("");

  // ---- subtasks -------------------------------------------------------------
  let subtasks = $state<Subtask[]>([]);
  let newSubtaskTitle = $state("");

  $effect(() => {
    form = {
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      dueDate: task.dueDate ?? "",
    };
    loadSubtasks();
  });

  async function loadSubtasks() {
    try {
      const data = await api<{ subtasks: Subtask[] }>(
        `/api/tasks/${task.id}/subtasks`,
      );
      subtasks = data.subtasks;
    } catch {
      subtasks = [];
    }
  }

  async function addSubtask() {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    try {
      const { subtask } = await api<{ subtask: Subtask }>(
        `/api/tasks/${task.id}/subtasks`,
        { method: "POST", body: JSON.stringify({ title }) },
      );
      subtasks = [...subtasks, subtask];
      newSubtaskTitle = "";
    } catch {
      error = "Gagal menambah subtask";
    }
  }

  async function toggleSubtask(s: Subtask) {
    const newDone = s.done === 1 ? 0 : 1;
    subtasks = subtasks.map((x) => (x.id === s.id ? { ...x, done: newDone } : x));
    try {
      await api(`/api/subtasks/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: newDone === 1 }),
      });
    } catch {
      subtasks = subtasks.map((x) => (x.id === s.id ? { ...x, done: s.done } : x));
    }
  }

  async function deleteSubtask(s: Subtask) {
    subtasks = subtasks.filter((x) => x.id !== s.id);
    try {
      await api(`/api/subtasks/${s.id}`, { method: "DELETE" });
    } catch {
      subtasks = [...subtasks, s];
    }
  }

  let progress = $derived.by(() => {
    const total = subtasks.length;
    const done = subtasks.filter((s) => s.done === 1).length;
    return total === 0 ? null : { total, done, pct: Math.round((done / total) * 100) };
  });

  async function save() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const { task: updated } = await api<{ task: Task }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title,
          notes: form.notes,
          priority: form.priority,
          dueDate: form.dueDate || null,
        }),
      });
      onSave(updated);
      onClose();
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="panel" role="dialog" aria-label="Detail tugas">
    <label>
      Judul
      <input bind:value={form.title} maxlength={140} />
    </label>
    <label>
      Catatan
      <textarea bind:value={form.notes} rows={5} placeholder="Detail, tautan, dsb."></textarea>
    </label>
    <div class="row">
      <label>
        Prioritas
        <select bind:value={form.priority}>
          <option value="none">—</option>
          <option value="low">Rendah</option>
          <option value="med">Sedang</option>
          <option value="high">Tinggi</option>
        </select>
      </label>
      <label>
        Tenggat
        <input type="date" bind:value={form.dueDate} />
      </label>
    </div>

    <!-- Subtasks / Checklist -->
    <div class="subtasks">
      <div class="subtasks-head">
        <span class="subtasks-title">Checklist</span>
        {#if progress}
          <span class="progress-text">{progress.done}/{progress.total} ({progress.pct}%)</span>
        {/if}
      </div>
      {#if progress}
        <div class="progress-bar">
          <div class="progress-fill" style="width: {progress.pct}%"></div>
        </div>
      {/if}

      <ul class="subtask-list">
        {#each subtasks as s (s.id)}
          <li class="subtask-item">
            <button
              class="check"
              class:checked={s.done === 1}
              onclick={() => toggleSubtask(s)}
              aria-label={s.done === 1 ? "Tandai belum selesai" : "Tandai selesai"}
            >
              {#if s.done === 1}✓{/if}
            </button>
            <span class="subtask-title">{s.title}</span>
            <button class="delete-subtask" onclick={() => deleteSubtask(s)} aria-label="Hapus subtask">✕</button>
          </li>
        {/each}
      </ul>

      <form class="add-subtask" onsubmit={(e) => { e.preventDefault(); addSubtask(); }}>
        <input
          type="text"
          placeholder="+ tambah langkah…"
          bind:value={newSubtaskTitle}
          maxlength={100}
        />
        <button type="submit" disabled={!newSubtaskTitle.trim()}>Tambah</button>
      </form>
    </div>

    {#if error}<p class="err">{error}</p>{/if}
    <div class="actions">
      <button class="danger" onclick={() => onDelete(task)}>Hapus</button>
      <span class="spacer"></span>
      <button class="ghost" onclick={onClose}>Batal</button>
      <button class="primary" onclick={save} disabled={busy || !form.title.trim()}>
        {busy ? "Menyimpan…" : "Simpan"}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .panel {
    width: min(26rem, 92vw);
    background: #fff;
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.8rem;
    color: #737373;
  }
  input,
  textarea,
  select {
    font: inherit;
    font-size: 0.9rem;
    color: #171717;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    min-height: 44px;
  }
  textarea {
    min-height: 0;
  }
  select {
    padding-right: 1.7rem;
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
  }
  textarea {
    resize: vertical;
  }
  .row {
    display: flex;
    gap: 0.75rem;
  }
  .row label {
    flex: 1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .spacer {
    flex: 1;
  }
  button {
    font: inherit;
    font-size: 0.85rem;
    border-radius: 6px;
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    border: 1px solid #d4d4d4;
    background: #fff;
  }
  button.primary {
    background: #171717;
    color: #fff;
    border-color: #171717;
  }
  button.primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.ghost:hover {
    background: #f5f5f5;
  }
  button.danger {
    border: none;
    background: none;
    color: #dc2626;
    padding-left: 0;
  }
  button.danger:hover {
    text-decoration: underline;
  }
  .err {
    color: #dc2626;
    font-size: 0.82rem;
    margin: 0;
  }

  /* Subtasks */
  .subtasks {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid #f0f0f0;
    margin-top: 0.25rem;
  }
  .subtasks-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 500;
    color: #525252;
  }
  .progress-text {
    font-size: 0.75rem;
    color: #737373;
  }
  .progress-bar {
    height: 4px;
    background: #e5e5e5;
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #6366f1;
    border-radius: 999px;
    transition: width 0.2s;
  }
  .subtask-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .subtask-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    background: #fafafa;
    border-radius: 6px;
  }
  .check {
    width: 1.1rem;
    height: 1.1rem;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    color: #fff;
    flex-shrink: 0;
    padding: 0;
  }
  .check:hover {
    border-color: #6366f1;
  }
  .check.checked {
    background: #6366f1;
    border-color: #6366f1;
  }
  .subtask-title {
    flex: 1;
    font-size: 0.85rem;
    color: #171717;
  }
  .check.checked + .subtask-title {
    text-decoration: line-through;
    color: #a3a3a3;
  }
  .delete-subtask {
    border: none;
    background: none;
    color: #a3a3a3;
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
  }
  .delete-subtask:hover {
    color: #dc2626;
    background: #fef2f2;
  }
  .add-subtask {
    display: flex;
    gap: 0.4rem;
  }
  .add-subtask input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
  }
  .add-subtask input:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
  }
  .add-subtask button {
    padding: 0.4rem 0.7rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .add-subtask button:disabled {
    color: #9ca3af;
    background: #fafafa;
    border-color: #e5e5e5;
    cursor: default;
  }
  .add-subtask button:not(:disabled):hover {
    background: #f5f5f5;
  }
</style>
