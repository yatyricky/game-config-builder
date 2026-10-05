// Schema IR —— 纯数据类型（docs/04 §2.2/§3 契约）。
// 禁止在此引入运行时状态或解析逻辑（解析属 T1.3，自检属 T1.4）。

export type Severity = 'error' | 'warning';

/** schema 定义在源文件中的位置（加载器填充；§2.3 错误定位依赖） */
export interface SourceRef {
  /** 相对 schema 目录的 posix 风格路径，如 'types.yaml' */
  file: string;
  /** 1-based 行号 */
  line: number;
}

// ---------- §3.1 类型字符串 AST ----------

export type PrimitiveTypeName = 'bool' | 'int' | 'float' | 'string' | 'text';
export type MapKeyTypeName = 'int' | 'string';

export interface PrimitiveTypeAst {
  kind: 'primitive';
  name: PrimitiveTypeName;
}

export interface EnumTypeAst {
  kind: 'enum';
  /** 枚举类型名；存在性由 checkSchema 校验 */
  enumName: string;
}

export interface StructTypeAst {
  kind: 'struct';
  structName: string;
}

export interface RefTypeAst {
  kind: 'ref';
  /** 被引用表名；必须指向 table（checkSchema 校验） */
  tableName: string;
}

export interface UnionTypeAst {
  kind: 'union';
  unionName: string;
}

export interface ListTypeAst {
  kind: 'list';
  /** 深度约束（元素不得再为 list/map）由解析/自检层校验，AST 保持语法形态 */
  element: TypeAst;
}

export interface MapTypeAst {
  kind: 'map';
  key: MapKeyTypeName;
  element: TypeAst;
}

/** §3.1 类型字符串文法的判别联合（语法形态） */
export type TypeAst =
  | PrimitiveTypeAst
  | EnumTypeAst
  | StructTypeAst
  | RefTypeAst
  | UnionTypeAst
  | ListTypeAst
  | MapTypeAst;

// ---------- §2.2 定义块 ----------

/** 字段默认值字面量：标量或（struct 默认值的）嵌套对象；list/map 用隐式空集合，不在此声明 */
export type LiteralValue = string | number | boolean | { [key: string]: LiteralValue };

export interface EnumValueDef {
  /** PascalCase，enum 内唯一 */
  name: string;
  /** int，enum 内唯一 */
  value: number;
}

export interface EnumDef {
  kind: 'enum';
  name: string;
  comment?: string;
  values: EnumValueDef[];
  source?: SourceRef;
}

export interface FieldDef {
  /** camelCase，表/struct 内唯一；保留字 'value' 禁用 */
  name: string;
  /** §3.1 类型字符串原始形态（解析产物见 TypeAst） */
  type: string;
  /** 标量/struct 的默认值；缺失且无默认 = required.missing（§3.2） */
  default?: LiteralValue;
  comment?: string;
  /** int/float 闭区间 [min, max] */
  range?: [number, number];
  /** string/text 最大长度 */
  maxLength?: number;
  /** 跨行唯一；仅表顶层字段合法，struct 内出现由 checkSchema 报错 */
  unique?: boolean;
  /** 单字段 DSL 表达式（§4.4），error 级 */
  rule?: string;
  source?: SourceRef;
}

export interface StructDef {
  kind: 'struct';
  name: string;
  comment?: string;
  fields: FieldDef[];
  source?: SourceRef;
}

export interface UnionVariantDef {
  /** PascalCase，union 内唯一 */
  name: string;
  /** 指向的 struct 名；存在性由 checkSchema 校验 */
  struct: string;
}

export interface UnionDef {
  kind: 'union';
  name: string;
  comment?: string;
  /** 判别字段名（camelCase），用于 JSON/Lua/C# 多态编码（§3.2） */
  tag: string;
  variants: UnionVariantDef[];
  source?: SourceRef;
}

export interface RowRuleDef {
  /** kebab-case 规则标识（进错误对象） */
  id: string;
  /** DSL 表达式，求值必须为 bool；false = 违规 */
  rule: string;
  /** 缺省 error */
  severity?: Severity;
  /** 违规消息模板，支持 {字段名} 占位 */
  message?: string;
}

export interface TableDef {
  kind: 'table';
  name: string;
  comment?: string;
  /** 必须指向本表 int/string 字段（checkSchema 校验） */
  primaryKey: string;
  /** 摘要展示字段：FK chip、下拉、peek 标题（§2.2） */
  displayField: string;
  fields: FieldDef[];
  rowRules?: RowRuleDef[];
  source?: SourceRef;
}

/** 类型命名空间实体（§1：enum/struct/union/table 共用一个命名空间，名字全局唯一） */
export type TypeDef = EnumDef | StructDef | UnionDef | TableDef;

export interface SchemaIr {
  enums: Record<string, EnumDef>;
  structs: Record<string, StructDef>;
  unions: Record<string, UnionDef>;
  tables: Record<string, TableDef>;
}
