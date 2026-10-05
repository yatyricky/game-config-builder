# 03 · 技术选型决策记录（ADR）

> 每条：背景 → 候选 → 决策 → 理由 → 后果。推翻任何一条都需要用户批准并新增一条 ADR 记录推翻原因。
> 调研事实截至 2026-10。

---

## ADR-1 语言与运行时：全栈 TypeScript

**背景**：校验引擎必须同时运行在浏览器（编辑时增量校验）与服务端（保存/导出复验），且语义必须逐字段一致。

**候选**：TypeScript 全栈；Rust/Go 后端 + TS 前端；C# 全栈（Blazor）。

**决策**：TypeScript 全栈（Node ≥ 20）。

**理由**：
1. **同构校验是架构灵魂**（docs/02 §2）。双语言方案 = 两份语义等价的校验实现，必然漂移；漂移的校验比没有校验更危险。
2. GLM-5.3-FLASH 对 TS/生态的训练数据量最大，生成代码可靠性与可维护性最高。
3. 性能疑虑不成立：导出是低频操作，Node 处理 10⁵ 行解析 + 生成在秒级；编辑器热路径（校验求值、网格更新）本来就在浏览器。
4. 真出现导出性能瓶颈，导出器有独立 CLI 契约，可单点换语言而不动架构。

**后果**：放弃 Rust/Go 的类型系统表达力；`long`（int64）因 JS Number 精度（>2⁵³）从 v1 类型系统中移除（docs/04 §3），需要大整数主键时再以字符串主键方案评估。

---

## ADR-2 网格：自研，Svelte 5 + DOM 虚拟滚动 + 纯逻辑内核分离

**背景**：编辑器体验（chip、peek、红绿标记、IME）是产品差异化核心（thesis §3），网格是其地基。

**候选**：Glide Data Grid（canvas）；AG Grid Community；Univer；自研 canvas；自研 Svelte + DOM 虚拟滚动。

**决策**：自研。**纯逻辑内核**（框架无关 TS，无 DOM 依赖）+ **Svelte 5 DOM 渲染薄层**。v1 固定行高窗口化。

**理由**：
1. 工作负载是 10²–10⁵ 行配置表而非 10⁶ 电子表；窗口化后可见 DOM ≈ 1200 节点，Svelte（无 VDOM、编译期优化）余量充分。
2. 编辑体验在 DOM 是原生能力（IME、下拉、无障碍），在 canvas 全是手动画布代码；策划天天打中文，IME 是最高频路径。
3. DOM 可用选择器断言测试（Playwright），canvas 只能截图金样，脆弱且对弱模型不友好。
4. 自研的范围被 OUT 清单钉死（无公式/无合并单元格/无自由布局），是有界问题。
5. 外部库弃选理由：Glide Data Grid 维护节奏放缓（5.4k stars，6.0 长期 alpha，最近提交 2026-01 但发布停滞），且同样面临 canvas 的 IME/测试问题；AG Grid 体积大、深度自定义渲染繁琐、训练语料中社区版与企业版特性常被混淆；Univer 是「复刻 Excel」路线，与记录集语义的产品哲学相反。

**后果**：
- 承担网格工程量风险（thesis R1），以 M6/M7 任务卡化 + 性能预算验收（10 万行 × 30 列 60fps、无 >50ms 长任务）对冲。
- 渲染层是薄层、内核可测，极端情况下渲染层可整体更换（canvas 或第三方库）而内核与上层不动。
- 必须遵守 Svelte 5 runes 规范并禁用 Svelte 4 遗留语法（AGENTS §7.2），弱模型训练语料中旧语法占比高。

---

## ADR-3 服务端：Fastify + better-sqlite3，无实时通道

**背景**：Phase 2 需要一个内网自部署的 API 服务；明确不做多人共编（ADR-9）后无实时需求。

**候选**：Fastify；Express；NestJS；Hono。

**决策**：Fastify（+ `@fastify/static` 托管编辑器静态资源）+ better-sqlite3。

**理由**：
1. Fastify：schema 优先、TypeScript 支持一流、生态成熟、性能冗余大；相对 NestJS 无装饰器/ DI 心智负担（对弱模型更友好），相对 Express 内置校验与日志更现代。
2. better-sqlite3：同步 API 最适合单进程读写派生索引；预编译二进制在 Windows 安装顺畅；SQLite 是全项目唯一原生依赖。
3. 无 ws、无锁、无 presence——单人编辑模型（ADR-9）使服务端保持极小。

**后果**：server 是薄 API 层（docs/02 §7），业务逻辑全部在 packages 里被测试覆盖；Phase 3 热更推送再引入 `ws`，且仅此用途。

---

## ADR-4 存储：JSONL 为 source of truth，SQLite 为派生索引

**背景**：配置要可 diff、可回滚、可分支实验、离线可审视；同时 peek/反向引用需要常驻索引。

**候选**：单一 SQLite（数据入库）；纯 JSON/JSONL 文件 + 内存索引；JSONL + SQLite 派生索引。

**决策**：JSONL（每表一文件，按主键稳定排序）+ SQLite 派生索引（可随时删除重建，gitignore）。

**理由**：
1. 文本是真相：git diff/branch/merge 直接可用；策划可以开分支做实验性数值；事故恢复 = git revert。
2. 索引只是缓存：FK 正反向、行哈希、搜索都能从 JSONL 全量重算，`gcb reindex` 一条命令重建——不存在「数据库坏了数据也坏了」。
3. 每表一文件缩小 diff 噪声与合并冲突面；按主键排序保证同内容文件字节级稳定（golden 测试的前提）。

