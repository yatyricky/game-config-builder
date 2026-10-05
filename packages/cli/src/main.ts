import { Command } from 'commander';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSchema, type SchemaIr, type ValidationError } from '@gcb/schema';
import { loadSchemaDir } from '@gcb/schema/node';
import { loadTable, normalizedContent, writeTableNormalized } from '@gcb/data';

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
    .command('validate')
    .description('校验配置项目（schema + 数据）')
    .argument('<project>', '配置项目根目录')
    .option('--fix', '自动修复可修复项（行序规范化）')
    .action((project: string, options: { fix?: boolean }) => {
      const run = runValidate(project, options.fix === true);
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
