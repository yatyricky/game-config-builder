// e2e 专用：复制 demo 到临时目录后启动 server（保护共享 examples/demo 不被 e2e 写脏）
import { cpSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const project = mkdtempSync(join(tmpdir(), 'gcb-e2e-'));
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
cpSync(join(repoRoot, 'examples/demo'), join(project, 'demo'), { recursive: true });
const result = spawnSync('pnpm', ['--filter', '@gcb/server', 'exec', 'tsx', 'src/index.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, GCB_PROJECT: join(project, 'demo'), PORT: '8787' },
});
rmSync(project, { recursive: true, force: true });
process.exit(result.status ?? 1);
