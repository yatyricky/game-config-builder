# 02 · 架构设计

> 模块划分、依赖方向、数据流。为什么这样分见 docs/01 与 docs/03；
> 数据格式与接口的字段级契约见 docs/04。

## 1. 五层总览

```
┌─────────────────────────────────────────────────────────────┐
│ 5 导出层   @gcb/exporter + @gcb/cli                          │
│      全量校验 → IR → json / lua / csharp 生成器（插件式）      │
├─────────────────────────────────────────────────────────────┤
│ 4 校验层   @gcb/validate（同构：浏览器 + Node 同一份代码）      │
│      类型检查 · DSL 规则 · FK 存在性 · 唯一性 · 增量求值        │
├─────────────────────────────────────────────────────────────┤
│ 3 编辑器   apps/web（Svelte 5）+ apps/server（Fastify）       │
│      @gcb/grid 纯逻辑内核 + 薄渲染层 · 单人编辑 · 哈希乐观并发  │
├─────────────────────────────────────────────────────────────┤
│ 2 存储层   @gcb/data                                          │
│      JSONL（source of truth）+ SQLite（派生索引，可重建）       │
├─────────────────────────────────────────────────────────────┤
│ 1 Schema IR   @gcb/schema                                     │
│      YAML → 类型化 IR · 自检 · 迁移 —— 一切的起点              │
└─────────────────────────────────────────────────────────────┘
```

设计铁律：**上层依赖下层，禁止反向**。校验层不知道编辑器的存在；编辑器通过组合校验层与存储层实现体验。

## 2. 同构校验引擎（本架构的灵魂）

同一份 `@gcb/validate` 代码（无 DOM/Node 依赖）运行在两个位置：

```
编辑器（浏览器）                                服务端（Node）
  击键 → debounce 300ms                           保存请求 / 导出命令
  → 变更行集合                                      → 全量或按表加载
  → validateIncremental(schema, rows, changed)     → validateFull(schema, allRows)
  → 单元格红绿标记（0 网络往返）                     → 不信任客户端，最终裁决
```

- 编辑器端增量校验**零网络延迟**——这是「校验前移」体验的成立前提。
- 服务端在保存与导出时**复验**——不信任任何客户端结论。
- 两侧结果必然一致，因为跑的是同一个包的同一个版本（monorepo 内联依赖，版本永不漂移）。

这是选择全栈 TypeScript 的决定性理由（ADR-1）：任何双语言方案都要维护两份语义等价的校验实现，必然漂移。

## 3. 存储双层

### 3.1 Source of truth：JSONL 文本

- 每表一个 `data/<Table>.jsonl`，每行一条记录（JSON 对象，键序遵循 schema 字段序）。
- 行按主键稳定排序（int 数值升序；string 字典序），保证 diff 稳定。
- 省略的字段 = 取 schema 默认值（默认值变更不需要重写数据文件）。
- 格式细节（编码、换行、数字表示）见 docs/04 §6。

### 3.2 派生索引：SQLite（`@gcb/data`，Node 专用）

`gcb.db` 位于数据根目录，**gitignore**，可随时删除，`gcb reindex` 全量重建。表结构（DDL）见 docs/04 §9。承载：

- `rows`：行内容哈希（乐观并发护栏的数据源）+ 原文 JSON；
- `fk_edges`：正反向外键边——peek 钻取与反向引用面板的查询源；
- 文本搜索（v1 对 JSON 文本 LIKE，10⁵ 行量级可接受）。

**永远不把只能存在这里的数据放进 SQLite**——它是缓存，不是真相。

## 4. 网格双层：纯逻辑内核 + 薄渲染层

```
┌─────────────────────────── apps/web ────────────────────────────┐
│  Svelte 渲染层（薄）                                              │
│   · Grid.svelte：滚动容器、spacer、行级 each 块、transform 定位     │
│   · CellRenderer：<动态组件> 按 column.type 渲染 chip/enum/子网格    │
│   · EditOverlay.svelte：原生 DOM input，承接 IME                  │
├─────────────────────────────────────────────────────────────────┤
│  @gcb/grid 纯逻辑内核（框架无关，无 DOM import，vitest 全覆盖）       │
│   · LayoutEngine：固定行高、列宽、冻结列、可视窗口 + overscan 计算     │
│   · SelectionModel：单选/区域/整行整列、shift/ctrl 扩展              │
│   · KeyController：方向键/Home/End/PageUp/PageDown → 意图           │
│   · EditController：编辑状态机 idle→editing→commit/cancel           │
│   · HistoryStack：命令式撤销/重做（单元格/区域编辑、粘贴、填充）        │
└─────────────────────────────────────────────────────────────────┘
```

内核 API 草图（实现以 docs/05 T6.1 卡片为准）：

```ts
// @gcb/grid —— 类 + 回调事件，可变状态但无副作用外溢
export interface GridEvents {
  onViewportChange(range: RowRange): void;   // 渲染层重画窗口
  onSelectionChange(sel: SelectionState): void;
  onEditCommit(coord: CellCoord, raw: string): void; // 提交 parse 交给上层
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
}
export class GridModel {
  constructor(opts: { rowCount: number; columns: ColumnSpec[]; rowHeight: number }, events: GridEvents): void;
  scrollToRow(index: number): void;
  handleKeyDown(key: string, modifiers: KeyModifiers): void;   // 纯意图分发
  beginEdit(coord: CellCoord, initial?: string): void;
  commitEdit(raw: string): void;
  undo(): void; redo(): void;
}
```

