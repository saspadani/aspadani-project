<script lang="ts">
  import { login } from "../lib/api";

  let { onSuccess }: { onSuccess: () => void } = $props();

  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!password || busy) return;
    busy = true;
    error = "";
    const ok = await login(password);
    busy = false;
    if (ok) onSuccess();
    else error = "Password salah.";
  }
</script>

<main class="wrap">
  <form class="card" onsubmit={submit}>
    <h1>Aspadani Project</h1>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="password"
      placeholder="Password"
      bind:value={password}
      autofocus
      disabled={busy}
    />
    {#if error}<p class="err">{error}</p>{/if}
    <button type="submit" disabled={busy || !password}>Masuk</button>
  </form>
</main>

<style>
  .wrap {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--bg, #fafafa);
  }
  .card {
    width: min(20rem, 90vw);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 2rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
  }
  h1 {
    font-size: 1.05rem;
    font-weight: 600;
    text-align: center;
    margin: 0 0 0.5rem;
    color: #171717;
  }
  input {
    padding: 0.55rem 0.75rem;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    font: inherit;
  }
  input:focus {
    outline: 2px solid #6366f1;
    outline-offset: -1px;
    border-color: #6366f1;
  }
  button {
    padding: 0.55rem;
    border: none;
    border-radius: 6px;
    background: #171717;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .err {
    margin: 0;
    font-size: 0.85rem;
    color: #dc2626;
    text-align: center;
  }
</style>
