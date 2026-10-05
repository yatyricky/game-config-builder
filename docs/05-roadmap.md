# 05 · 路线图与任务卡

> 执行规则见 AGENTS.md §5（任务卡协议）。卡片字段：依赖 / 规范（指 docs/04 章节）/ 目标 / 步骤 / 验收 / 测试 / 禁止。
> 阶段理念见 docs/01 §5：Phase 1 = 数据平台核心 + 导出管线（即使编辑器烂尾也独立可用）。

## 0. 总览与依赖

| 阶段 | 里程碑 | 一句话 | 退出标准 |
|---|---|---|---|
| P0 地基 | M0 | monorepo 可测可 lint | CI 全绿，空包骨架就位 |
| P1 数据平台 | M1 | schema YAML → 合法 IR | `gcb check-schema` 对 demo 全绿 |
| P1 | M2 | JSONL 加载 + 基础校验 + 规范化 | `gcb validate` 报告正确（含故意错误夹具） |
| P1 | M3 | 关系层：FK/反向索引/DSL/增量校验 | 增量校验 API 达 5ms 基准 |
| P1 | M4 | 导出 json/lua/csharp | 三 target golden 快照全锁定 |
| P1 | M5 | 增量导出/diff/迁移 v0/init 模板 | demo 项目端到端演示通过 |
| P2 编辑器 | M6 | 网格内核 v0 + 渲染层 | 性能预算测试绿（10 万行 60fps） |
| P2 | M7 | 编辑内核（IME/提交/撤销/粘贴） | playground 可真实编辑合成数据 |
| P2 | M8 | Fastify server + 只读接通真数据 | 浏览器浏览 demo 项目全部表 |
| P2 | M9 | 实时校验回路 | 单元格红绿标记 + 错误面板 |
| P2 | M10 | 关系交互三叉戟 | FK chip/peek/反向引用可用 |
| P2 | M11 | 编辑器完成度 | 策划可日常替代 Excel（单人） |
| P3 增值 | M12–M16 | 热更/合并/ER 图/二进制/候选池 | 见各条目 |

依赖主干：`M0 → M1 → M2 → M3 → M4 → M5`；`M6 ∥ M1–M4`（仅依赖 M0，可用合成数据并行开发）；`M7 → M6`；`M8 → M5 + M7`；`M9 → M8`；`M10 → M9`；`M11 → M10`。

---

## Phase 0 · 工程地基（M0）

#### T0.1 pnpm monorepo 初始化
- **依赖**：无
- **目标**：workspace 就绪。
- **步骤**：根 `package.json`（name `game-config-builder`、private、engines: node≥20 pnpm≥9、scripts 按 AGENTS §4 表）；`pnpm-workspace.yaml` 包含 `packages/*`、`apps/*`；`.npmrc`（shamefully-hoist=false）；`.gitignore`（node_modules、dist、gcb.db、*.tsbuildinfo）；`.gitattributes`（`* text=auto eol=lf`）。
- **验收**：`pnpm install` 成功；`git init` 后 `git status` 干净（不含生成物）。
- **测试**：无（结构性）。
- **禁止**：引入 turbo/nx（ADR-6）。

#### T0.2 TypeScript 基线
- **依赖**：T0.1
- **目标**：全 workspace 统一 TS 配置。
- **步骤**：根 `tsconfig.base.json`（strict 全开、target ES2022、moduleResolution bundler、noUncheckedIndexedAccess、exactOptionalPropertyTypes）；各包/应用 `tsconfig.json` extends。
- **验收**：`pnpm exec tsc -b`（或逐包 `tsc --noEmit`）通过。
- **禁止**：任何包关闭 strict 或按文件豁免。

#### T0.3 vitest 接入
- **依赖**：T0.1
- **步骤**：根装 vitest（workspace root devDep）；每包建 `src/index.ts` 空导出 + `tests/smoke.test.ts`；根 script `test` = `vitest run --all`（递归）。
- **验收**：`pnpm test` 全绿且每包至少 1 条用例被发现。
- **禁止**：把 vitest 装进每个子包（只在 root）。

#### T0.4 eslint + prettier
- **依赖**：T0.1
- **步骤**：typescript-eslint（strict 型配置，`no-explicit-any` error）+ eslint-config-prettier；`.prettierrc`（printWidth 100、singleQuote、trailingComma all、endOfLine lf）；script `lint` = eslint . + prettier --check .。
- **验收**：`pnpm lint` 对现有骨架全绿。
- **禁止**：放宽规则来消警告（修代码，不是修规则）。

