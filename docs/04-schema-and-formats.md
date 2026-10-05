# 04 · Schema IR 与数据格式规范（规范性契约）

> 本文档是 `@gcb/schema` / `@gcb/validate` / `@gcb/data` / `@gcb/exporter` 实现的**逐条契约**。
> 实现与规范冲突时，以本文档为准；本文档有缺陷时，停下来问人并走 ADR 修订（AGENTS §6）。
> 章节引用记法：任务卡中「规范 §3」即本文 §3。

## 1. 项目文件布局与总则

一个「配置项目」（如 `examples/demo`）的目录结构：

```
<project>/
├─ schema/            # 若干 YAML，合起来构成完整 IR（可按领域拆文件）
│  ├─ types.yaml      #   建议公共 enum/struct 放这里（约定，非强制）
│  ├─ Item.yaml
│  └─ Skill.yaml
├─ data/              # 每表一个 JSONL
│  ├─ Item.jsonl
│  └─ Skill.jsonl
├─ migrations/        # 显式迁移文件（§10）
├─ .gcb-state.json    # 迁移应用状态（进 git）
└─ gcb.db             # SQLite 派生索引（gitignore，可删）
```

总则：

- 所有文本文件 UTF-8 无 BOM、LF 行尾。
- 标识符命名：表/struct/enum/union 名 PascalCase；字段名 camelCase；迁移文件 `{序号}-{kebab 描述}.yaml`。
- 类型名（enum/struct/union/table 共用一个命名空间）全局唯一。
- YAML 加载采用**两遍解析**：先收集全部类型与表名，再解析字段类型字符串中的引用——因此 schema 文件间无加载顺序依赖。

## 2. Schema YAML 语法

一个 schema YAML 文件可包含四个顶层块（均可省略）：`enums` / `structs` / `unions` / `tables`。

### 2.1 完整示例

```yaml
enums:
  ItemQuality:
    comment: 物品品质
    values:
      - { name: White, value: 0 }
      - { name: Green, value: 1 }
      - { name: Blue, value: 2 }
      - { name: Purple, value: 3 }

structs:
  RewardItem:
    comment: 奖励项
    fields:
      - { name: itemId, type: "ref<Item>", rule: "count <= 10 || itemId != 9001" }
      - { name: count, type: int, default: 1, range: [1, 9999] }
  DamageParams:
    fields:
      - { name: power, type: int, range: [0, 999999] }
      - { name: element, type: "enum<ItemQuality>", default: White }
  HealParams:
    fields:
      - { name: heal, type: int, range: [1, 999999] }
      - { name: cure Poison, type: bool, default: false }   # ← 非法示例：字段名不得含空格

unions:
  SkillEffect:
    comment: 技能效果（tag 多态）
    tag: effectType
    variants:
      - { name: Damage, struct: DamageParams }
      - { name: Heal, struct: HealParams }

tables:
  Item:
    comment: 物品表
    primaryKey: id
    displayField: name
    fields:
      - name: id
        type: int
        range: [1, 999999]
      - name: name
        type: string
        maxLength: 64
      - name: quality
        type: "enum<ItemQuality>"
        default: White
      - name: price
        type: int
        default: 0
        rule: "price >= 0 && price % 10 == 0"
      - name: rewards
        type: "list<struct<RewardItem>>"
      - name: attrs
        type: "map<string, float>"
    rowRules:
      - id: price-quality
        rule: "(quality == White) || (price > 0)"
        severity: warning
        message: "非白品物品应定价"
```

（注：上面 `cure Poison` 一行是**故意展示的非法写法**，实现时当作 `schema.reserved-name`/命名非法的测试素材。）

### 2.2 关键字表

**enum 定义**

| 键 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `comment` | string | 否 | 备注，导出到生成代码注释 |
| `values` | list | 是 | `{name, value}` 列表；name PascalCase 且唯一，value 为 int 且唯一 |

**struct 定义**（`structs` 与 union variant 复用）

| 键 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `comment` | string | 否 | 备注 |
| `fields` | list | 是 | 字段列表，见下表；struct 内字段不得用 `unique` |

**union 定义**

| 键 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `tag` | string | 是 | 判别字段名（camelCase），用于 JSON/Lua/C# 中的多态编码 |
| `variants` | list | 是 | `{name, struct}` 列表；name PascalCase 且唯一，struct 必须存在 |

**table 定义**

| 键 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `comment` | string | 否 | 备注 |
| `primaryKey` | string | 是 | 必须指向本表一个 int 或 string 字段 |
| `displayField` | string | 是 | 摘要展示字段（FK chip、下拉、peek 标题）；显示为 `{displayValue} # {pk}` |
| `fields` | list | 是 | 字段列表 |
| `rowRules` | list | 否 | 行级规则，见 §4.4 |

