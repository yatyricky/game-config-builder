import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runExportCli } from '../src/main.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));

it('T5.1：增量导出——首次全量；无变更重导 written=0（mtime 保留）', () => {
  const out = join(tmpdir(), `gcb-incr-${Date.now()}`);
  try {
    const first = runExportCli(DEMO, ['json'], out, true);
    expect(first.exitCode).toBe(0);
    expect(first.lines.join('\n')).toContain('写入 5，跳过 0');

    const heroFile = join(out, 'json', 'Hero.json');
    const mtimeBefore = statSync(heroFile).mtimeMs;

    const second = runExportCli(DEMO, ['json'], out, true);
    expect(second.lines.join('\n')).toContain('写入 0，跳过 5');
    expect(statSync(heroFile).mtimeMs).toBe(mtimeBefore);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

it('T5.1：改一表一行 → 仅该表文件重写（其余 mtime 不变）', () => {
  const project = join(tmpdir(), `gcb-incr-proj-${Date.now()}`);
  const out = join(tmpdir(), `gcb-incr-out-${Date.now()}`);
  cpSync(DEMO, project, { recursive: true });
  try {
    expect(runExportCli(project, ['json'], out, true).exitCode).toBe(0);
    const itemFile = join(out, 'json', 'Item.json');
    const heroFile = join(out, 'json', 'Hero.json');
    const itemMtime = statSync(itemFile).mtimeMs;
    const heroMtime = statSync(heroFile).mtimeMs;

    // 改 Material 一行（追加一行数据）
    const materialPath = join(project, 'data', 'Material.jsonl');
    const material = readFileSync(materialPath, 'utf8');
    writeFileSync(materialPath, material + '{"id":2004,"name":"秘银","tier":3}\n', 'utf8');

    const rerun = runExportCli(project, ['json'], out, true);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.lines.join('\n')).toContain('写入 1，跳过 4');
    expect(statSync(itemFile).mtimeMs).toBe(itemMtime); // 未变 → 跳过
    expect(statSync(heroFile).mtimeMs).toBe(heroMtime);
    expect(statSync(join(out, 'json', 'Material.json')).mtimeMs).toBeGreaterThan(heroMtime - 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

void existsSync;
