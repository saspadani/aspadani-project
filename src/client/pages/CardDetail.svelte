<script lang="ts">
  import { api } from "../lib/api";
  import type { Task } from "../lib/types";

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
      <textarea bind:value={form.notes} rows={5} placeholder="Detil, tautan, dsb."></textarea>
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
</style>
