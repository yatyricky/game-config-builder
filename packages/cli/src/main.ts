import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSchema, type SchemaIr, type ValidationError } from '@gcb/schema';
import { loadSchemaDir } from '@gcb/schema/node';
import {
  loadTable,
  normalizedContent,
  parseJsonl,
  reindex,
  runMigrations,
  writeTableNormalized,
} from '@gcb/data';
import { csharpTarget, jsonTarget, luaTarget, runExport } from '@gcb/exporter';
import type { RawRow } from '@gcb/validate';

/**
 * gcb CLI（docs/02 §8 约定：exit 0 成功 / 1 校验失败 / 2 用法或内部错误）。
 * runCheckSchema / runValidate / runCli 可导出供测试进程内调用；直跑入口见文件底部守卫。
 */
export interface CommandRun {
  exitCode: number;
  lines: string[];
  errors: ValidationError[];
}

/** 相对路径基准：pnpm --filter 会切换 cwd，INIT_CWD 才是调用者的目录 */
function resolveProjectPath(project: string): string {
  if (isAbsolute(project)) return project;
  const base = process.env['INIT_CWD'] ?? process.cwd();
  return join(base, project);
}

function projectDirs(project: string): { schemaDir: string; dataDir: string } {
  const root = resolveProjectPath(project);
  return { schemaDir: join(root, 'schema'), dataDir: join(root, 'data') };
}

function groupByFile(errors: ValidationError[]): string[] {
  const lines: string[] = [];
  const byFile = new Map<string, ValidationError[]>();
  for (const e of errors) {
    const list = byFile.get(e.table) ?? [];
    list.push(e);
    byFile.set(e.table, list);
  }
  for (const [file, list] of byFile) {
    lines.push(`${file}:`);
    for (const e of list) {
      lines.push(`  [${e.ruleId}] ${e.message}`);
    }
  }
  return lines;
}

function loadProjectSchema(schemaDir: string): {
  ir?: SchemaIr;
  errors: ValidationError[];
  ioError?: string;
} {
  try {
    const loaded = loadSchemaDir(schemaDir);
    return { ir: loaded.ir, errors: loaded.errors };
  } catch (err) {
    return { errors: [], ioError: err instanceof Error ? err.message : String(err) };
  }
}

export function runCheckSchema(project: string): CommandRun {
  const { schemaDir } = projectDirs(project);
  const loaded = loadProjectSchema(schemaDir);
  if (loaded.ioError !== undefined) {
    return {
      exitCode: 2,
      lines: [`无法读取 schema 目录：${schemaDir}（${loaded.ioError}）`],
      errors: [],
    };
  }
  const errors: ValidationError[] = [...loaded.errors, ...checkSchema(loaded.ir as SchemaIr)];
  if (errors.length === 0) {
    const ir = loaded.ir as SchemaIr;
    return {
      exitCode: 0,
      errors: [],
      lines: [
        `✓ schema 校验通过：` +
          `${Object.keys(ir.tables).length} 表 / ` +
          `${Object.keys(ir.structs).length} struct / ` +
          `${Object.keys(ir.enums).length} enum / ` +
          `${Object.keys(ir.unions).length} union`,
      ],
    };
  }
  const lines = groupByFile(errors);
  lines.push(`共 ${errors.length} 个 schema 错误`);
  return { exitCode: 1, lines, errors };
}

