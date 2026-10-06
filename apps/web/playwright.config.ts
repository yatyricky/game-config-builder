import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    viewport: { width: 1720, height: 960 },
  },
  webServer: [
    {
      command: 'pnpm dev --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      // gcb server 服务 demo 项目（cwd = apps/web → 指向仓库根 examples/demo）
      command: 'node ../../scripts/dev-server-e2e.mjs',
      url: 'http://127.0.0.1:8787/healthz',
      reuseExistingServer: true,
      timeout: 30_000,
      env: { PORT: '8787' },
    },
  ],
});
