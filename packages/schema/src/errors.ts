import type { Severity } from './ir.js';

/** docs/04 §5.3 错误模型 —— 全 workspace 共用的结构化校验错误 */
export interface ValidationError {
  /** 表名；schema 域错误为 schema 文件相对路径 */
  table: string;
  /** 主键规范字符串（int → 十进制字符串）；无行上下文为空串 */
  rowKey: string;
  /** 字段点号路径（如 'rewards.1.count'）；表级为空串 */
  fieldPath: string;
  /** 稳定规则标识，如 'schema.yaml-parse' 或 'rule.row:price-quality' */
  ruleId: string;
  severity: Severity;
  /** 面向策划的中文消息，含定位与期望值 */
  message: string;
}

/** schema 域错误的便捷构造（table = 文件路径，无行上下文） */
export function schemaError(file: string, ruleId: string, message: string): ValidationError {
  return { table: file, rowKey: '', fieldPath: '', ruleId, severity: 'error', message };
}
