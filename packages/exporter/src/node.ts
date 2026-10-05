// Node 侧导出执行（@gcb/exporter/node 子路径）：前置全量校验 → 生成 → 原子落盘 + manifest。
// 浏览器代码不得引入本文件。

import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SchemaIr, ValidationError } from '@gcb/schema';
import type { RawRow, TypedRow } from '@gcb/validate';
import { typeRows, validateFull } from '@gcb/validate';
import type { ManifestEntry, TargetPlugin } from './plugin.js';
import { buildExportPlan } from './plan.js';

export function localSchemaHash(ir: SchemaIr): string {
  return createHash('sha256').update(JSON.stringify(ir), 'utf8').digest('hex');
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface ExportRun {
  ok: boolean;
  errors: ValidationError[];
  files: number;
  manifest: ManifestEntry[];
}

/** 导出即编译（§8.1）：error 级校验失败即止、无部分产物（临时目录 + 原子替换） */
export function runExport(
  ir: SchemaIr,
  rawByTable: Map<string, RawRow[]>,
  targets: TargetPlugin[],
  outDir: string,
): ExportRun {
  const errors = validateFull(ir, rawByTable);
  if (errors.some((e) => e.severity === 'error')) {
    return { ok: false, errors, files: 0, manifest: [] };
  }
  const tables = new Map<string, TypedRow[]>();
  for (const [name, raw] of rawByTable) {
    const table = ir.tables[name];
    if (table === undefined) continue;
    tables.set(name, typeRows(table, ir, raw).rows);
  }
  const plan = buildExportPlan(ir, tables, targets);
  const schemaHash = localSchemaHash(ir);

  // 数据指纹 = 该表全部产物内容的 hash（产物是 schema+数据的纯函数，T5.1 增量依据）
  const byTable = new Map<string, string[]>();
  for (const file of plan.files) {
    const list = byTable.get(tableOfPath(file.path)) ?? [];
    list.push(file.content);
    byTable.set(tableOfPath(file.path), list);
  }
  const manifest: ManifestEntry[] = plan.entries.map((entry) => {
    const file = plan.files.find((f) => f.path === entry.file);
    const dataFingerprint = sha256((byTable.get(entry.table) ?? []).join('\u0000'));
    return {
      table: entry.table,
      target: entry.target,
      file: entry.file,
      contentHash: sha256(file?.content ?? ''),
      sourceHash: sha256(schemaHash + '\n' + dataFingerprint),
    };
  });
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

  const tmp = outDir + '.tmp';
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const file of plan.files) {
    const target = join(tmp, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
  }
  writeFileSync(join(tmp, 'manifest.json'), manifestJson, 'utf8');
  rmSync(outDir, { recursive: true, force: true });
  renameSync(tmp, outDir);
  return { ok: true, errors: [], files: plan.files.length, manifest };
}

function tableOfPath(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}
