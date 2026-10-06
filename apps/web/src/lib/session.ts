// 编辑器会话数据层（M8-M10）：全量加载项目 → 本地编辑 → 同构校验 → 单行 PUT 保存。
// demo/游戏配置规模（10²–10⁵ 行）全量驻内存是 docs/02 §6.1 的设计。

import { parseTypeString } from '@gcb/schema';
import type { SchemaIr, TableDef, TypeAst, ValidationError } from '@gcb/schema';
import { validateFull, validateIncremental, type ChangeSet, type TypedRow } from '@gcb/validate';
import type { RawRow } from '@gcb/validate';

export interface EditorRow {
  pk: string;
  /** 规范化后的行对象（与 server 一致） */
  row: Record<string, unknown>;
  /** 当前内容的哈希（与 server 侧 canonicalJSON+sha256 对齐——由 server 计算返回） */
  rowHash: string;
  /** 相对加载基线的 dirty 标记 */
  dirty: boolean;
}

export interface TableSession {
  name: string;
  table: TableDef;
  columns: Array<{ name: string; type: string; ast: TypeAst }>;
  rows: EditorRow[];
}

export interface ProjectSession {
  ir: SchemaIr;
  tables: Map<string, TableSession>;
}

/** 解析原始输入 → 类型化值（返回错误消息或 null=成功） */
export function parseCellInput(
  ast: TypeAst,
  ir: SchemaIr,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  switch (ast.kind) {
    case 'primitive':
      if (ast.name === 'bool') {
        if (trimmed === 'true') return { ok: true, value: true };
        if (trimmed === 'false') return { ok: true, value: false };
        return { ok: false, error: '需要 true/false' };
      }
      if (ast.name === 'int') {
        const n = Number(trimmed);
        if (!/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(n))
          return { ok: false, error: '需要整数' };
        return { ok: true, value: n };
      }
      if (ast.name === 'float') {
        const n = Number(trimmed);
        if (trimmed === '' || !Number.isFinite(n)) return { ok: false, error: '需要数值' };
        return { ok: true, value: n };
      }
      return { ok: true, value: trimmed }; // string/text
    case 'enum': {
      const enumDef = ir.enums[ast.enumName];
      if (enumDef !== undefined && enumDef.values.some((v) => v.name === trimmed)) {
        return { ok: true, value: trimmed };
      }
      return { ok: false, error: `不是枚举 ${ast.enumName} 的成员` };
    }
    case 'ref': {
      const target = ir.tables[ast.tableName];
      if (target === undefined) return { ok: false, error: `未知表 ${ast.tableName}` };
      const pkName = target.primaryKey;
      const pkField = target.fields.find((f) => f.name === pkName);
      if (pkField === undefined) return { ok: true, value: trimmed };
      const parsed = parseTypeString(pkField.type);
      if (parsed.ok && parsed.ast.kind === 'primitive' && parsed.ast.name === 'int') {
        const n = Number(trimmed);
        if (!/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(n))
          return { ok: false, error: `需要 ${ast.tableName} 的整数主键` };
        return { ok: true, value: n };
      }
      return { ok: true, value: trimmed };
    }
    default:
      return { ok: false, error: '该列暂不支持内联编辑（struct/list/map/union）' };
  }
}

/** 单元格显示文本（FK 列由 UI 层解析 chip；此处标量直出） */
export function cellText(ast: TypeAst, value: unknown): string {
  if (value === undefined || value === null) return '';
  switch (ast.kind) {
    case 'primitive':
      if (ast.name === 'bool') return value ? 'true' : 'false';
      return String(value);
    case 'enum':
    case 'ref':
      return String(value);
    case 'list':
      return `列表(${(value as unknown[]).length})`;
    case 'map':
      return `映射(${Object.keys(value as object).length})`;
    case 'struct':
      return 'struct';
    case 'union': {
      const tag = Object.entries(value as Record<string, unknown>).find(([k]) => k !== 'value');
      return tag !== undefined ? String(tag[1]) : 'union';
    }
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

interface RowsResponse {
  total: number;
  columns: string[];
  displayField: string;
  rows: Array<{ pk: string; rowHash: string; cells: unknown[] }>;
}

/** 加载全部表（demo 规模全量） */
export async function loadProjectSession(): Promise<ProjectSession> {
  const { ir } = await fetchJson<{ ir: SchemaIr; errors: ValidationError[] }>('/api/schema');
  const tables = new Map<string, TableSession>();
  for (const [name, table] of Object.entries(ir.tables)) {
    if (table === undefined) continue;
    const data = await fetchJson<RowsResponse>(`/api/tables/${name}/rows?limit=100000`);
    const columns = table.fields.map((f) => {
      const parsed = parseTypeString(f.type);
      return {
        name: f.name,
        type: f.type,
        ast: parsed.ok ? parsed.ast : ({ kind: 'primitive', name: 'string' } as TypeAst),
      };
    });
    const rows: EditorRow[] = data.rows.map((r) => ({
      pk: r.pk,
      row: Object.fromEntries(table.fields.map((f, i) => [f.name, r.cells[i]])),
      rowHash: r.rowHash,
      dirty: false,
    }));
    tables.set(name, { name, table, columns, rows });
  }
  return { ir, tables };
}

export interface ValidationResult {
  errors: ValidationError[];
  /** `${rowKey}|${fieldPath}` → 最严重的 severity */
  byCell: Map<string, 'error' | 'warning'>;
}

// 调试暴露（浏览器 console 手动复现用；无副作用）
export function exposeForDebug(session: ProjectSession): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)['__gcb'] = {
    validateIncremental,
    validateFull,
    session,
  };
}

