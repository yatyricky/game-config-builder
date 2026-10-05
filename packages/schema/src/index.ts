export const PACKAGE_NAME = '@gcb/schema';

export type {
  Severity,
  SourceRef,
  PrimitiveTypeName,
  MapKeyTypeName,
  PrimitiveTypeAst,
  EnumTypeAst,
  StructTypeAst,
  RefTypeAst,
  UnionTypeAst,
  ListTypeAst,
  MapTypeAst,
  TypeAst,
  LiteralValue,
  EnumValueDef,
  EnumDef,
  FieldDef,
  StructDef,
  UnionVariantDef,
  UnionDef,
  RowRuleDef,
  TableDef,
  TypeDef,
  SchemaIr,
} from './ir.js';

export { schemaError } from './errors.js';
export type { ValidationError } from './errors.js';

export { loadSchema } from './load.js';
export type { LoadSchemaResult } from './load.js';

export { parseTypeString, resolveTypes } from './type-parse.js';
export type { TypeParseResult } from './type-parse.js';

export { checkSchema } from './check.js';
