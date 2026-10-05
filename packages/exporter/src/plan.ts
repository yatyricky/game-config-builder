// 导出计划（纯）：前置校验由 node 侧 runExport 负责；此处只做确定性生成与清单装配（T4.1）

import type { SchemaIr } from '@gcb/schema';
import type { TypedRow } from '@gcb/validate';
import type { OutputFile, TargetPlugin } from './plugin.js';

export interface PlanEntry {
  table: string;
  target: string;
  file: string;
}

export interface ExportPlan {
  files: OutputFile[];
  entries: PlanEntry[];
}

export function buildExportPlan(
  ir: SchemaIr,
  tables: Map<string, TypedRow[]>,
  targets: TargetPlugin[],
): ExportPlan {
  const ctx = { ir, tables };
  const files: OutputFile[] = [];
  const entries: PlanEntry[] = [];
  for (const target of targets) {
    for (const file of target.generate(ctx)) {
      files.push(file);
      entries.push({ table: tableOfPath(file.path), target: target.name, file: file.path });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { files, entries };
}

function tableOfPath(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}