#### T0.5 CI workflow
- **依赖**：T0.3、T0.4
- **步骤**：`.github/workflows/ci.yml`：windows-latest + ubuntu-latest 矩阵，pnpm install → lint → test。
- **验收**：YAML 语法合法；（git 远端建立后）双矩阵绿。
- **禁止**：加部署/发布步骤。

#### T0.6 包与应用骨架
- **依赖**：T0.2、T0.3
- **步骤**：按 docs/02 §5 建 6 包 + 2 应用（package.json、tsconfig、src/index.ts 占位、名称 `@gcb/*`）；`apps/web` 用 vite create svelte（Svelte 5，TS）；`apps/server` 空 Fastify hello + `GET /healthz`。
- **验收**：`pnpm dev:web` 出默认页；`pnpm dev:server` 后 `curl /healthz` 200。
- **禁止**：写任何业务逻辑。

---

## Phase 1 · 数据平台核心 + 导出管线（M1–M5）

### M1 Schema IR

#### T1.1 IR 类型定义
- **依赖**：T0.6
- **规范**：§2.2、§3
- **目标**：`@gcb/schema` 导出全部 IR TS 类型（SchemaIr、TableDef、StructDef、EnumDef、UnionDef、FieldDef 及类型字符串 AST）。
- **步骤**：按规范逐字段定义；类型字符串 AST 即 §3.1 文法的判别联合。
- **验收**：类型可表达规范 §2.1 示例全部构造（写一个 `satisfies` 编译期测试）。
- **测试**：`pnpm --filter @gcb/schema test`
- **禁止**：在 IR 中塞运行时状态（IR 是纯数据）。

#### T1.2 YAML → IR 解析
- **依赖**：T1.1
- **规范**：§1、§2.1、§2.2
- **目标**：`loadSchemaDir(dir)` 合并多文件为单 IR，附每定义的来源（文件:行）。
- **步骤**：`yaml` 库逐文件 parse → 浅结构映射到 IR；YAML 错误转 `ValidationError`（ruleId `schema.yaml-parse`，附行号）。
- **验收**：demo schema（T1.5 建立）加载出的 IR 与 golden 一致；坏缩进文件给出含行号的中文错误。
- **禁止**：容忍未知顶层键（报 schema 错误而非忽略）。

#### T1.3 类型引用解析
- **依赖**：T1.2
- **规范**：§3.1
- **目标**：类型字符串 → AST；两遍解析解引用。
- **步骤**：手写递归下降 parser（文法极小）；第一遍收集全类型/表名，第二遍校验引用存在性与 ref 指向 table；检测 struct 循环嵌套（struct 直接或间接包含自身 → schema 错误）。
- **验收**：`ref<Item>` 指向 enum 时报 `schema.bad-ref`；`list<list<int>>` 报深度违规。
- **测试**：vitest 单测覆盖文法每条产生式。
- **禁止**：用正则拆字符串了事（嵌套尖括号会错）。

#### T1.4 schema 自检
- **依赖**：T1.3
- **规范**：§2.3
- **目标**：`checkSchema(ir): ValidationError[]` 覆盖 §2.3 清单全部条目。
- **验收**：为每条自检规则至少 1 正 1 负夹具用例。
- **禁止**：漏报（未知自检情形 → 停下问人，规范 §11）。

#### T1.5 demo 项目与 golden 夹具
- **依赖**：T1.2
- **规范**：§2.1
- **目标**：`examples/demo/schema/` 建立覆盖全部类型构造的 schema（≥4 表：主档表、被引用表、含 union 技能表、含 map/list 嵌套表）+ 空 `data/`。
- **验收**：golden 快照锁定加载后 IR（`__goldens__/schema-ir.json`）。
- **测试**：`pnpm test:update-goldens` 生成后 `pnpm test` 稳定绿。
- **禁止**：demo 里用规范外语法。

#### T1.6 CLI `gcb check-schema`
- **依赖**：T1.4
- **目标**：`gcb check-schema <project>` 输出中文报告（按文件分组），exit code 遵循 docs/02 §8。
- **步骤**：commander 注册子命令；捕获 GcbError 友好输出。
- **验收**：对 demo exit 0；对破坏夹具 exit 1 且错误含文件与行号。

### M2 数据仓库 + 基础校验