原则：**所有可以出错的逻辑都放在内核里被 vitest 覆盖**；Svelte 层只做「订阅事件 + 把状态翻译成 DOM」。渲染层薄到重写它不心疼——这就是 ADR-2 声称「渲染层可退路更换」的结构性保证。

## 5. workspace 结构与包职责

目录树见 AGENTS.md §3。各包对外出口：

| 包 | 主要导出 | 依赖 |
|---|---|---|
| `@gcb/schema` | `loadSchemaDir(dir)`、`checkSchema(ir)`、IR 全部类型、`runMigrations()` | `yaml` |
| `@gcb/validate` | `validateFull(schema, tableRows)`、`validateIncremental(schema, tableRows, changedKeys)`、`compileRule(expr)` | `@gcb/schema` |
| `@gcb/data` | `loadTable()`、`writeTableNormalized()`、`rowHash()`、`Reindexer`（SQLite） | `@gcb/schema`、`better-sqlite3` |
| `@gcb/exporter` | `runExport(schema, data, { targets })`、`TargetPlugin` 接口、json/lua/csharp 三插件 | `@gcb/schema`、`@gcb/validate` |
| `@gcb/grid` | `GridModel` 及内核全部类型 | 无 |
| `@gcb/cli` | bin `gcb`：`check-schema` / `validate` / `export` / `diff` / `reindex` / `migrate` / `init` | 全部 |

包间以 workspace 协议互相引用，**直接消费 TS 源码**（`exports` 指向 `src/index.ts`），由消费方（vite/tsx/tsup）编译——不为内部包维护独立构建步骤。仅 `@gcb/cli` 用 tsup 产出可发布 dist。

## 6. 关键数据流时序

### 6.1 Phase 2：编辑保存（单人 + 乐观并发）

```
用户击键
 → EditOverlay 提交 raw → GridModel.commitEdit
 → web 端 parse（@gcb/validate 的 parseValue）→ 本地乐观显示
 → debounce 300ms → validateIncremental（本地）→ 红绿标记
 → 用户点保存
 → PUT /api/tables/Item/rows/1001  { row, baseRowHash }
 → server：rowHash(db 当前行) == baseRowHash ?
      否 → 409 { reason: "stale", currentRow } → web 提示并刷新该行
      是 → validateFull(受影响表) → 通过？
             否 → 422 { errors[] } → web 标记（理论上不应发生，本地已校验）
             是 → 写 JSONL（规范化排序）→ 更新 SQLite → 200 { newRowHash }
```

### 6.2 导出（Phase 1 起，CLI；Phase 2 起亦可由 server 触发）

```
gcb export --target json,lua,csharp
 → loadSchemaDir → checkSchema（失败即止，exit 1）
 → 逐表 loadTable（JSONL 解析 + 默认值填充）
 → validateFull（error 级问题即止）
 → 逐 target 插件生成 → 写 export/{json,lua,csharp}/
 → manifest.json（每表每 target 内容哈希）
 → 增量模式：与上次 manifest 对比，跳过未变更条目（M5）
```

### 6.3 Phase 3：热更推送（ws 唯一合法用途）

```
导出完成 → server ws 频道按表广播 { table, version }
 → 游戏侧 C# SDK 订阅 → 拉取该表 JSON → 热重载回调
```

### 6.4 Phase 3+：数据集对比与合并工具

```
输入：两份数据目录 A/B（典型：两个 git 分支的检出）
 → 逐表 JSONL 解析 → 按主键对齐 → 行级 added/removed/changed
 → changed 行展开字段级 diff → 三栏 UI 手动选边
 → 生成合并后 JSONL（规范化排序）→ gcb reindex
```

## 7. server REST API 面（M8 实现，字段级契约在 M8 开工时随实现冻结并回写本节）

| 方法 & 路径 | 用途 |
|---|---|
| `GET /api/schema` | 全量 IR（web 端类型信息、列规格的来源） |
| `GET /api/tables/:table/rows?offset&limit&sort` | 分页窗口数据（含每行 rowHash） |
| `GET /api/tables/:table/rows/:pk` | 单行（peek 抽屉数据源） |
| `GET /api/backrefs/:table/:pk` | 反向引用列表（SQLite fk_edges 反向查询） |
| `PUT /api/tables/:table/rows/:pk` | 保存（乐观并发，见 §6.1） |
| `POST /api/tables/:table/rows` / `DELETE .../rows/:pk` | 行增删（删前返回反引警告） |
| `GET /api/search?q=` | SQLite 文本搜索 |

注意：**没有** `POST /api/validate`——校验在 web 端本地跑（§2），server 只在保存时复验。

## 8. 错误传播与日志约定

- 库层（packages/*）抛 `GcbError { code, message, detail? }`，code 见 docs/04 §5.3；不直接 process.exit、不 console。
- CLI 层捕获 GcbError → 中文摘要 + exit code（0 成功 / 1 校验失败 / 2 用法或内部错误）。
- server 层映射 HTTP：校验失败 422、乐观并发冲突 409、表/行不存在 404，body 均为 `{ errors: ValidationError[] }` 结构。
- web 层网络错误统一走 toast + 重试；内核与渲染层错误不静默吞（开发模式 console.error + 边界提示）。