export function runValidate(project: string, fix: boolean): CommandRun {
  const { schemaDir, dataDir } = projectDirs(project);
  const loaded = loadProjectSchema(schemaDir);
  if (loaded.ioError !== undefined) {
    return {
      exitCode: 2,
      lines: [`无法读取 schema 目录：${schemaDir}（${loaded.ioError}）`],
      errors: [],
    };
  }
  const ir = loaded.ir as SchemaIr;
  const errors: ValidationError[] = [...loaded.errors, ...checkSchema(ir)];
  if (errors.length > 0) {
    const lines = groupByFile(errors);
    lines.push(`schema 校验失败，共 ${errors.length} 个错误（§5.1：schema 域失败即止）`);
    return { exitCode: 1, lines, errors };
  }

  const lines: string[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let rewritten = 0;
  const tableNames = Object.keys(ir.tables).sort();
  for (const name of tableNames) {
    const table = ir.tables[name];
    if (table === undefined) continue;
    const data = loadTable(ir, table, dataDir);
    if (fix) {
      const content = normalizedContent(ir, table, data.rows);
      if (content !== data.raw) {
        writeTableNormalized(dataDir, table.name, content);
        rewritten++;
      }
    }
    if (data.errors.length > 0) {
      lines.push(`${table.name}（${data.rows.length} 行）:`);
      for (const e of data.errors) {
        lines.push(`  [${e.ruleId}] ${e.message}`);
        if (e.severity === 'warning') warningCount++;
        else errorCount++;
      }
    }
    errors.push(...data.errors);
  }
  if (errorCount === 0 && warningCount === 0) {
    lines.push(`✓ 数据校验通过：${tableNames.length} 表，0 错误 0 警告`);
  } else {
    lines.push(`共 ${errorCount} 个错误 / ${warningCount} 个警告（${tableNames.length} 表）`);
  }
  if (fix) {
    lines.push(`--fix：已规范化重写 ${rewritten} 张表`);
  }
  return { exitCode: errorCount > 0 ? 1 : 0, lines, errors };
}

export function runReindex(project: string): CommandRun {
  const { schemaDir } = projectDirs(project);
  const loaded = loadProjectSchema(schemaDir);
  if (loaded.ioError !== undefined) {
    return {
      exitCode: 2,
      lines: [`无法读取 schema 目录：${schemaDir}（${loaded.ioError}）`],
      errors: [],
    };
  }
  const schemaErrors = [...loaded.errors, ...checkSchema(loaded.ir as SchemaIr)];
  if (schemaErrors.length > 0) {
    return { exitCode: 1, lines: groupByFile(schemaErrors), errors: schemaErrors };
  }
  try {
    const result = reindex(loaded.ir as SchemaIr, resolveProjectPath(project));
    return {
      exitCode: 0,
      lines: [`✓ 索引已重建：${result.tables} 表 / ${result.rows} 行 / ${result.edges} 条引用边`],
      errors: [],
    };
  } catch (err) {
    return {
      exitCode: 2,
      lines: [`索引重建失败：${err instanceof Error ? err.message : String(err)}`],
      errors: [],
    };
  }
}

export function runExportCli(
  project: string,
  targetNames: string[],
  outDirOverride: string | undefined,
  incremental = false,
): CommandRun {
  const dirs = projectDirs(project);
  const outDir =
    outDirOverride !== undefined
      ? resolveProjectPath(outDirOverride)
      : join(resolveProjectPath(project), 'export');
  const loaded = loadProjectSchema(dirs.schemaDir);
  if (loaded.ioError !== undefined) {
    return {
      exitCode: 2,
      lines: [`无法读取 schema 目录：${dirs.schemaDir}（${loaded.ioError}）`],
      errors: [],
    };
  }
  const ir = loaded.ir as SchemaIr;
  const schemaErrors = [...loaded.errors, ...checkSchema(ir)];
  if (schemaErrors.length > 0) {
    return { exitCode: 1, lines: groupByFile(schemaErrors), errors: schemaErrors };
  }
  const targets = targetNames.map((name) => {
    if (name === 'json') return jsonTarget;
    if (name === 'lua') return luaTarget;
    if (name === 'csharp') return csharpTarget({ namespace: 'GameConfig' });
    return null;
  });
  const unknown = targetNames.filter((n) => n !== 'json' && n !== 'lua' && n !== 'csharp');
  if (unknown.length > 0) {
    return {
      exitCode: 2,
      lines: [`未知 target：${unknown.join(', ')}（可用：json,lua,csharp）`],
      errors: [],
    };
  }
  const rawByTable = new Map<string, RawRow[]>();
  for (const name of Object.keys(ir.tables)) {
    const table = ir.tables[name];
    if (table === undefined) continue;
    rawByTable.set(name, readRawRows(join(dirs.dataDir, `${name}.jsonl`), name));
  }
  try {
    const result = runExport(
      ir,
      rawByTable,
      targets.filter((t) => t !== null),
      outDir,
      { incremental },
    );
    if (!result.ok) {
      const lines = groupByFile(result.errors);
      lines.push(
        `导出中止：共 ${result.errors.filter((e) => e.severity === 'error').length} 个错误（导出即编译，§8.1）`,
      );
      return { exitCode: 1, lines, errors: result.errors };
    }
    return {
      exitCode: 0,
      lines: [
        `✓ 导出完成：${result.files} 个文件（写入 ${result.written}，跳过 ${result.files - result.written}）→ ${outDir}`,
      ],
      errors: [],
    };
  } catch (err) {
    return {
      exitCode: 2,
      lines: [`导出失败：${err instanceof Error ? err.message : String(err)}`],
      errors: [],
    };
  }
}

function readRawRows(file: string, tableName: string): RawRow[] {
  if (!existsSync(file)) return [];
  return parseJsonl(tableName, readFileSync(file, 'utf8')).rows;
}

export interface DiffReport extends CommandRun {
  report: string;
}

/** T5.2 导出 diff：两份导出目录的行级/字段级差异 → Markdown 报告（§8.5） */
export function runDiff(oldDir: string, newDir: string): DiffReport {
  const oldResolved = resolveProjectPath(oldDir);
  const newResolved = resolveProjectPath(newDir);
  const oldManifest = readManifest(oldResolved);
  const newManifest = readManifest(newResolved);
  if (oldManifest === null || newManifest === null) {
    return {
      exitCode: 2,
      lines: ['无法读取 manifest.json（请先运行 gcb export）'],
      errors: [],
      report: '',
    };
  }
  const tables = [...new Set([...oldManifest.keys(), ...newManifest.keys()])].sort();
  const lines: string[] = ['# 导出 diff 报告', ''];
  let changes = 0;
  for (const table of tables) {
    const oldJsonPath = join(oldResolved, jsonPathOf(oldManifest, table));
    const newJsonPath = join(newResolved, jsonPathOf(newManifest, table));
    const oldRows = readRows(oldJsonPath);
    const newRows = readRows(newJsonPath);
    const added = [...newRows.keys()].filter((k) => !oldRows.has(k)).sort(sortPk);
    const removed = [...oldRows.keys()].filter((k) => !newRows.has(k)).sort(sortPk);
    const changed = [...newRows.keys()]
      .filter(
        (k) => oldRows.has(k) && JSON.stringify(oldRows.get(k)) !== JSON.stringify(newRows.get(k)),
      )
      .sort(sortPk);
    if (added.length === 0 && removed.length === 0 && changed.length === 0) continue;
    lines.push('## ' + table);
    for (const pk of added) {
      lines.push('- 新增：#' + pk);
      changes++;
    }
    for (const pk of removed) {
      lines.push('- 删除：#' + pk);
      changes++;
    }
    for (const pk of changed) {
      changes++;
      const oldRow = oldRows.get(pk) ?? {};
      const newRow = newRows.get(pk) ?? {};
      const fields = [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])].sort();
      const diffs = fields
        .filter((f) => JSON.stringify(oldRow[f]) !== JSON.stringify(newRow[f]))
        .map((f) => f + ': ' + previewValue(oldRow[f]) + ' → ' + previewValue(newRow[f]));
      lines.push('- 变更 #' + pk + (diffs.length > 0 ? '：' + diffs.join('；') : ''));
    }
    lines.push('');
  }
  if (changes === 0) lines.push('无变更');
  else lines.unshift('', '共 ' + changes + ' 处行级变更', '');
  return { exitCode: 0, lines, errors: [], report: lines.join('\n') + '\n' };
}