#### T2.1 JSONL 逐行解析
- **依赖**：T0.6（规范 §6）
- **目标**：`@gcb/data` `loadTable(schema, table, file)` → `{ rows, errors }`；每行附原始行号。
- **验收**：坏 JSON 行报 `data.jsonl.parse`（含行号）；空文件=0 行合法。
- **禁止**：遇到坏行中断整表（收集全部行错误）。

#### T2.2 结构与类型校验 + 默认值填充
- **依赖**：T2.1、T1.4
- **规范**：§3.2、§5.1–5.3
- **目标**：逐行检查未知字段/类型/枚举成员/map 键/union 形状；缺失字段按默认规则填充或报 `required.missing`。
- **验收**：§5.2 数据域除 fk/unique/rule 外全部 ruleId 有正负用例；填充后的行通过 `canonicalizeRow`（§5.5）。
- **禁止**：修改原始行对象（产出新对象——纯函数）。

#### T2.3 主键唯一 + 规范化落盘
- **依赖**：T2.2
- **规范**：§6
- **目标**：`pk.duplicate` 检查；`normalizeAndWrite(table, rows)` 按 §6 全部规则写出（排序/键序/省略默认/LF/尾换行）。
- **验收**：乱序+冗余默认值的输入文件 normalize 后字节级等于 golden；同内容重复 normalize 幂等。
- **测试**：golden 对比。
- **禁止**：绕过 normalize 的任何写文件路径。

#### T2.4 CLI `gcb validate`
- **依赖**：T2.3
- **目标**：`gcb validate <project> [--fix]`：全表校验 → 分组报告（表 → 行 → 错误）+ 汇总计数控；`--fix` 仅修 `pk.order` 类可修复项。
- **验收**：对故意错误夹具（T2.5）报告逐条命中；--fix 后复查 warning 清零。
- **测试**：CLI 级 vitest（execFile 子进程断言 exit code 与 stdout）。

#### T2.5 校验夹具数据集
- **依赖**：T2.2
- **目标**：`examples/demo/data/` 补充：合法数据（每表含默认值省略写法）+ `examples/broken/`（每类数据错误各 ≥1 行）。
- **验收**：合法集 0 error；broken 集的期望错误清单以 JSON 夹具声明，T2.4 测试逐条比对。
- **禁止**：夹具覆盖不到 §5.2 清单全部 ruleId 的情况。

### M3 关系层 + DSL

#### T3.1 DSL 词法分析
- **依赖**：T0.6
- **规范**：§4.1
- **目标**：`@gcb/validate` tokenizer：数字/字符串/标识符/运算符/括号/逗号，跳过空白，附位置。
- **验收**：非法字符报错含列号；`&&`/`||`/`==` 等双字符运算符不误拆。

#### T3.2 DSL 语法分析 → AST
- **依赖**：T3.1
- **规范**：§4.1
- **目标**：递归下降 parser 输出判别联合 AST；优先级严格按文法。
- **验收**：每条产生式正负用例；`(1+2)*3` 与 `1+2*3` 树形正确（快照断言）。

#### T3.3 DSL 编译期类型检查 + 求值器
- **依赖**：T3.2、T1.4
- **规范**：§4.2、§4.3
- **目标**：`compileRule(expr, fieldScope)` → 类型检查（未定义标识符、类型不匹配、枚举成员解析 → `rule.compile`）+ 编译产物；`evalRule(compiled, row)` 求值（除零按违规）。
- **验收**：`quality == White` 正确解析枚举；`name + 1` 编译期拒绝；内置函数全表覆盖。
- **禁止**：用 `eval`/`new Function`（必须 AST 解释器）。

#### T3.4 规则接入校验引擎
- **依赖**：T3.3、T2.2
- **规范**：§4.4、§5.2
- **目标**：`validateFull(schema, rowsByTable)`：字段 rule + rowRules（severity/message 模板）纳入流水线，产出 ValidationError[]。
- **验收**：demo 数据故意违反 `price-quality` warning 与字段 rule error，报告正确含字段值插值。

#### T3.5 FK 存在性
- **依赖**：T2.3
- **规范**：§5.4
- **目标**：拓扑序校验 `ref<T>`；同表自引用两遍法。
- **验收**：跨表缺引用、自引用缺失均报 `fk.missing` 且定位在引用行；环状 schema（A↔B）不死循环。
- **测试**：`pnpm --filter @gcb/validate test`

