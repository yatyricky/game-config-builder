<script lang="ts">
  // 极简 pathname 路由（不引依赖）：/ → 欢迎页，/playground → 网格开发场
  import Playground from './routes/Playground.svelte';

  let path = $state(window.location.pathname);

  window.addEventListener('popstate', () => {
    path = window.location.pathname;
  });

  function navigate(next: string): void {
    window.history.pushState(null, '', next);
    path = next;
  }
</script>

{#if path === '/playground'}
  <Playground />
{:else}
  <main class="home">
    <h1>game-config-builder</h1>
    <p>内网自部署、强类型、关系感知的 web 游戏配置平台。</p>
    <ul>
      <li><a href="/playground" onclick={(e) => { e.preventDefault(); navigate('/playground'); }}>网格 playground（M6 开发场）</a></li>
    </ul>
  </main>
{/if}

<style>
  .home {
    max-width: 640px;
    margin: 80px auto;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  h1 {
    font-size: 24px;
  }
  li {
    margin: 8px 0;
  }
</style>