**后果**：写路径必须「规范化后落盘」（排序、键序、省略默认值），任何绕过 `@gcb/data` 的写文件都是 bug；合并工具因此完全不涉及数据库合并算法（ADR-9）。

---

## ADR-5 Schema 载体：YAML 文件进 Git，多编辑入口落盘为同一 IR

**背景**：schema 是程序与策划共同的演化对象，必须可版本控制、可 review、可被任何工具消费。

**候选**：C# struct 作 schema；表格化 schema（tabtoy types 式）；图形化编辑器私有存储；结构化 IR 文本（YAML/JSON）。

**决策**：结构化 IR 的 YAML 文件为 source of truth（`schema/` 目录）。Phase 1 程序手写；Phase 3 图形化 schema 编辑器（ER 图）的每次 UI 操作落盘为同一 IR。

**理由**：
1. C# struct 把策划排除在 schema 演化外，且把编辑器架构绑死在语言反射/编译流水线上。
2. 表格化 schema 的表达力在嵌套 struct / list / union 处崩塌，schema 本身变成最难编辑的表。
3. YAML diff 友好、注释友好、人可直读；JSON 保留为机器可消费形态（`GET /api/schema` 直接吐 IR）。

**后果**：YAML 有缩进敏感的天然风险，以 schema 自检 + 精确错误定位（文件/行号）对冲（T1.4）；字段级语法契约冻结于 docs/04 §2，防弱模型自造语法。

---

## ADR-6 工具链：pnpm workspace + Vite + vitest + Playwright + eslint/prettier + tsx/tsup

**决策**：
- monorepo：pnpm workspace（不用 turbo/nx——包数量 ≤ 8，构建图简单，多一层工具对弱模型是净负担）。
- web：Vite + Svelte 5 + `svelte-check`；开发 `tsx watch`（server/cli 直跑 TS）。
- 测试：vitest（每包）+ Playwright（仅 apps/web 的 e2e 与性能预算）。
- 质量：eslint（typescript-eslint strict）+ prettier（LF、printWidth 100）；CI 跑 lint + test 全矩阵。

**理由**：全部是各自类别的事实标准、文档与训练语料最丰富、互相组合零胶水。刻意不引入更多构建抽象。

**后果**：内部包不独立构建（消费方编译 TS 源码），仅 CLI 用 tsup 出 dist；包数量增长到显著规模时再评估任务编排工具（届时走新 ADR）。

---

## ADR-7 导出器：插件式 target 架构 + 内容哈希增量

**决策**：`TargetPlugin` 接口（`generate(ctx): OutputFile[]`），json / lua / csharp 各自一个插件；`manifest.json` 记录每表每 target 的内容哈希，增量导出只重写变更条目；导出前置全量校验（error 级即止）。

**理由**：
1. 新 target（bin、godot、自定义）= 新插件，不动管线。
2. 哈希增量把「全量重导」的分钟级压到秒级，与 Phase 3 热更推送衔接。
3. 导出即编译：校验通过才有产物，保证产物永远可信。

**后果**：生成器必须纯函数化（IR + 数据 → 字符串），禁止读写环境状态——这是 golden 快照测试的前提（AGENTS §8）。

---

## ADR-8 ER 图与图形化 schema 编辑器：svelte-flow（Phase 3）

**决策**：Phase 3 的 schema 级 ER 图（节点=表、边=FK）与图形化 schema 编辑器使用 `@xyflow/svelte`（svelte-flow）。

**理由**：xyflow 团队出品，1.0 于 2025-05 发布、原生 Svelte 5、MIT、活跃维护；自研图编辑器（拖拽布线、缩放、小地图）工程量远超收益。数据级血缘图（选中行展开邻域）仍在 Phase 3 末评估，与 schema ER 图分开决策。

**后果**：Phase 3 才引入该依赖；图形操作的每次落盘都是合法 IR YAML（ADR-5），不存在图形私有格式。

---

## ADR-9 协作模型：明确不做多人共编；单人 + 哈希乐观护栏；后期独立合并工具

**背景**：CHAT.md 原倾向「行级悲观锁 + ws 广播」。用户拍板推翻：策划多人同时配同一张表现实价值 ≈ 0，实时共编的成本（CRDT/OT、冲突语义、测试面）却是全项目最高量级。

**决策**：
1. **不做**多人共编、实时广播、行锁、presence。永久禁令写入 AGENTS §10。
2. Phase 2 单人编辑。唯一护栏：保存时行哈希乐观并发（`baseRowHash` ≠ 当前行哈希 → 409 + 返回当前行），防同一人双开标签页静默覆盖。行哈希 = 对「按 schema 键序、默认值填充后的规范 JSON」取 sha256，无额外存储（哈希本身存派生索引）。
3. 跨人合并 = git 分支 + 后期独立「数据集对比与合并工具」：两份 JSONL 目录的表/行/字段三级语义 diff + 手动选边 + 规范化落盘 + `gcb reindex`。
4. ws 唯一保留用途：Phase 3 热更推送（server→游戏单向）。
5. CRDT/实况共编：远期研究项，不承诺，不设计预留接口（避免过度设计）。

**理由**：数值表通常单一负责人；文本 JSONL 使 git 工作流天然可用；合并工具操作的是文本数据，SQLite 派生索引重建即可——「数据库不好合并」的问题在这个架构里根本不出现。

**后果**：server 无状态化、无实时通道，复杂度大降；多人「先后」编辑同一表时以 409 + 刷新解决，可接受；合并工具成为 Phase 3+ 的明确排期项（docs/05 M14）。
