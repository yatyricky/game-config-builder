export const PACKAGE_NAME = '@gcb/validate';

export type {
  StructValue,
  Row,
  RowValue,
  RawRow,
  TypedRow,
  RowPk,
  TypeRowsResult,
} from './rows.js';
export { typeRows } from './rows.js';
export { checkKeys, pkKindOf } from './keys.js';

export type { Expr, BinOp, RuleScope, CompiledRule, CompileResult, Evaluation } from './dsl.js';
export { parseExpr, compileRule, buildRuleScope } from './dsl.js';

export type { RawRowsByTable, TypedRowsByTable } from './engine.js';
export { validateFull, walkRefs, checkForeignKeys } from './engine.js';

export type { ChangeSet, IncrementalIndex } from './incremental.js';
export { buildIndex, validateIncremental } from './incremental.js';
