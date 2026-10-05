// Node 侧目录读取包装器（@gcb/schema/node 子路径导出）。
// 根入口 @gcb/schema 保持同构纯净；浏览器代码不得引入本文件。

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadSchema, type LoadSchemaResult } from './load.js';

/** 读取目录（递归）下全部 .yaml/.yml 文件后调用纯加载器；key 为 posix 风格相对路径 */
export function loadSchemaDir(dir: string): LoadSchemaResult {
  return loadSchema(readYamlFiles(dir, dir));
}

function readYamlFiles(root: string, dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, readYamlFiles(root, full));
    } else if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
      out[toPosix(relative(root, full))] = readFileSync(full, 'utf8');
    }
  }
  return out;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}