**字段（field）**

| 键 | 类型 | 适用类型 | 语义 |
|---|---|---|---|
| `name` | string | 全部 | camelCase，表内/struct 内唯一；不得为 `value`（union 编码保留字，见 §3） |
| `type` | string | 全部 | 类型字符串，语法见 §3 |
| `default` | 字面量 | 标量/struct | 缺失时填充的默认值；省略默认值的标量字段缺失即 `required.missing`；list/map 有隐式空集合默认 |
| `comment` | string | 全部 | 备注 |
| `range` | [min, max] | int/float | 闭区间数值约束 → `type.int.range` / `type.float.range` |
| `maxLength` | int | string/text | → `type.string.max-length` |
| `unique` | bool | 表顶层字段 | 跨行唯一 → `unique.duplicate`；主键字段隐含 unique |
| `rule` | string | 任意标量字段 | 单字段 DSL 表达式（行上下文求值，见 §4），error 级 |

**rowRules 条目**

| 键 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `id` | string | 是 | kebab-case，规则标识（进错误对象） |
| `rule` | string | 是 | DSL 表达式，必须求值为 bool；false = 违规 |
| `severity` | string | 否 | `error`（默认）/ `warning` |
| `message` | string | 否 | 违规时的中文消息模板，可用 `{字段名}` 占位 |

### 2.3 schema 自检规则（checkSchema 产出）

全部为 error 级，ruleId 前缀 `schema.`：YAML 语法错误（附文件/行号）、未知类型引用、`ref<>` 指向非 table、`displayField`/`primaryKey` 不存在或类型非法、enum 值重复、union variant 指向不存在的 struct、`range` min>max、标识符命名非法（非 PascalCase/camelCase、含空格、保留字 `value`）、list/map 深度或键类型违规（§3）、同文件块内重名、跨文件类型重名。

## 3. 类型系统

### 3.1 类型字符串文法

```
type      := "bool" | "int" | "float" | "string" | "text"
          | "enum"   "<" EnumName   ">"
          | "struct" "<" StructName ">"
          | "ref"    "<" TableName  ">"
          | "list"   "<" elemType   ">"
          | "map"    "<" keyType "," elemType ">"
          | "union"  "<" UnionName  ">"
keyType   := "int" | "string"
elemType  := "bool" | "int" | "float" | "string" | "text"
          | "enum<...>" | "struct<...>" | "ref<...>" | "union<...>"
```

**深度约束（v1 封闭清单，防组合爆炸）**：`list` 与 `map` 的元素类型不得再包含 `list`/`map`（即集合嵌套深度 ≤ 1）。`long`/`datetime` 等 v1 不提供（ADR-1 精度理由 / 需求未定）。

### 3.2 各类型语义与 JSON 表示（JSONL 中）

| 类型 | JSONL 表示 | 语义与约束 |
|---|---|---|
| `bool` | `true`/`false` | |
| `int` | 整数字面量 | 必须是安全整数（|v| ≤ 2^53−1），否则 `type.int.parse` |
| `float` | 数（必含 `.` 或 `e`） | 有限数，禁 `Infinity`/`NaN`；序列化必须可往返（`JSON.stringify` 语义） |
| `string` | string | |
| `text` | string | 本地化键；v1 实现等同 string，仅语义标记（Phase 3 接本地化管线） |
| `enum<E>` | **符号名字符串** | 必须是 E 的成员名，否则 `enum.unknown-member`；**编辑器内显示符号名；导出物中转为 int**（diff 友好 vs 运行时紧凑，两全） |
| `ref<T>` | T 主键类型的字面量 | 存在性由 FK 校验（§5.4）保证 |
| `struct<S>` | object | 键序遵循 S 字段序 |
| `list<E>` | array | |
| `map<K,V>` | object | JSON 键必为字符串；K=int 时键必须可 parse 为 int（`map.key.parse`），加载后转回 int；K=string 原样 |
| `union<U>` | object | **恰好两个键**：`"<tag>" : "<VariantName>"`（字符串）与 `"value" : {...变体 struct...}`；`value` 是保留字段名 |

**默认值规则**：字段缺失时——声明了 `default` → 填充；`list`/`map` → 填空集合；其余 → `required.missing` 错误。任何类型不得显式取 `null`。

## 4. 校验 DSL

### 4.1 文法（EBNF）

