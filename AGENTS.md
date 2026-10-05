# AGENTS.md — GLM-5.3-FLASH 执行规范

> 本文件是任何 AI/人在本仓库工作的**第一入口**。每次会话开始先读本文件，再按「文档地图」定位。
> 本文件的规则优先级仅次于用户的当次明确指示。

## 1. 项目是什么

**game-config-builder（GCB）**：内网自部署、强类型、关系感知的 web 游戏配置平台。

策划在类 Excel 的 web 网格里编辑配置；schema 是进 Git 的 YAML 文件；数据是按主键稳定排序的 JSONL 文本文件；校验在**击键时**发生（红绿标记到单元格）；导出 json / lua / c#。

三条核心信条（所有实现决策的最后裁决依据）：

1. **记录集语义，不是自由电子表**：没有公式引擎、没有合并单元格、没有自由布局。
2. **校验前移**：编辑器端与服务端跑**同一个**校验包（同构 TypeScript，见 docs/02 §2）。
3. **文本是真相**：JSONL/YAML 是 source of truth；SQLite 只是可随时删除重建的派生索引，不承载任何不可再生数据。

## 2. 文档地图

| 何时 | 读什么 |
|---|---|
| 开始任何任务卡之前 | `docs/05-roadmap.md`，找到卡片原文与依赖 |
| 写 schema / 校验 / 导出 / 存储相关代码 | `docs/04-schema-and-formats.md`（规范契约，必须逐条对照） |
| 不确定模块归属、接口边界、数据流 | `docs/02-architecture.md` |
| 不理解某个技术决策、想换方案 | `docs/03-adr.md`（先读对应 ADR；推翻它需要用户批准并新增 ADR） |
| 想了解为什么做这个产品 | `docs/01-thesis.md`（论证文档，不影响日常实现） |

## 3. 仓库结构（目标形态，M0 建立）

```
game-config-builder/
├─ AGENTS.md
├─ docs/                      # 本文档集
├─ packages/
│  ├─ schema/                 # @gcb/schema   IR 类型定义、YAML 加载、schema 自检、迁移
│  ├─ validate/               # @gcb/validate 校验引擎 + 表达式 DSL（同构，浏览器/Node 通用）
│  ├─ data/                   # @gcb/data     JSONL 读写、规范化、SQLite 派生索引（Node 专用）
│  ├─ exporter/               # @gcb/exporter 生成器框架 + json/lua/csharp targets（同构）
│  ├─ grid/                   # @gcb/grid     网格纯逻辑内核（框架无关，无 DOM 依赖）
│  └─ cli/                    # @gcb/cli      命令行入口（bin: gcb）
├─ apps/
│  ├─ server/                 # @gcb/server   Fastify API + 数据落盘
│  └─ web/                    # @gcb/web      Svelte 5 编辑器（含 /playground 网格开发场）
├─ examples/
│  └─ demo/                   # gcb init 生成的完整示例项目（schema/ + data/）
└─ pnpm-workspace.yaml
```

依赖方向（禁止反向）：`grid → 无`；`validate → schema`；`data → schema, validate`；`exporter → schema, validate`；`cli → 全部`；`server → schema, validate, data`；`web → schema, validate, grid`。

## 4. 环境与命令

- Node ≥ 20 LTS，pnpm ≥ 9。开发环境为 Windows：所有文本文件一律 LF（由 `.gitattributes` 与 prettier `endOfLine: "lf"` 保证），UTF-8 无 BOM。

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装全部依赖 |
| `pnpm test` | 全 workspace vitest（不含 e2e） |
| `pnpm lint` | eslint + prettier check |
| `pnpm test:update-goldens` | 更新黄金文件快照（仅当卡片明确要求时使用） |
| `pnpm dev:web` | 编辑器开发服（Vite） |
| `pnpm dev:server` | server 开发服（tsx watch） |
| `pnpm cli -- <子命令>` | 本地运行 gcb CLI（如 `pnpm cli -- validate examples/demo`） |
| `pnpm test:e2e` | Playwright e2e + 性能预算（仅 apps/web） |

## 5. 任务卡协议（工作流）

