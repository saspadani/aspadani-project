<script lang="ts">
  import Login from "./pages/Login.svelte";
  import Dashboard from "./pages/Dashboard.svelte";

  let authed = $state<boolean | null>(null); // null = sedang cek

  $effect(() => {
    fetch("/api/me").then((r) => (authed = r.ok));
  });
</script>

{#if authed === null}
  <p class="loading">Memuat…</p>
{:else if authed}
  <Dashboard />
{:else}
  <Login onSuccess={() => (authed = true)} />
{/if}

<style>
  .loading {
    text-align: center;
    margin-top: 40vh;
    color: #737373;
  }
</style>