```
expr    := or
or      := and { ("||" | "or") and }
and     := cmp { ("&&" | "and") cmp }
cmp     := add [ ("==" | "!=" | "<" | "<=" | ">" | ">=") add ]
add     := mul { ("+" | "-") mul }
mul     := unary { ("*" | "/" | "%") unary }
unary   := ("!" | "-") unary | primary
primary := "(" expr ")" | NUMBER | STRING | "true" | "false" | call | ident
call    := IDENT "(" [ expr { "," expr } ] ")"
ident   := "$pk" | IDENT { "." IDENT }
STRING  := 双引号，支持 \" \\ \n \t，其余原样（UTF-8）
```

无三元、无赋值、无自定义函数。**编译期**拒绝未定义标识符与类型不匹配（求值前报 `rule.compile` 错误，属于 schema 错误域）。

### 4.2 标识符解析与类型规则

- 顶层裸标识符 = 当前行字段；点号链进入 struct 字段（如 `rewards` 整体是 list，不可直接用；见函数节）。`$pk` = 当前行主键值。
- **枚举成员引用**：`==`/`!=` 的一侧是 enum 类型字段时，另一侧裸标识符若不是字段名，解析为该枚举成员（如 `quality == White`）。
- 数值运算（`+ - * / %` 及序比较）要求两侧均为 int/float（int 与 float 可混，结果 float）；`/` 与 `%` 除数为 0 → 规则求值错误，按违规处理。
- `&&`/`||`/`!` 要求 bool 操作数。
- `==`/`!=`：同型比较；int 与 float 按数值比较。
- 字符串仅可 `==`/`!=`/`<`…（字典序）与传给函数。

### 4.3 内置函数（封闭集合）

| 函数 | 签名 | 说明 |
|---|---|---|
| `len(x)` | list/map/string → int | |
| `contains(list, v)` | → bool | 元素相等（v 类型须与元素类型一致） |
| `containsKey(map, k)` | → bool | |
| `abs(x)` / `min(a,b,…)` / `max(a,b,…)` | 数 → 数 | |
| `matches(s, pattern)` | string,string → bool | JS RegExp 语义，仅用于 string |

### 4.4 规则挂载点与求值语义

| 挂载点 | 上下文 | severity | 错误 ruleId |
|---|---|---|---|
| 表顶层字段的 `rule` | 当前行（可引用任意行内字段） | error | `rule.field` |
| struct 内字段的 `rule` | 该 struct 实例（仅可引用**兄弟字段**，不可越级引用整行；`$pk` 不可用） | error | `rule.field` |
| 表 `rowRules[]` | 当前行（可点号进入 struct 类型字段；list/map 值只能整体传给函数；union 不可寻址） | 声明值 | `rule.row`（消息含规则 id） |

求值结果必须为 bool（编译期保证）。`false` = 违规。消息模板 `{字段名}` 替换为该字段值的字符串形式。

## 5. 校验引擎

### 5.1 执行顺序

1. `checkSchema`（schema 域，失败则到此为止）
2. 逐表逐行：JSONL 解析 → 结构检查（未知字段 `type.unknown-field`、类型检查、默认值填充）→ 主键/唯一 → 字段/行规则
3. 关系层：FK 存在性（按**被引表优先**的拓扑序；环状引用时主键存在性在同表内先行判定）
4. 汇总 `ValidationError[]`

### 5.2 完整内置 ruleId 清单

| ruleId | 域 | severity | 含义 |
|---|---|---|---|
| `schema.*`（§2.3） | schema | error | schema 自检 |
| `rule.compile` | schema | error | DSL 表达式无法编译 |
| `data.jsonl.parse` | 数据 | error | 某行不是合法 JSON（附行号） |
| `type.<t>.parse` | 数据 | error | 值不合类型 t |
| `type.int.range` / `type.float.range` | 数据 | error | 越界 |
| `type.string.max-length` | 数据 | error | 超长 |
| `type.unknown-field` | 数据 | error | schema 未定义的字段 |
| `required.missing` | 数据 | error | 缺失且无默认值 |
| `enum.unknown-member` | 数据 | error | 枚举成员不存在 |
| `map.key.parse` | 数据 | error | int 键无法解析 |
| `union.shape` | 数据 | error | union 编码不合 §3.2 |
| `pk.duplicate` | 数据 | error | 主键重复 |
| `pk.order` | 数据 | warning | 行序非主键升序（normalize 可修复） |
| `unique.duplicate` | 数据 | error | unique 字段重复 |
| `fk.missing` | 数据 | error | 引用了不存在的行（附目标表） |
| `rule.field` / `rule.row` | 数据 | 声明值 | DSL 规则违规 |

