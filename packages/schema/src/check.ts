// schema 域语义自检（docs/04 §2.3，T1.4）。
// checkSchema = resolveTypes（type-parse/bad-ref/depth/cycle）+ 本文件检查：
// naming / enum-member / primary-key / display-field / range / field-key / duplicate-name(变体)。
// §2.3 清单覆盖对照：
//   YAML 语法错误→loadSchema(schema.yaml-parse)   未知类型引用/指向非表→resolveTypes(schema.bad-ref)
//   pk/displayField 存在性与类型→本文件            enum 值重复→本文件
//   range min>max→本文件                          命名非法/保留字→本文件
//   list/map 深度→resolveTypes(schema.depth)      键类型→parser 文法层拒绝
//   同块重名/跨文件重名→loadSchema(schema.duplicate-name)

import type { FieldDef, SchemaIr, TypeAst } from './ir.js';
import type { ValidationError } from './errors.js';
import { parseTypeString, resolveTypes } from './type-parse.js';

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parsedTypeOf(field: FieldDef): TypeAst | null {
  const result = parseTypeString(field.type);
  return result.ok ? result.ast : null;
}

/** 标量值类型：数据层表现为单个值的类型（§2.2 rule/unique 的适用域） */
function isScalarValued(ast: TypeAst): boolean {
  return ast.kind === 'primitive' || ast.kind === 'enum' || ast.kind === 'ref';
}

function isNumericPrimitive(ast: TypeAst): boolean {
  return ast.kind === 'primitive' && (ast.name === 'int' || ast.name === 'float');
}

function isTextPrimitive(ast: TypeAst): boolean {
  return ast.kind === 'primitive' && (ast.name === 'string' || ast.name === 'text');
}

function err(file: string, fieldPath: string, ruleId: string, message: string): ValidationError {
  return { table: file, rowKey: '', fieldPath, ruleId, severity: 'error', message };
}

/**
 * schema 域完整校验（docs/04 §5.1 管线第 1 步）。
 * 前置：loadSchema 已保证 IR 结构形状成立。
 */
export function checkSchema(ir: SchemaIr): ValidationError[] {
  const errors: ValidationError[] = resolveTypes(ir);

  for (const def of [
    ...Object.values(ir.enums),
    ...Object.values(ir.structs),
    ...Object.values(ir.unions),
    ...Object.values(ir.tables),
  ]) {
    if (!PASCAL_CASE.test(def.name)) {
      errors.push(
        err(def.source?.file ?? '', '', 'schema.naming', `类型名「${def.name}」必须是 PascalCase`),
      );
    }
  }

  for (const enumDef of Object.values(ir.enums)) {
    checkEnum(enumDef, errors);
  }
  for (const union of Object.values(ir.unions)) {
    checkUnion(union, errors);
  }
  for (const table of Object.values(ir.tables)) {
    checkTable(table, errors);
  }
  for (const struct of Object.values(ir.structs)) {
    for (const field of struct.fields) {
      checkField(field, 'struct', `struct「${struct.name}」`, errors);
    }
  }
  return errors;
}

function checkEnum(
  enumDef: {
    name: string;
    source?: { file: string; line: number };
    values: Array<{ name: string; value: number }>;
  },
  errors: ValidationError[],
): void {
  const file = enumDef.source?.file ?? '';
  const names = new Set<string>();
  const values = new Set<number>();
  for (const member of enumDef.values) {
    if (!PASCAL_CASE.test(member.name)) {
      errors.push(
        err(
          file,
          member.name,
          'schema.naming',
          `枚举「${enumDef.name}」成员名「${member.name}」必须是 PascalCase`,
        ),
      );
    }
    if (names.has(member.name)) {
      errors.push(
        err(
          file,
          member.name,
          'schema.enum-member',
          `枚举「${enumDef.name}」成员名「${member.name}」重复`,
        ),
      );
    }
    names.add(member.name);
    if (!Number.isInteger(member.value)) {
      errors.push(
        err(
          file,
          member.name,
          'schema.enum-member',
          `枚举「${enumDef.name}」成员「${member.name}」的值必须是整数`,
        ),
      );
    } else if (values.has(member.value)) {
      errors.push(
        err(
          file,
          member.name,
          'schema.enum-member',
          `枚举「${enumDef.name}」成员值 ${member.value} 重复`,
        ),
      );
    }
    values.add(member.value);
  }
}

