<script lang="ts">
  import Login from "./pages/Login.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Board from "./pages/Board.svelte";

  let route = $state(location.hash || "#/");

  window.addEventListener("hashchange", () => {
    route = location.hash || "#/";
  });

  let authed = $state<boolean | null>(null); // null = sedang cek

  $effect(() => {
    fetch("/api/me").then((r) => (authed = r.ok));
  });

  const boardId = $derived(
    route.startsWith("#/p/") ? route.slice(4) : null,
  );
</script>

{#if authed === null}
  <p class="loading">Memuat…</p>
{:else if !authed}
  <Login onSuccess={() => (authed = true)} />
{:else if boardId}
  <Board projectId={boardId} />
{:else}
  <Dashboard />
{/if}

<style>
  .loading {
    text-align: center;
    margin-top: 40vh;
    color: #737373;
  }
</style>