### 5.3 错误模型

```ts
interface ValidationError {
  table: string;        // 表名；schema 域错误为 schema 文件相对路径
  rowKey: string;       // 主键规范字符串（int → 十进制字符串）；无行上下文为 ""
  fieldPath: string;    // ""（表级）| "price" | "rewards.1.count"（点号+下标；map 键原样，如 "attrs.fire"）
  ruleId: string;       // 上表；DSL 规则附 id，如 "rule.row:price-quality"
  severity: "error" | "warning";
  message: string;      // 中文，含定位与期望值；不暴露内部栈
}
```

- error 阻塞保存/导出；warning 放行但展示。
- 消息必须是策划可行动的句子（「价格必须是 10 的倍数，当前 95」而非「rule failed」）。

### 5.4 FK 存在性

`ref<T>` 字段值必须存在于 T 表的主键集合。同表自引用合法（拓扑序退化为同表内两遍：先收主键集再查出边）。错误定位在被引方缺失时仍报在**引用行**上（`fk.missing`，message 附 `T#pk`）。

### 5.5 行哈希（乐观并发，ADR-9）

```
rowHash = sha256( canonicalJSON )
canonicalJSON = 紧凑序列化（无空白）的「默认值填充后的完整行对象」，键序 = schema 字段序（嵌套同理）
```

规范字符串化由 `@gcb/data` 单点实现（`canonicalizeRow`），server 与 CLI 复用，禁止各自实现。

### 5.6 增量校验（编辑器端 API）

```ts
validateIncremental(schema, tableRows: Map<Table, Row[]>, changed: { table: string; keys: string[] }[]): ValidationError[]
```

必须重算的规则集合：

1. 变更行的全部行内规则（结构、类型、rule.field、rule.row）；
2. 变更行参与的 `pk` / `unique` 分组（按组重算）；
3. FK：变更行的**出边**（引用是否仍存在）+ 全库**指向变更行主键的入边**（被引行主键被修改/删除时，引用方立即变红）；
4. 返回值只含本次重算发现的错误（渲染层做集合差分更新标记）。

性能目标：单行变更 ≤ 5ms（10⁵ 行规模），作为 vitest 基准测试（超时即红）。

## 6. JSONL 数据文件格式

- 每行一条记录：紧凑 JSON（键值分隔无空格），键序 = schema 字段序（嵌套同理）。
- 行序 = 主键升序（int 数值序；string 按 Unicode 码点序）。违反 → `pk.order` warning，`gcb validate --fix` 或写路径的 normalize 自动修复。
- 省略语义：值等于默认值（或空集合）的键**应当省略**；显式写出也合法（读入等价），normalize 时省略化。
- 文件尾恰好一个换行符；空表 = 空文件。
- `normalize(tableRows, schema)`：类型化 → 填默认 → 键序规范 → 主键排序 → 省略默认 → 写回。所有写路径（CLI fix、server 保存）必须经过它。

## 7.（并入 §5.3 错误模型）

## 8. 导出契约

前置：`checkSchema` + 全量校验通过（error 级为空），否则拒绝导出并输出报告。

### 8.1 布局与清单

```
export/
├─ json/<Table>.json
├─ lua/<Table>.lua
├─ csharp/<Table>.cs、<Enum>.cs、<Union>.cs、Tables.cs、TablesLoader.cs
└─ manifest.json        # [{ table, target, contentHash, sourceHash: schemaHash+dataHash }]
```

### 8.2 JSON target

```json
{
  "table": "Item",
  "primaryKey": "id",
  "rows": [
    { "id": 1001, "name": "铁剑", "quality": 1, "price": 100,
      "rewards": [ { "itemId": 2001, "count": 2 } ],
      "attrs": { "atk": 5.5 },
      "onUse": { "effectType": "Damage", "value": { "power": 10, "element": 0 } } }
  ]
}
```

- 行内键序 = schema 字段序；enum → **int**；ref → 原值；union → `{ "<tag>": "<VariantName>", "value": {...} }`（variant 名保留字符串，作判别式）；float 保证往返。

### 8.3 Lua target

```lua
-- Generated by gcb. DO NOT EDIT.
return {
  [1001] = {
    id = 1001,
    name = "铁剑",
    quality = 1,
    price = 100,
    rewards = {
      { itemId = 2001, count = 2 },
    },
    attrs = { ["atk"] = 5.5 },
    onUse = { effectType = "Damage", value = { power = 10, element = 0 } },
  },
}
```