function checkUnion(
  union: {
    name: string;
    source?: { file: string; line: number };
    tag: string;
    variants: Array<{ name: string; struct: string }>;
  },
  errors: ValidationError[],
): void {
  const file = union.source?.file ?? '';
  if (!CAMEL_CASE.test(union.tag)) {
    errors.push(
      err(
        file,
        '',
        'schema.naming',
        `union「${union.name}」的 tag「${union.tag}」必须是 camelCase`,
      ),
    );
  }
  const seen = new Set<string>();
  for (const variant of union.variants) {
    if (!PASCAL_CASE.test(variant.name)) {
      errors.push(
        err(
          file,
          `variants.${variant.name}`,
          'schema.naming',
          `union「${union.name}」变体名「${variant.name}」必须是 PascalCase`,
        ),
      );
    }
    if (seen.has(variant.name)) {
      errors.push(
        err(
          file,
          `variants.${variant.name}`,
          'schema.duplicate-name',
          `union「${union.name}」变体名「${variant.name}」重复`,
        ),
      );
    }
    seen.add(variant.name);
  }
}

function checkTable(
  table: {
    name: string;
    source?: { file: string; line: number };
    primaryKey: string;
    displayField: string;
    fields: FieldDef[];
    rowRules?: Array<{ id: string }>;
  },
  errors: ValidationError[],
): void {
  const file = table.source?.file ?? '';
  const pkField = table.fields.find((f) => f.name === table.primaryKey);
  if (pkField === undefined) {
    errors.push(
      err(
        file,
        table.primaryKey,
        'schema.primary-key',
        `表「${table.name}」的 primaryKey「${table.primaryKey}」不是已定义的字段`,
      ),
    );
  } else {
    const ast = parsedTypeOf(pkField);
    const pkTypeOk =
      ast !== null && ast.kind === 'primitive' && (ast.name === 'int' || ast.name === 'string');
    if (!pkTypeOk) {
      errors.push(
        err(
          file,
          table.primaryKey,
          'schema.primary-key',
          `表「${table.name}」的主键类型必须是 int 或 string`,
        ),
      );
    }
  }
  if (!table.fields.some((f) => f.name === table.displayField)) {
    errors.push(
      err(
        file,
        table.displayField,
        'schema.display-field',
        `表「${table.name}」的 displayField「${table.displayField}」不是已定义的字段`,
      ),
    );
  }
  for (const rule of table.rowRules ?? []) {
    if (!KEBAB_CASE.test(rule.id)) {
      errors.push(
        err(
          file,
          rule.id,
          'schema.naming',
          `表「${table.name}」的 rowRule id「${rule.id}」必须是 kebab-case`,
        ),
      );
    }
  }
  for (const field of table.fields) {
    checkField(field, 'table', `表「${table.name}」`, errors);
  }
}

function checkField(
  field: FieldDef,
  ownerKind: 'table' | 'struct',
  where: string,
  errors: ValidationError[],
): void {
  const file = field.source?.file ?? '';
  if (!CAMEL_CASE.test(field.name)) {
    errors.push(
      err(file, field.name, 'schema.naming', `${where}的字段名「${field.name}」必须是 camelCase`),
    );
  }
  if (field.name === 'value') {
    errors.push(
      err(file, field.name, 'schema.naming', '字段名「value」是 union 编码保留字，禁止使用'),
    );
  }

  const ast = parsedTypeOf(field);
  if (ast === null) return; // 类型字符串非法已由 resolveTypes 报 schema.type-parse

  if (field.range !== undefined) {
    if (!isNumericPrimitive(ast)) {
      errors.push(
        err(
          file,
          field.name,
          'schema.field-key',
          `${where}的字段「${field.name}」的 range 仅适用于 int/float 字段`,
        ),
      );
    } else if (field.range[0] > field.range[1]) {
      errors.push(
        err(
          file,
          field.name,
          'schema.range',
          `字段「${field.name}」的 range [${field.range[0]}, ${field.range[1]}] 中 min 大于 max`,
        ),
      );
    }
  }
  if (field.maxLength !== undefined && !isTextPrimitive(ast)) {
    errors.push(
      err(
        file,
        field.name,
        'schema.field-key',
        `${where}的字段「${field.name}」的 maxLength 仅适用于 string/text 字段`,
      ),
    );
  }
  if (field.unique !== undefined) {
    if (ownerKind === 'struct') {
      errors.push(
        err(
          file,
          field.name,
          'schema.field-key',
          `struct 内的字段「${field.name}」不得声明 unique（仅表顶层字段允许）`,
        ),
      );
    } else if (!isScalarValued(ast)) {
      errors.push(
        err(
          file,
          field.name,
          'schema.field-key',
          `字段「${field.name}」的 unique 仅适用于标量值字段（primitive/enum/ref）`,
        ),
      );
    }
  }
  if (field.rule !== undefined && !isScalarValued(ast)) {
    errors.push(
      err(
        file,
        field.name,
        'schema.field-key',
        `字段「${field.name}」的 rule 仅适用于标量值字段（primitive/enum/ref）`,
      ),
    );
  }
  if (
    field.default !== undefined &&
    (ast.kind === 'list' || ast.kind === 'map' || ast.kind === 'union')
  ) {
    errors.push(
      err(
        file,
        field.name,
        'schema.field-key',
        `字段「${field.name}」的 default 不适用于 ${ast.kind} 字段`,
      ),
    );
  }
}