#### T3.6 SQLite 派生索引
- **依赖**：T2.3
- **规范**：§9
- **目标**：`@gcb/data` Reindexer：建表 DDL、全量重灌（tables/rows/fk_edges）；`gcb reindex <project>`；反引查询函数。
- **验收**：reindex 后 `fk_edges` 行数=全库 ref 出边总数（夹具核对）；反查 demo 某道具被引用清单正确；删 gcb.db 重建结果幂等。
- **禁止**：把派生索引当读路径的强制依赖（校验/导出不得依赖 db 存在）。

#### T3.7 增量校验 API
- **依赖**：T3.4、T3.5
- **规范**：§5.6
- **目标**：`validateIncremental(...)`；变更行集合 → 最小重算集（行内规则/唯一分组/出边+入边 FK）。
- **验收**：正确性——与 validateFull 在相同数据上对变更行产出一致错误集合；性能——单行变更 ≤5ms（10⁵ 行夹具，vitest 超时断言）。
- **禁止**：图省事退化为全量重算（性能断言会红，别改断言）。

### M4 导出生成器

#### T4.1 导出框架
- **依赖**：T3.4
- **规范**：§8.1
- **目标**：`runExport(schema, data, { targets, outDir })`：前置校验 → 逐 target 插件 → 写文件 + manifest。
- **验收**：含 error 的数据集拒绝导出且无部分产物（先写临时目录成功后原子替换）；`TargetPlugin` 接口编译期类型就位。
- **禁止**：生成器内读环境（ADR-7 纯函数要求）。

#### T4.2 JSON 生成器
- **依赖**：T4.1
- **规范**：§8.2
- **验收**：demo 全表输出与 golden 字节级一致（enum→int、键序、union 编码、float 往返）。

#### T4.3 Lua 生成器
- **依赖**：T4.1
- **规范**：§8.3
- **验收**：golden 字节级一致（转义、缩进、尾逗号、主键键形式）；输出可被 `luac -p`（若环境有）或内置语法冒烟校验。
- **禁止**：手拼字符串拼接转义不过关——转义函数必须单测穷举特殊字符。

#### T4.4 C# 生成器（类型部分）
- **依赖**：T4.1
- **规范**：§8.4
- **目标**：每表/enum/struct/union 生成 .cs（PascalCase 映射、union 抽象类体系）。
- **验收**：golden 快照；命名映射表逐行有单测。
- **测试**：`pnpm --filter @gcb/exporter test`

#### T4.5 C# Tables + Loader
- **依赖**：T4.4
- **规范**：§8.4
- **目标**：`Tables.cs`（Rows/Get）+ `TablesLoader.cs`（System.Text.Json、int 键 map 转换、union 多态、ConfigException）。
- **验收**：golden；（有 dotnet 环境时）对 demo 生成物 `dotnet build` 编译通过脚本，无环境则跳过并注明。

#### T4.6 CLI `gcb export` + 全链 golden
- **依赖**：T4.2–T4.5
- **目标**：`gcb export <project> --target json,lua,csharp --out <dir>`；demo 三 target 全树进 golden。
- **验收**：连续两次导出产物字节级一致（确定性）；golden 更新需在卡片中显式声明。

### M5 工程化收官

#### T5.1 增量导出
- **依赖**：T4.6
- **规范**：§8.5
- **验收**：改 1 表 1 行后重导，仅该表三 target 文件 mtime 变化；首次导出=全量。
- **禁止**：时间戳进产物（破坏确定性）。

#### T5.2 导出 diff 报告
- **依赖**：T4.6
- **目标**：`gcb diff <project> [--baseline <manifest>]` → Markdown：按表 added/removed/changed（字段级）。
- **验收**：构造 A→B 变更集，报告与手工预期一致（golden）。

#### T5.3 迁移 v0
- **依赖**：T2.3
- **规范**：§10
- **目标**：`gcb migrate <project>`：rename-field / retype-field、`.gcb-state.json`、失败行全列后中止。
- **验收**：demo 演：加价字段改名迁移 → 数据键重写 + normalize + reindex；retype 夹具含不可转行 → 中止且零写入。

#### T5.4 `gcb init` 模板
- **依赖**：T4.6
- **目标**：`gcb init <dir>` 复制最小可用模板（2 表 schema+数据+README 快速上手）。
- **验收**：init 后 `gcb check-schema && gcb validate && gcb export` 三连通过。

---

## Phase 2 · 编辑器与自研网格（M6–M11）

> 前置阅读：docs/02 §4（双层架构）、AGENTS §7.2（Svelte 铁律）。

