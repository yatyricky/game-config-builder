import { Command } from 'commander';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSchema, type ValidationError } from '@gcb/schema';
import { loadSchemaDir } from '@gcb/schema/node';

/**
 * gcb CLI（docs/02 §8 约定：exit 0 成功 / 1 校验失败 / 2 用法或内部错误）。
 * runCheckSchema / runCli 可导出供测试进程内调用；直跑入口见文件底部守卫。
 */
export interface CheckSchemaRun {
  exitCode: number;
  lines: string[];
}

/** 相对路径基准：pnpm --filter 会切换 cwd，INIT_CWD 才是调用者的目录 */
function resolveProjectPath(project: string): string {
  if (isAbsolute(project)) return project;
  const base = process.env['INIT_CWD'] ?? process.cwd();
  return join(base, project);
}

export function runCheckSchema(project: string): CheckSchemaRun {
  let loaded;
  const projectDir = resolveProjectPath(project);
  try {
    loaded = loadSchemaDir(join(projectDir, 'schema'));
  } catch (err) {
    return {
      exitCode: 2,
      lines: [
        `无法读取 schema 目录：${join(projectDir, 'schema')}（${err instanceof Error ? err.message : String(err)}）`,
      ],
    };
  }
  const errors: ValidationError[] = [...loaded.errors, ...checkSchema(loaded.ir)];
  if (errors.length === 0) {
    return {
      exitCode: 0,
      lines: [
        `✓ schema 校验通过：` +
          `${Object.keys(loaded.ir.tables).length} 表 / ` +
          `${Object.keys(loaded.ir.structs).length} struct / ` +
          `${Object.keys(loaded.ir.enums).length} enum / ` +
          `${Object.keys(loaded.ir.unions).length} union`,
      ],
    };
  }
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
  lines.push(`共 ${errors.length} 个 schema 错误`);
  return { exitCode: 1, lines };
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