1. 一次只领**一张**卡。在 `docs/05-roadmap.md` 中按 ID（如 `T3.4`）找到卡片全文。
2. 动手前先读：卡片「依赖」指向的已完成产物、卡片「规范章节」引用的 docs/04 条款。
3. TDD：先写会失败的测试，再实现到绿。
4. 完成定义（DoD）——全部满足才算完成：
   - [ ] 卡片「验收」逐条满足
   - [ ] `pnpm test` 全绿；`pnpm lint` 全绿
   - [ ] 涉及 Svelte 的改动：`pnpm --filter @gcb/web check`（svelte-check）绿
   - [ ] 未引入卡片未声明的依赖
   - [ ] 未修改卡片范围之外的公共接口
   - [ ] commit 信息含卡片 ID（如 `feat(schema): T1.2 YAML 解析器`）
5. 失败协议：同一张卡尝试两次仍无法让测试变绿 → **停止**，输出 blocker 说明（卡在哪一步、具体现象、已尝试什么），等待人工介入。禁止为了变绿而删除、跳过或弱化测试。

## 6. 歧义处理铁律（最高优先级）

规范（docs/04）未覆盖、任务卡未写明、或与你已有理解冲突时：**停下来问人**。
禁止自由发挥；禁止「合理推断」后直接修改规范。修改规范本身需要用户批准并记录 ADR。

## 7. 代码规范

### 7.1 TypeScript

- strict 全开；`@typescript-eslint/no-explicit-any` 视为 error
- 纯内核包（`@gcb/grid`、`@gcb/validate`、`@gcb/schema`、`@gcb/exporter`）：**不得** import DOM 或 Node 专有 API（`fs`、`path`、`window`、`document` 等）。Node 专有代码只允许出现在 `@gcb/data`、`@gcb/cli`、`apps/server`
- 优先纯函数；网格内核用无 DOM 依赖的 class + 回调事件（见 docs/02 §4）
- 文件名 kebab-case；类型/类 PascalCase；函数/变量 camelCase；测试文件 `*.test.ts`
- 枚举用 `const 对象 + 类型联合`，不用 `enum` 关键字

### 7.2 Svelte 5（仅 apps/web）

统一使用 runes，禁用一切 Svelte 4 遗留语法：

```svelte
<script lang="ts">
  // props
  let { rows, rowHeight = 28, onCommit } = $props();
  // 状态
  let scrollTop = $state(0);
  // 派生
  let visible = $derived(computeRange(scrollTop, rows.length));
  // 副作用
  $effect(() => { console.log(visible.start); });
</script>
```

- 事件用属性式：`onclick={handle}`（不是 `on:click`）
- 禁用：`export let`、`$:` 派生语句、任何 store（`writable`/`readable`）——新代码一律 runes
- 网格渲染铁律：**行级** `{#each}` 块渲染整行单元格；**不得**为单元格创建独立组件；keyed each；定位用 `transform: translateY(...)`，不用 `top/left`

### 7.3 错误与消息

- 面向用户的校验消息用中文；规则 ID（ruleId）用英文稳定标识
- 错误对象严格遵循 docs/04 §5.3 错误模型

## 8. 测试策略

| 层 | 工具 | 范围 |
|---|---|---|
| 单元 | vitest（每包自带） | 内核 / 解析 / 校验 / 生成器全覆盖 |
| 黄金文件 | vitest + `__goldens__/` | schema→校验报告→导出产物整链快照；`UPDATE_GOLDENS=1` 或 `pnpm test:update-goldens` 更新 |
| e2e / 性能 | Playwright（apps/web） | 编辑器冒烟 + 网格性能预算（M6 验收） |

性能预算是**验收测试**，不是可选 benchmark：不达标 = 卡片未完成。

## 9. Git 约定

- conventional commits：`feat|fix|test|chore|docs|refactor(scope): 描述`
- 一张卡 = 一个或少量几个 commit；不混合无关改动
- 主干开发；短生命周期分支可选

## 10. 永久禁令

1. **不做多人共同编辑**（ADR-9）：任何 ws 广播 / 行锁 / presence 代码不得进入 Phase 2；ws 唯一合法用途是 Phase 3 热更推送
2. **不做公式引擎**（thesis §4.2）：派生列只做「声明表达式 + 只读 + 导出时物化」
3. **不复刻 Excel**：自由单元格、合并单元格、任意格间公式一律拒绝
4. **不给内核包加 DOM/Node 依赖**（§7.1 的包清单）
5. **不引入新依赖**，除非任务卡明确列出名称与用途
6. **不为过测试而改弱测试**