### M6 网格内核 v0 + 渲染层（任务卡化，风险最高故最细）

#### T6.1 内核状态骨架
- **依赖**：T0.6（不依赖 Phase 1，可并行）
- **目标**：`@gcb/grid` `GridModel` 类：构造参数（rowCount/columns/rowHeight）/GridEvents 回调（docs/02 §4 草图）/状态只读快照方法。
- **验收**：无 DOM import（eslint 边界规则或 lint 检查通过）；状态转移全部有单测。
- **禁止**：内核中出现 `window`/`document`/`HTMLElement` 字样。

#### T6.2 布局引擎
- **依赖**：T6.1
- **目标**：固定行高；列宽数组 + 首列冻结；`visibleRange(scrollTop, viewportH, overscan=5)` 纯函数。
- **验收**：边界（顶部/底部/overscan 越界钳制）单测穷举。

#### T6.3 Svelte 渲染层
- **依赖**：T6.2
- **目标**：`Grid.svelte`：滚动容器 + 总高 spacer + `translateY` 定位行容器 + **行级** keyed each 渲染整行单元格。
- **验收**：playground（`/playground` 路由）展示 1 万行合成数据；DOM 中行节点数 ≈ 可见+overscan（断言写进 Playwright）。
- **禁止**：每单元格一个组件；`top/left` 定位。

#### T6.4 水平虚拟化与滚动集成
- **依赖**：T6.3
- **目标**：宽表（>40 列）水平窗口化；scroll 事件 → 内核 scrollTop 状态 → onViewportChange。
- **验收**：100 列表 DOM 列节点数受窗口约束。

#### T6.5 选择模型
- **依赖**：T6.1
- **目标**：单选/区域（shift）/多区（ctrl）/整行整列；锚点-焦点矩形语义；选择区快照可序列化。
- **验收**：键盘+鼠标路径单测；区域含负向拖拽（上→下、右→左）。

#### T6.6 键盘导航
- **依赖**：T6.5
- **目标**：方向键/Home/End/PageUp/PageDown/Ctrl+Home/End；焦点格子（cursor）与滚动跟随（保证可见）。
- **验收**：全部键位单测；滚动跟随用布局纯函数断言。

#### T6.7 性能预算测试（验收级）
- **依赖**：T6.4
- **目标**：Playwright：10 万行 × 30 列合成数据，程序化滚动全表，统计帧率与长任务。
- **验收**：平均 ≥55fps 且无 >50ms 长任务；不达标卡片不算完成（thesis R5）。
- **禁止**：改弱阈值数字。

### M7 编辑内核

#### T7.1 编辑状态机
- **依赖**：M6 完成
- **目标**：idle → editing（含初始值/全选态）→ commit|cancel；双击/Enter/F2/直接键入进入；Esc 取消；Tab/Enter 提交并移动。
- **验收**：状态转移表全单测（含非法转移防御）。

#### T7.2 DOM 编辑浮层（IME 关键）
- **依赖**：T7.1
- **目标**：`EditOverlay.svelte`：原生 `<input>` 精确定位到目标格；focus/focusout 管理；compositionstart/end 全程不打断（中文输入法回车确认不误提交）。
- **验收**：Playwright 用 `input_ime` 模拟或 composition 事件注入：合成期间 Enter 不触发 commit；日文/中文路径冒烟。
- **禁止**：用 keydown 全局拦截吃掉 IME 键。

#### T7.3 提交协议
- **依赖**：T7.1
- **目标**：commit(raw) → parse（按列类型）→ 失败则浮层保持+错误提示；成功 → onEditCommit 交上层（playground 中接合成数据 store 并回写）。
- **验收**：int 列输 `abc` 拒绝且不丢编辑内容；enum 列后续接下拉（M10）。

#### T7.4 撤销/重做
- **依赖**：T7.3
- **目标**：HistoryStack 命令式（单格编辑/区域批量）；上限 100；Ctrl+Z/Y。
- **验收**：跨编辑/撤销/重做的序列单测；playground 手测路径写入 Playwright 冒烟。

#### T7.5 区域粘贴与拖拽填充
- **依赖**：T7.4
- **目标**：TSV 粘贴解析到选择区（越界裁剪或扩展，按规范问询结果——默认裁剪）；选区角点拖拽填充（复制/序列两种，数字列序列）。
- **验收**：粘贴矩阵映射单测（含不规则形状）；填充模式单测。
- **注**：本卡完成后，playground 增加「只读加载 examples/demo 数据」页签（fetch 静态 JSONL，跑 parser），呼应 thesis §5「数据尽早可见」。

