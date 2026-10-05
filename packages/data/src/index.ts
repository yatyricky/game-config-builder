export const PACKAGE_NAME = '@gcb/data';

export type { JsonlParseResult } from './jsonl.js';
export { parseJsonl } from './jsonl.js';
export { canonicalizeRow, normalizeTable, formatFloat } from './canonical.js';
export type { TableData } from './io.js';
export { loadTable, writeTableNormalized, rowHash, normalizedContent } from './io.js';
export type { Backref } from './sqlite.js';
export { reindex, queryBackrefs, openIndex, schemaHash } from './sqlite.js';