/** 全量校验（加载后首跑） */
export function validateSessionAll(session: ProjectSession): ValidationResult {
  const rawByTable = new Map<string, RawRow[]>();
  for (const [name, ts] of session.tables) {
    rawByTable.set(
      name,
      ts.rows.map((r, i) => ({ json: r.row, line: i + 1 })),
    );
  }
  const errors = validateFull(session.ir, rawByTable);
  return toResult(errors);
}

export function toResult(errors: ValidationError[]): ValidationResult {
  const byCell = new Map<string, 'error' | 'warning'>();
  for (const e of errors) {
    const key = `${e.rowKey}|${e.fieldPath}`;
    const prev = byCell.get(key);
    if (prev !== 'error') byCell.set(key, e.severity);
  }
  return { errors, byCell };
}

/** 增量校验（编辑后）：返回受影响单元格的标记集 */
export function validateSessionIncremental(
  session: ProjectSession,
  changed: ChangeSet,
): ValidationResult {
  const tables = new Map<string, TypedRow[]>();
  for (const [name, ts] of session.tables) {
    tables.set(
      name,
      ts.rows.map((r) => ({ pk: r.pk, row: r.row as never, line: 0 })),
    );
  }
  const errors = validateIncremental(session.ir, tables, [changed]);
  console.log(
    '[dbg-sess] changed=',
    JSON.stringify(changed),
    'itemPrice=',
    JSON.stringify(
      (tables.get('Item')?.find((r) => r.pk === '1001')?.row as Record<string, unknown>)?.['price'],
    ),
    'errors=',
    errors.length,
  );
  return toResult(errors);
}

/** 保存单行：PUT + 哈希护栏；409 时刷新该行 */
export async function saveRow(
  tableName: string,
  editorRow: EditorRow,
): Promise<{ ok: true } | { ok: false; conflict?: boolean; errors: ValidationError[] }> {
  const res = await fetch(`/api/tables/${tableName}/rows/${editorRow.pk}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ row: editorRow.row, baseRowHash: editorRow.rowHash }),
  });
  if (res.status === 200) {
    const body = (await res.json()) as { rowHash: string };
    editorRow.rowHash = body.rowHash;
    editorRow.dirty = false;
    return { ok: true };
  }
  if (res.status === 409) {
    const body = (await res.json()) as {
      currentRow: Record<string, unknown>;
      currentRowHash: string;
    };
    editorRow.row = body.currentRow;
    editorRow.rowHash = body.currentRowHash;
    editorRow.dirty = false;
    return { ok: false, conflict: true, errors: [] };
  }
  const body = (await res.json()) as { errors: ValidationError[] };
  return { ok: false, errors: body.errors };
}

/** 删除行：先问 server（422 = 被引用）；成功后从本地会话移除 */
export async function deleteRow(
  session: ProjectSession,
  tableName: string,
  pk: string,
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason?: string;
      backrefs: Array<{ fromTable: string; fromPk: string; fromField: string }>;
    }
> {
  const res = await fetch(`/api/tables/${tableName}/rows/${pk}`, { method: 'DELETE' });
  if (res.status === 200) {
    const ts = session.tables.get(tableName);
    if (ts !== undefined) {
      const idx = ts.rows.findIndex((r) => r.pk === pk);
      if (idx >= 0) ts.rows.splice(idx, 1);
    }
    return { ok: true };
  }
  if (res.status === 422) {
    const body = (await res.json()) as {
      reason: string;
      backrefs: Array<{ fromTable: string; fromPk: string; fromField: string }>;
    };
    return { ok: false, reason: body.reason, backrefs: body.backrefs };
  }
  return { ok: false, backrefs: [] };
}

/** xlsx 文件 → 行对象数组（列名 = schema 字段名；T7.5/M11 导入桥接） */
export async function importXlsx(
  session: ProjectSession,
  tableName: string,
  file: File,
): Promise<{ rows: Array<Record<string, unknown>>; unmatched: string[] }> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer);
  const sheetName = wb.SheetNames[0];
  if (sheetName === undefined) return { rows: [], unmatched: [] };
  const sheet = wb.Sheets[sheetName];
  if (sheet === undefined) return { rows: [], unmatched: [] };
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: undefined });
  const table = session.tables.get(tableName)?.table;
  const fieldNames = new Set((table?.fields ?? []).map((f) => f.name));
  const unmatched = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const item of json) {
    const out: Record<string, unknown> = {};
    let hasAny = false;
    for (const [key, value] of Object.entries(item)) {
      if (fieldNames.has(key)) {
        out[key] = value;
        hasAny = true;
      } else {
        unmatched.add(key);
      }
    }
    if (hasAny) rows.push(out);
  }
  return { rows, unmatched: [...unmatched] };
}
