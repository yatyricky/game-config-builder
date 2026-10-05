// 导出框架类型（docs/04 §8.1，ADR-7）。生成器是纯函数：IR + 数据 → 文本，禁止读环境。

import type { SchemaIr } from '@gcb/schema';
import type { TypedRow } from '@gcb/validate';

/** 生成产物：path 为相对导出根目录的 posix 路径 */
export interface OutputFile {
  path: string;
  content: string;
}

export interface ExportContext {
  ir: SchemaIr;
  /** 已通过校验的类型化行（键 = 表名） */
  tables: Map<string, TypedRow[]>;
}

export interface TargetPlugin {
  name: string;
  generate(ctx: ExportContext): OutputFile[];
}

export interface ManifestEntry {
  table: string;
  target: string;
  /** 相对导出根目录的 posix 路径 */
  file: string;
  /** 产物内容 sha256（hex） */
  contentHash: string;
  /** 输入指纹：schemaHash + 该表数据指纹（T5.1 增量判断依据） */
  sourceHash: string;
}
