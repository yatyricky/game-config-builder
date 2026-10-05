// 以 UPDATE_GOLDENS=1 环境变量运行 vitest（跨平台，替代行为异常的 cross-env）
import { spawnSync } from 'node:child_process';

const result = spawnSync('vitest', ['run'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, UPDATE_GOLDENS: '1' },
});

process.exit(result.status ?? 1);
