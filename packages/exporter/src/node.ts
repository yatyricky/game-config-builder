// Node 侧导出执行（@gcb/exporter/node 子路径）：前置全量校验 → 生成 → 原子落盘 + manifest。
// 浏览器代码不得引入本文件。

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

export interface ExportOptions {
  /** T5.1 增量模式：与上次 manifest 对比，sourceHash 未变的文件跳过重写（mtime 保留） */
  incremental?: boolean;
}

export interface ExportRun {
  ok: boolean;
  errors: ValidationError[];
  /** 计划产物总数 */
  files: number;
  /** 本次实际写入数（增量模式下 < files） */
  written: number;
  manifest: ManifestEntry[];
}

/** 导出即编译（§8.1）：error 级校验失败即止、无部分产物（临时目录 + 原子替换） */
export function runExport(
  ir: SchemaIr,
  rawByTable: Map<string, RawRow[]>,
  targets: TargetPlugin[],
  outDir: string,
  options: ExportOptions = {},
): ExportRun {
  const errors = validateFull(ir, rawByTable);
  if (errors.some((e) => e.severity === 'error')) {
    return { ok: false, errors, files: 0, written: 0, manifest: [] };
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

  // 增量：上次 manifest 中 sourceHash 一致且文件仍在磁盘上的条目，直接复制旧文件（保 mtime）
  const previous = new Map<string, string>();
  if (options.incremental === true) {
    const prevManifestPath = join(outDir, 'manifest.json');
    if (existsSync(prevManifestPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(prevManifestPath, 'utf8'));
        if (Array.isArray(parsed)) {
          for (const entry of parsed as Array<{ file?: unknown; sourceHash?: unknown }>) {
            if (typeof entry.file === 'string' && typeof entry.sourceHash === 'string') {
              previous.set(entry.file, entry.sourceHash);
            }
          }
        }
      } catch {
        // manifest 损坏 → 退化为全量
      }
    }
  }

  const tmp = outDir + '.tmp';
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let written = 0;
  const manifestByFile = new Map(manifest.map((m) => [m.file, m]));
  for (const file of plan.files) {
    const target = join(tmp, file.path);
    mkdirSync(dirname(target), { recursive: true });
    const entry = manifestByFile.get(file.path);
    const prevSourceHash = previous.get(file.path);
    const prevFile = outDir + '/' + file.path;
    if (
      options.incremental === true &&
      entry !== undefined &&
      prevSourceHash === entry.sourceHash &&
      existsSync(prevFile)
    ) {
      copyFileSync(prevFile, target);
    } else {
      writeFileSync(target, file.content, 'utf8');
      written++;
    }
  }
  writeFileSync(join(tmp, 'manifest.json'), manifestJson, 'utf8');
  rmSync(outDir, { recursive: true, force: true });
  renameSync(tmp, outDir);
  return { ok: true, errors: [], files: plan.files.length, written, manifest };
}

function tableOfPath(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}