function previewValue(v: unknown): string {
  const s = JSON.stringify(v) ?? 'undefined';
  return s.length > 50 ? s.slice(0, 47) + '...' : s;
}

function sortPk(a: string, b: string): number {
  if (a === b) return 0;
  if (/^-?d+$/.test(a) && /^-?d+$/.test(b)) return Number(a) - Number(b);
  return a < b ? -1 : 1;
}

function readManifest(dir: string): Map<string, string> | null {
  const p = join(dir, 'manifest.json');
  if (!existsSync(p)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
    const map = new Map<string, string>();
    if (Array.isArray(parsed)) {
      for (const e of parsed as Array<{ table?: unknown; file?: unknown }>) {
        if (typeof e.table === 'string' && typeof e.file === 'string') map.set(e.table, e.file);
      }
    }
    return map;
  } catch {
    return null;
  }
}

function jsonPathOf(manifest: Map<string, string>, table: string): string {
  return manifest.get(table) ?? 'json/' + table + '.json';
}

function readRows(path: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!existsSync(path)) return map;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const rows = (parsed as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      for (const row of rows as Array<Record<string, unknown>>) {
        const pk = row['id'] ?? row['key'];
        if (pk !== undefined) map.set(String(pk), row);
      }
    }
  } catch {
    // 损坏文件 → 空表
  }
  return map;
}

