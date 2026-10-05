// C# target（docs/04 §8.4，T4.4/T4.5）：强类型 POCO + System.Text.Json loader，无第三方依赖。
// 命名：schema 标识符保持；字段 camelCase → 属性 PascalCase；union → 抽象类 + Tag 枚举 + 变体包装类。

import { parseTypeString } from '@gcb/schema';
import type { SchemaIr, StructDef, TableDef, TypeAst } from '@gcb/schema';
import type { ExportContext, OutputFile, TargetPlugin } from './plugin.js';

function pascal(name: string): string {
  return name.length === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

function csharpType(ast: TypeAst, ir: SchemaIr): string {
  switch (ast.kind) {
    case 'primitive':
      if (ast.name === 'bool') return 'bool';
      if (ast.name === 'int') return 'int';
      if (ast.name === 'float') return 'float';
      return 'string';
    case 'enum':
      return ast.enumName;
    case 'ref': {
      const target = ir.tables[ast.tableName];
      const pkName = target?.primaryKey;
      const pkField =
        pkName === undefined ? undefined : target?.fields.find((f) => f.name === pkName);
      const parsed = pkField === undefined ? null : parseTypeString(pkField.type);
      return parsed !== null &&
        parsed.ok &&
        parsed.ast.kind === 'primitive' &&
        parsed.ast.name === 'string'
        ? 'string'
        : 'int';
    }
    case 'struct':
      return ast.structName;
    case 'list':
      return `List<${csharpType(ast.element, ir)}>`;
    case 'map':
      return `Dictionary<${ast.key === 'int' ? 'int' : 'string'}, ${csharpType(ast.element, ir)}>`;
    case 'union':
      return ast.unionName;
  }
}

function pkTypeOf(table: TableDef): 'int' | 'string' {
  const pkField = table.fields.find((f) => f.name === table.primaryKey);
  if (pkField === undefined) return 'int';
  const parsed = parseTypeString(pkField.type);
  return parsed.ok && parsed.ast.kind === 'primitive' && parsed.ast.name === 'string'
    ? 'string'
    : 'int';
}

function renderProperties(fields: Array<{ name: string; type: string }>, ir: SchemaIr): string[] {
  return fields.map((field) => {
    const parsed = parseTypeString(field.type);
    const cs = parsed.ok ? csharpType(parsed.ast, ir) : 'object';
    return `  public ${cs} ${pascal(field.name)} { get; set; }`;
  });
}

function structClass(
  def: { name: string; fields: Array<{ name: string; type: string }> },
  ir: SchemaIr,
): string {
  return [`public sealed class ${def.name} {`, ...renderProperties(def.fields, ir), '}', ''].join(
    '\n',
  );
}

function enumFile(ir: SchemaIr, name: string): string {
  const enumDef = ir.enums[name];
  if (enumDef === undefined) return '';
  const members = enumDef.values.map((v) => `  ${v.name} = ${v.value},`);
  return [`public enum ${name} {`, ...members, '}', ''].join('\n');
}

function structFile(ir: SchemaIr, name: string): string {
  const structDef = ir.structs[name];
  if (structDef === undefined) return '';
  return structClass(structDef, ir);
}

function unionFile(ir: SchemaIr, name: string): string {
  const unionDef = ir.unions[name];
  if (unionDef === undefined) return '';
  const tagMembers = unionDef.variants.map((v) => `  ${v.name},`);
  const variantClasses = unionDef.variants.map((v) => {
    const valueTypeName = v.struct;
    return [
      `public sealed class ${name}${v.name} : ${name} {`,
      `  public override ${name}Tag Tag => ${name}Tag.${v.name};`,
      `  public ${valueTypeName} Value { get; set; } = new ${valueTypeName}();`,
      '}',
      '',
    ].join('\n');
  });
  return [
    `public enum ${name}Tag {`,
    ...tagMembers,
    '}',
    '',
    `public abstract class ${name} {`,
    `  public abstract ${name}Tag Tag { get; }`,
    '}',
    '',
    ...variantClasses,
  ].join('\n');
}

function tableFile(ir: SchemaIr, name: string): string {
  const table = ir.tables[name];
  if (table === undefined) return '';
  return structClass({ name, fields: table.fields }, ir);
}

function tablesFile(ir: SchemaIr): string {
  const indexes = Object.keys(ir.tables)
    .sort()
    .map((name) => {
      const table = ir.tables[name];
      if (table === undefined) return '';
      const pkType = pkTypeOf(table);
      return `  public TableIndex<${name}, ${pkType}> ${name} { get; init; } = default!;`;
    });
  return [
    'public sealed class Tables {',
    ...indexes,
    '}',
    '',
    'public sealed class TableIndex<TRow, TPk> {',
    '  public required IReadOnlyList<TRow> Rows { get; init; }',
    '  public required IReadOnlyDictionary<TPk, TRow> ByPk { get; init; }',
    '  public TRow Get(TPk pk) => ByPk[pk];',
    '}',
    '',
  ].join('\n');
}

function loaderFile(ir: SchemaIr): string {
  const optionsLine =
    Object.keys(ir.unions).length > 0
      ? '    var options = new JsonSerializerOptions();\n' +
        Object.keys(ir.unions)
          .sort()
          .map((name) => `    options.Converters.Add(new ${name}Converter());`)
          .join('\n')
      : '    var options = new JsonSerializerOptions();';
  const loads = Object.keys(ir.tables)
    .sort()
    .map((name) => {
      const table = ir.tables[name];
      if (table === undefined) return '';
      const pkType = pkTypeOf(table);
      return `    tables.${name} = LoadIndex<${name}, ${pkType}>(Path.Combine(jsonDir, "${name}.json"), r => r.${pascal(table.primaryKey)}, options);`;
    });
  const converters = Object.keys(ir.unions)
    .sort()
    .map((name) => {
      const unionDef = ir.unions[name];
      if (unionDef === undefined) return '';
      const cases = unionDef.variants.map(
        (v) =>
          `      case "${v.name}": return new ${name}${v.name} { Value = element.GetProperty("value").Deserialize<${v.struct}>(options) ?? throw new ConfigException("变体数据为空") };`,
      );
      return [
        `public sealed class ${name}Converter : JsonConverter<${name}> {`,
        `  public override ${name} Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) {`,
        '    using var doc = JsonDocument.ParseValue(ref reader);',
        '    var element = doc.RootElement;',
        `    var tag = element.GetProperty("${unionDef.tag}").GetString();`,
        '    switch (tag) {',
        ...cases,
        `      default: throw new ConfigException($"未知变体：{tag}");`,
        '    }',
        '  }',
        `  public override void Write(Utf8JsonWriter writer, ${name} value, JsonSerializerOptions options) => throw new NotSupportedException();`,
        '}',
        '',
      ].join('\n');
    });
  return [
    'public sealed class ConfigException : Exception {',
    '  public ConfigException(string message) : base(message) {}',
    '}',
    '',
    'public sealed class TableFile<TRow> {',
    '  public string Table { get; set; } = "";',
    '  public string PrimaryKey { get; set; } = "";',
    '  public List<TRow> Rows { get; set; } = new();',
    '}',
    '',
    'public static class TablesLoader {',
    '  public static Tables Load(string jsonDir) {',
    optionsLine,
    '    var tables = new Tables();',
    ...loads,
    '    return tables;',
    '  }',
    '',
    '  private static TableIndex<TRow, TPk> LoadIndex<TRow, TPk>(string path, Func<TRow, TPk> keyOf, JsonSerializerOptions options) {',
    '    var json = File.ReadAllText(path);',
    '    var file = JsonSerializer.Deserialize<TableFile<TRow>>(json, options);',
    '    if (file == null) throw new ConfigException($"表文件为空：{path}");',
    '    var byPk = new Dictionary<TPk, TRow>();',
    '    foreach (var row in file.Rows) {',
    '      var k = keyOf(row);',
    '      if (!byPk.TryAdd(k, row)) throw new ConfigException($"主键重复：{path} #{k}");',
    '    }',
    '    return new TableIndex<TRow, TPk> { Rows = file.Rows, ByPk = byPk };',
    '  }',
    '}',
    '',
    ...converters,
  ].join('\n');
}

export interface CsharpOptions {
  namespace: string;
}

export function csharpTarget(options: CsharpOptions): TargetPlugin {
  const ns = options.namespace;
  const header = (usings: string[]): string[] => [
    '// Generated by gcb. DO NOT EDIT.',
    ...usings,
    `namespace ${ns};`,
    '',
  ];
  return {
    name: 'csharp',
    generate(ctx: ExportContext): OutputFile[] {
      const ir = ctx.ir;
      const files: OutputFile[] = [];
      const basicUsings = ['using System;'];
      const listUsings = ['using System;', 'using System.Collections.Generic;'];
      const loaderUsings = [
        'using System;',
        'using System.Collections.Generic;',
        'using System.IO;',
        'using System.Text.Json;',
        'using System.Text.Json.Serialization;',
      ];
      for (const name of Object.keys(ir.enums).sort()) {
        files.push({
          path: `csharp/${name}.cs`,
          content: [...header([]), enumFile(ir, name)].join('\n'),
        });
      }
      for (const name of Object.keys(ir.structs).sort()) {
        const structDef: StructDef | undefined = ir.structs[name];
        const needsCollections = (structDef?.fields ?? []).some((f) => {
          const parsed = parseTypeString(f.type);
          return parsed.ok && (parsed.ast.kind === 'list' || parsed.ast.kind === 'map');
        });
        files.push({
          path: `csharp/${name}.cs`,
          content: [
            ...header(needsCollections ? listUsings : basicUsings),
            structFile(ir, name),
          ].join('\n'),
        });
      }
      for (const name of Object.keys(ir.unions).sort()) {
        const unionDef = ir.unions[name];
        const needsCollections = (unionDef?.variants ?? []).some((v) => {
          const structDef = ir.structs[v.struct];
          return (structDef?.fields ?? []).some((f) => {
            const parsed = parseTypeString(f.type);
            return parsed.ok && (parsed.ast.kind === 'list' || parsed.ast.kind === 'map');
          });
        });
        files.push({
          path: `csharp/${name}.cs`,
          content: [
            ...header(
              needsCollections
                ? loaderUsings
                : [
                    ...basicUsings,
                    'using System.Text.Json;',
                    'using System.Text.Json.Serialization;',
                  ],
            ),
            unionFile(ir, name),
          ].join('\n'),
        });
      }
      for (const name of Object.keys(ir.tables).sort()) {
        const table: TableDef | undefined = ir.tables[name];
        const needsCollections = (table?.fields ?? []).some((f) => {
          const parsed = parseTypeString(f.type);
          return parsed.ok && (parsed.ast.kind === 'list' || parsed.ast.kind === 'map');
        });
        files.push({
          path: `csharp/${name}.cs`,
          content: [
            ...header(needsCollections ? listUsings : basicUsings),
            tableFile(ir, name),
          ].join('\n'),
        });
      }
      files.push({
        path: 'csharp/Tables.cs',
        content: [...header(listUsings), tablesFile(ir)].join('\n'),
      });
      files.push({
        path: 'csharp/TablesLoader.cs',
        content: [...header(loaderUsings), loaderFile(ir)].join('\n'),
      });
      return files;
    },
  };
}