### M8 Fastify server + 只读接通（里程碑级）

任务要点：`GET /api/schema`；`GET /api/tables/:table/rows`（分页窗口 + rowHash）；单行/反引/搜索端点（docs/02 §7 全表）；静态托管 web 构建；`gcb reindex` 启动集成（schema_hash 不符自动重建）。
**验收**：浏览器中浏览 demo 项目全部表（虚拟滚动拉窗口数据）；点击行展开详情与反向引用面板（只读）；`/healthz` 200。编辑入口隐藏（未实现）。

### M9 实时校验回路（里程碑级）

任务要点：web 引入 `@gcb/validate`（同构直用）；编辑提交 → 本地行更新 → debounce 300ms `validateIncremental`；单元格红/黄角标 + 行错误汇总列；底部错误面板（点击跳转定位）。
**验收**：demo 中制造类型错误、规则违规、FK 断链（改主键），标记在 ≤1s 内出现且与 `gcb validate` 报告一致；5ms 基准在浏览器实测复核。

### M10 关系交互三叉戟（里程碑级）

任务要点：FK chip 单元格（displayField 摘要）→ peek 右侧抽屉（多层钻取 + 面包屑，抽屉内行可编辑，走 M9 回路）；反向引用面板（删除前强提示被引清单）；enum 下拉编辑器（符号名）；`list<struct>` 子网格覆盖面板（行详情内嵌套网格，复用 Grid.svelte）；union 编辑器（先选变体再展开子表单）。
**验收**：thesis §3 三场景可演示：钻取数据链 2 次点击达任意深度；删被引行被拦截并列出引用方；嵌套结构增删改不碰竖线编码（根本没有这东西）。

### M11 编辑器完成度（里程碑级）

任务要点：行增删（含主键生成策略提示）；表切换侧栏；列宽拖拽 + 持久化（localStorage）；服务端搜索/过滤接入；保存流程（PUT + baseRowHash 409 处理 UI）；`PUT/POST/DELETE` 服务端实现（docs/02 §6.1 时序）；xlsx 导入桥接（SheetJS 只读导入向导：列映射预览 → 走同一校验管线 → 落盘）；键盘快捷键帮助。
**验收**：一名策划在浏览器内独立完成「改数值 → 看校验 → peek 核对引用 → 保存 → 导出 → 拿到 json/lua/cs」全流程，全程不开 Excel。

---

## Phase 3 · 增值（M12+，粗粒度，实施前细化成卡）

| 里程碑 | 内容 | 动机与验收要点 |
|---|---|---|
| M12 热更推送 | ws 通道（server→游戏单向）：导出完成按表广播版本；C# SDK 订阅+拉取+热重载回调 | 配置迭代从分钟级到秒级；验收：Unity/控制台 demo 改表 3s 内生效 |
| M13 ER 图 + schema 编辑器 | svelte-flow：schema 级 ER 图（节点=表/边=FK）只读 → 图形化编辑（增删表/字段/关系落盘为合法 IR YAML，ADR-5/8） | schema 演化对策划开放；验收：图形操作产出的 YAML 与手写等价（golden 互检） |
| M14 数据集对比与合并工具 | 两份数据目录的表/行/字段三级 diff + 三栏选边 UI + 合并落盘 + reindex（ADR-9） | 跨人/跨分支合并；验收：构造分叉数据集，合并结果与预期一致且可 reindex |
| M15 二进制导出 + 零拷贝 | 新 TargetPlugin：固定布局二进制 + 生成 C# overlay struct 零拷贝访问 | 对标/超过 tabtoy 性能档；验收：加载耗时与 GC 对比 json 档有量化优势 |
| M16 候选池（按需排期） | overlay 环境合成、审计日志（server 追加 JSONL）、text 本地化管线、数据级血缘图、CRDT 研究（不承诺） | 各自独立 ADR 后启动 |

---

## 附：执行顺序建议

1. 严格串行：M0 → M1 → M2 → M3 → M4 → M5 → M7 →（M8 起）。
2. M6 可在 M1 起并行（另一会话/另一人），但 T6.7 性能验收必须在其并行的 Phase 1 卡片之外独立通过。
3. 每完成一个里程碑：跑全量 `pnpm test` + 更新本文件的卡片勾选状态（`- [x]`），并在 commit 信息引用里程碑号。