/** T5.3 迁移：显式迁移文件 → 数据键重写/类型转换 → normalize + reindex（§10） */
export function runMigrateCli(project: string): CommandRun {
  const dirs = projectDirs(project);
  const loaded = loadProjectSchema(dirs.schemaDir);
  if (loaded.ioError !== undefined) {
    return {
      exitCode: 2,
      lines: [`无法读取 schema 目录：${dirs.schemaDir}（${loaded.ioError}）`],
      errors: [],
    };
  }
  const ir = loaded.ir as SchemaIr;
  const schemaErrors = [...loaded.errors, ...checkSchema(ir)];
  if (schemaErrors.length > 0) {
    return {
      exitCode: 1,
      lines: [...groupByFile(schemaErrors), 'schema 校验失败，先修正 schema 再迁移'],
      errors: schemaErrors,
    };
  }
  try {
    const result = runMigrations(ir, resolveProjectPath(project));
    return { exitCode: result.exitCode, lines: result.lines, errors: result.errors };
  } catch (err) {
    return {
      exitCode: 2,
      lines: [`迁移失败：${err instanceof Error ? err.message : String(err)}`],
      errors: [],
    };
  }
}

/** T5.4 init：最小可用模板（2 表 schema + 数据），init 后三连命令可直接通过 */
export function runInit(dest: string): CommandRun {
  const target = resolveProjectPath(dest);
  if (existsSync(join(target, 'schema'))) {
    return { exitCode: 2, lines: [`目标目录已存在 schema/：${target}（拒绝覆盖）`], errors: [] };
  }
  const files: Array<[string, string]> = [
    [
      'schema/main.yaml',
      [
        'enums:',
        '  Rarity:',
        '    comment: 稀有度',
        '    values:',
        '      - { name: Common, value: 0 }',
        '      - { name: Rare, value: 1 }',
        'tables:',
        '  Item:',
        '    comment: 物品表（示例）',
        '    primaryKey: id',
        '    displayField: name',
        '    fields:',
        '      - { name: id, type: int, range: [1, 999999] }',
        '      - { name: name, type: string, maxLength: 64 }',
        '      - { name: rarity, type: "enum<Rarity>", default: Common }',
        '      - { name: price, type: int, default: 0, rule: "price >= 0" }',
        '',
      ].join('\n'),
    ],
    [
      'data/Item.jsonl',
      ['{"id":1,"name":"木剑"}', '{"id":2,"name":"铁剑","rarity":"Rare","price":100}', ''].join(
        '\n',
      ),
    ],
    [
      'README.md',
      [
        '# 配置项目',
        '',
        '常用命令：',
        '',
        '```',
        'gcb check-schema .',
        'gcb validate .',
        'gcb export . --target json,lua,csharp',
        '```',
        '',
      ].join('\n'),
    ],
  ];
  try {
    for (const [rel, content] of files) {
      const path = join(target, rel);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content, 'utf8');
    }
    return {
      exitCode: 0,
      lines: [`✓ 已初始化配置项目：${target}（2 表模板：enum + 主档表 + 规则）`],
      errors: [],
    };
  } catch (err) {
    return {
      exitCode: 2,
      lines: [`init 失败：${err instanceof Error ? err.message : String(err)}`],
      errors: [],
    };
  }
}