- 顶层键 = 主键：int 用 `[1001]`，string 用 `["abc"]`。
- 字符串转义：`\` `"` `\n` `\t`，其余字符原样输出（UTF-8）。
- 每表一个 `return` table 的模块文件；缩进 2 空格；末尾保留逗号。

### 8.4 C# target

命名：schema 标识符 PascalCase 保持；字段 camelCase → 属性 PascalCase（`itemId` → `ItemId`）。命名空间默认 `GameConfig`（CLI `--csharp-namespace` 覆盖）。

类型映射：

| schema | C# |
|---|---|
| bool / int / float / string / text | bool / int / float / string |
| enum\<E\> | `public enum E : int`（成员带显式值） |
| struct\<S\> | `public sealed class S`（属性 + 无参构造 + System.Text.Json 兼容） |
| ref\<T\> | T 主键类型（int/string）；不做运行期导航（Phase 3 可选增强） |
| list\<E\> | `List<E#>` |
| map\<K,V\> | `Dictionary<K, V#>`（K=int 时 JSON 键由 loader 转换） |
| union\<U\> | `public abstract class U { public UTag Tag; }` + 每 variant 一个 `public sealed class U<V> : U` + `public enum UTag`；loader 按 tag 多态反序列化 |

结构：

- `Tables.cs`：`public sealed class Tables { public TableIndex<Item…> Item; … }`——每表暴露 `IReadOnlyList<TRow> Rows`（文件序）与 `TRow Get(<pkType> pk)`（字典）。
- `TablesLoader.cs`：`Tables.Load(string jsonDir)`，System.Text.Json，无第三方依赖；解析失败抛 `ConfigException`（含表名+主键）。
- 生成文件头注释 `// Generated by gcb. DO NOT EDIT.`。

### 8.5 增量导出与 diff 报告（M5）

- 增量：manifest 中 `sourceHash`（schemaHash + 表数据 hash）未变的条目跳过重写。
- `gcb diff`：对两份导出 manifest（默认 vs 上一次），输出行级 added/removed/changed 的 Markdown 报告（changed 展开到字段级），供 QA 回归。

## 9. SQLite 派生索引 DDL

```sql
CREATE TABLE IF NOT EXISTS tables(
  name TEXT PRIMARY KEY, pk_field TEXT NOT NULL, row_count INTEGER NOT NULL,
  schema_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rows(
  table_name TEXT NOT NULL, pk TEXT NOT NULL, row_hash TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (table_name, pk));
CREATE TABLE IF NOT EXISTS fk_edges(
  from_table TEXT NOT NULL, from_pk TEXT NOT NULL, from_field TEXT NOT NULL,
  to_table TEXT NOT NULL, to_pk TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fk_forward  ON fk_edges(from_table, from_pk);
CREATE INDEX IF NOT EXISTS idx_fk_backward ON fk_edges(to_table, to_pk);
```

- `pk` 一律规范字符串（int → 十进制字符串）。
- 反向引用查询：`SELECT from_table, from_pk, from_field FROM fk_edges WHERE to_table=? AND to_pk=?`。
- 重建：`gcb reindex <project>` 全量重灌。server 启动时校验 `tables.schema_hash` 与当前 schema hash，不符自动重建。

## 10. 迁移文件格式（v0，M5 实现）

```yaml
# migrations/0001-rename-item-price.yaml
kind: rename-field
table: Item
from: price
to: cost
```

```yaml
# migrations/0002-retype-item-cost.yaml
kind: retype-field
table: Item
field: cost
from: int
to: float
```

- `rename-field`：数据键重写（schema 改名后运行，把旧键名数据迁移到新键名），同时更新引用本表的……（v0 不跨表重命名主键——主键重命名不支持，明确报错）。
- `retype-field`：逐行尝试转换（int→float 恒成；string→int 尝试 parse）。失败行全部列出后**中止**，不部分应用。
- 应用顺序 = 文件名字典序；`.gcb-state.json` 记 `applied: ["0001-…", …]`；已应用跳过；迁移执行后立即 normalize + reindex。
- schema 侧不自动改：迁移只动数据与状态文件，schema 变更由人提交（顺序：先加迁移 → 改 schema → 跑 `gcb migrate`）。

## 11. 规范稳定性声明

- v1 冻结：原语集合、类型文法与深度约束、DSL 文法与函数集、JSONL 编码、错误模型、导出布局。
- 预留演进（须走 ADR）：`text` 本地化管线、`displayField` 模板语法、`long`/`datetime`、list/map 深度放开、C# ref 导航属性、二进制 target。
- 任何「规范没写」的情况：停下问人（AGENTS §6），不得自行发明行为。