export async function runCli(argv: string[]): Promise<number> {
  let lastExit = 0;
  // 兼容 `pnpm cli -- check-schema ...`：pnpm 11 会把首个 `--` 原样转发
  const cleanArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const program = new Command();
  program.name('gcb').description('game-config-builder 配置工具链').version('0.0.0');

  program
    .command('check-schema')
    .description('加载并校验配置项目的 schema 目录')
    .argument('<project>', '配置项目根目录（含 schema/ 子目录）')
    .action((project: string) => {
      const run = runCheckSchema(project);
      for (const line of run.lines) console.log(line);
      lastExit = run.exitCode;
    });

  program
    .command('reindex')
    .description('重建 SQLite 派生索引（gcb.db，可随时删除）')
    .argument('<project>', '配置项目根目录')
    .action((project: string) => {
      const run = runReindex(project);
      for (const line of run.lines) console.log(line);
      lastExit = run.exitCode;
    });

  program
    .command('validate')
    .description('校验配置项目（schema + 数据）')
    .argument('<project>', '配置项目根目录')
    .option('--fix', '自动修复可修复项（行序规范化）')
    .action((project: string, options: { fix?: boolean }) => {
      const run = runValidate(project, options.fix === true);
      for (const line of run.lines) console.log(line);
      lastExit = run.exitCode;
    });

  program
    .command('export')
    .description('导出（导出即编译：全量校验通过才产出）')
    .argument('<project>', '配置项目根目录')
    .option('--target <targets>', '逗号分隔：json,lua,csharp', 'json,lua,csharp')
    .option('--out <dir>', '导出根目录（缺省 <project>/export）')
    .option('--incremental', '增量模式：sourceHash 未变的文件跳过重写')
    .action(
      (project: string, options: { target?: string; out?: string; incremental?: boolean }) => {
        const targets = (options.target ?? 'json,lua,csharp').split(',').map((s) => s.trim());
        const run = runExportCli(project, targets, options.out, options.incremental === true);
        for (const line of run.lines) console.log(line);
        lastExit = run.exitCode;
      },
    );

  program
    .command('diff')
    .description('对比两份导出目录，输出行级/字段级 Markdown 报告（§8.5）')
    .argument('<oldDir>', '基线导出目录')
    .argument('<newDir>', '新导出目录')
    .action((oldDir: string, newDir: string) => {
      const run = runDiff(oldDir, newDir);
      for (const line of run.lines) console.log(line);
      lastExit = run.exitCode;
    });

  program
    .command('migrate')
    .description('应用显式迁移（rename-field / retype-field，§10）')
    .argument('<project>', '配置项目根目录')
    .action((project: string) => {
      const run = runMigrateCli(project);
      for (const line of run.lines) console.log(line);
      lastExit = run.exitCode;
    });

  program
    .command('init')
    .description('初始化最小可用配置项目模板')
    .argument('<dir>', '目标目录')
    .action((dir: string) => {
      const run = runInit(dir);
      for (const line of run.lines) console.log(line);
      lastExit = run.exitCode;
    });

  await program.parseAsync(cleanArgv, { from: 'user' });
  return lastExit;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
