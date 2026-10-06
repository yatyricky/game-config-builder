<script lang="ts">
  // /edit（M8-M10）：表切换侧栏 + 网格编辑 + 同构实时校验 + FK chip/peek + 反向引用面板。
  import { onMount } from 'svelte';
  import Grid from '../lib/Grid.svelte';
  type CellCoord = { row: number; col: number };
  import { exposeForDebug } from '../lib/session';
  import {
    cellText,
    loadProjectSession,
    parseCellInput,
    saveRow,
    validateSessionAll,
    validateSessionIncremental,
    type ProjectSession,
    type TableSession,
    type ValidationResult,
  } from '../lib/session';

  let session: ProjectSession | undefined = $state();
  // 单一事实源：currentTable 从 session 派生（独立 $state 会被深拷贝，编辑写丢失）
  let currentTableName = $state<string | undefined>();
  const currentTable = $derived(
    session !== undefined && currentTableName !== undefined
      ? session.tables.get(currentTableName)
      : undefined,
  );
  let tableNames: string[] = $state([]);
  let loadError = $state('');

  let gridRows = $state<Array<{ pk: string; cells: string[] }>>([]);
  let validation = $state<ValidationResult>({ errors: [], byCell: new Map() });
  let statusText = $state('加载中…');
  let saving = $state(false);

  function rebuildGridRows(ts: TableSession): void {
    if (session === undefined) return;
    gridRows = ts.rows.map((r) => ({
      pk: r.pk,
      cells: ts.columns.map((c) => {
        const value = r.row[c.name];
        if (c.ast.kind === 'ref' && value !== undefined && value !== null) {
          // FK chip 文本：display #pk（thesis §3.2）
          const target = String(value);
          return `${displayOf(c.ast.tableName, target)} #${target}`;
        }
        return cellText(c.ast, value);
      }),
    }));
  }

  function selectTable(name: string): void {
    if (session?.tables.get(name) === undefined) return;
    currentTableName = name;
    const ts = session.tables.get(name);
    if (ts === undefined) return;
    rebuildGridRows(ts);
    validation = validateSessionAll(session);
    statusText = `${ts.rows.length} 行 / ${validation.errors.filter((e) => e.severity === 'error').length} 错误`;
  }

  onMount(async () => {
    try {
      session = await loadProjectSession();
      tableNames = [...session.tables.keys()].sort();
      exposeForDebug(session);
      const first = tableNames[0];
      if (first !== undefined) selectTable(first);
    } catch (err) {
      loadError = `无法连接 gcb server（请先运行 pnpm dev:server）：${err instanceof Error ? err.message : String(err)}`;
    }
  });

  // ---------- M9：编辑提交 → parse → 本地更新 → debounce 增量校验 ----------
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function handleCommit(coord: CellCoord, raw: string): string | null {
    if (currentTable === undefined || session === undefined || currentTableName === undefined) return '未加载';
    // 从 session 树直接取行（写必须落单一事实源）
    const ts = session.tables.get(currentTableName);
    if (ts === undefined) return '未加载';
    if (ts === undefined) return '未加载';
    const col = ts.columns[coord.col];
    const editorRow = ts.rows[coord.row];
    if (col === undefined || editorRow === undefined) return '越界';
    const parsed = parseCellInput(col.ast, session.ir, raw);
    if (!parsed.ok) return parsed.error;
    // 不可变替换：绕开 $state 深代理的嵌套属性写（实测会丢写）
    editorRow.row = { ...editorRow.row, [col.name]: parsed.value };
    editorRow.dirty = true;
    // 本地乐观显示
    const gridRow = gridRows[coord.row];
    if (gridRow !== undefined) gridRow.cells[coord.col] = raw;
    // debounce 300ms 增量校验（§5.6）
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (session === undefined) return;
      console.log('[dbg] pk=', editorRow.pk, 'price=', JSON.stringify(editorRow.row['price']), 'dirty=', editorRow.dirty);
      validation = validateSessionIncremental(session, { table: ts.name, keys: [editorRow.pk] });
      console.log('[dbg] result=', validation.errors.map((x) => x.ruleId + '@' + x.fieldPath).join(','));
      const errorCount = validation.errors.filter((e) => e.severity === 'error').length;
      statusText = `${ts.rows.length} 行 / ${errorCount} 错误 / ${ts.rows.filter((r) => r.dirty).length} 未保存`;
    }, 300);
    return null;
  }

  // ---------- M11：保存流程（PUT + 409 刷新） ----------
  async function saveDirty(): Promise<void> {
    if (currentTable === undefined || currentTableName === undefined) return;
    const tableName = currentTableName;
    saving = true;
    try {
      const dirty = currentTable.rows.filter((r) => r.dirty);
      let conflicts = 0;
      let failures = 0;
      for (const row of dirty) {
        const result = await saveRow(tableName, row);
        if (!result.ok) {
          if (result.conflict === true) conflicts++;
          else failures++;
        }
      }
      rebuildGridRows(currentTable);
      if (session !== undefined) validation = validateSessionAll(session);
      statusText = conflicts > 0
        ? `${conflicts} 行被他人修改（409，已刷新为服务器版本）`
        : failures > 0
          ? `${failures} 行保存失败`
          : `已保存 ${dirty.length} 行`;
    } finally {
      saving = false;
    }
  }

  // ---------- M10：FK chip / peek / 反向引用 ----------
  let peekChain = $state<Array<{ table: string; pk: string; display: string }>>([]);
  let backrefs = $state<Array<{ fromTable: string; fromPk: string; fromField: string }>>([]);
  let peekLoading = $state(false);

  function displayOf(tableName: string, pk: string): string {
    const ts = session?.tables.get(tableName);
    if (ts === undefined) return `${tableName}#${pk}`;
    const row = ts.rows.find((r) => r.pk === pk);
    if (row === undefined) return `${tableName}#${pk}（缺失）`;
    const displayField = ts.table.displayField;
    return String(row.row[displayField] ?? pk);
  }

  function isRefCol(colIndex: number): boolean {
    return currentTable?.columns[colIndex]?.ast.kind === 'ref';
  }

  function refTarget(colIndex: number): { tableName: string } | null {
    const ast = currentTable?.columns[colIndex]?.ast;
    if (ast === undefined || ast.kind !== 'ref') return null;
    return { tableName: ast.tableName };
  }

  async function openPeek(rowIdx: number, colIdx: number): Promise<void> {
    if (currentTable === undefined) return;
    const target = refTarget(colIdx);
    const editorRow = currentTable.rows[rowIdx];
    if (target === null || editorRow === undefined) return;
    const ast = currentTable.columns[colIdx]?.ast;
    const pk =
      ast !== undefined && ast.kind === 'ref' ? String(editorRow.row[currentTable.columns[colIdx]?.name ?? ''] ?? '') : '';
    await openPeekTable(target.tableName, pk);
  }

  async function openPeekTable(tableName: string, pk: string): Promise<void> {
    peekChain = [...peekChain, { table: tableName, pk, display: displayOf(tableName, pk) }];
    peekLoading = true;
    try {
      const res = await fetch(`/api/backrefs/${tableName}/${pk}`);
      const body = (await res.json()) as { backrefs: typeof backrefs };
      backrefs = body.backrefs;
    } catch {
      backrefs = [];
    } finally {
      peekLoading = false;
    }
  }

  function closePeekLevel(): void {
    peekChain = peekChain.slice(0, -1);
    backrefs = [];
  }

  function closePeekAll(): void {
    peekChain = [];
    backrefs = [];
  }

  // 校验标记 → 单元格错误 class（Grid 需要 per-cell class 扩展：经 cells 前缀传递）
  function cellClassName(rowIdx: number, colIdx: number): string {
    if (currentTable === undefined) return '';
    const editorRow = currentTable.rows[rowIdx];
    const col = currentTable.columns[colIdx];
    if (editorRow === undefined || col === undefined) return '';
    const severity = validation.byCell.get(`${editorRow.pk}|${col.name}`);
    if (severity === 'error') return 'cell-error';
    if (severity === 'warning') return 'cell-warning';
    if (editorRow.dirty) return 'cell-dirty';
    return '';
  }

  let errorPanelOpen = $state(true);
</script>

<main>
  <header>
    <h1>GCB 编辑器</h1>
    <a href="/playground">playground</a>
    {#if loadError !== ''}
      <p class="error-banner">{loadError}</p>
    {:else if session !== undefined}
      <span>{statusText}</span>
      <button type="button" disabled={saving} onclick={saveDirty}>保存（PUT + 哈希护栏）</button>
      <button type="button" onclick={() => (errorPanelOpen = !errorPanelOpen)}>
        错误面板（{validation.errors.length}）
      </button>
    {/if}
  </header>

  <div class="layout">
    <nav>
      <ul>
        {#each tableNames as name (name)}
          <li>
            <button
              type="button"
              class:active={currentTable?.name === name}
              onclick={() => selectTable(name)}
            >
              {name}
            </button>
          </li>
        {/each}
      </ul>
    </nav>

    <section class="grid-area">
      {#if currentTable !== undefined && session !== undefined}
        <Grid
          columns={currentTable.columns.map((c) => ({
            name: c.name,
            width: c.name === currentTable?.table.primaryKey ? 90 : 130,
          }))}
          rows={gridRows}
          rowHeight={28}
          onCommit={handleCommit}
          cellClassName={cellClassName}
          onCellClick={(rowIdx, colIdx) => {
            if (isRefCol(colIdx)) void openPeek(rowIdx, colIdx);
          }}
        />
      {:else}
        <p>{loadError !== '' ? '' : '加载中…'}</p>
      {/if}
    </section>

    {#if errorPanelOpen}
      <aside class="error-panel">
        <h2>校验错误（{validation.errors.length}）</h2>
        <ul>
          {#each validation.errors.slice(0, 50) as e, i (i)}
            <li class={e.severity}>
              <b>{e.table}#{e.rowKey || '—'}</b> {e.fieldPath || '（表级）'}
              <span class="rule">{e.ruleId}</span>
              {e.message}
            </li>
          {/each}
        </ul>
      </aside>
    {/if}

    {#if peekChain.length > 0}
      <aside class="peek">
        <div class="crumbs">
          {#each peekChain as level, i (i)}
            <span class="crumb">{level.table}#{level.pk} · {level.display}</span>
            {#if i < peekChain.length - 1}<span>›</span>{/if}
          {/each}
          <button type="button" onclick={closePeekLevel}>‹ 返回</button>
          <button type="button" onclick={closePeekAll}>✕</button>
        </div>
        <h3>反向引用（{backrefs.length}）</h3>
        {#if peekLoading}
          <p>查询中…</p>
        {:else if backrefs.length === 0}
          <p class="safe">无引用——可安全删除</p>
        {:else}
          <ul>
            {#each backrefs as ref, i (i)}
              <li>
                <b>{ref.fromTable}#{ref.fromPk}</b>
                <span class="rule">{ref.fromField}</span>
                {#if session?.tables.has(ref.fromTable)}
                  <button
                    type="button"
                    onclick={() => openPeekTable(ref.fromTable, ref.fromPk)}
                  >
                    打开
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
    {/if}
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    margin: 0;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  header {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 16px;
    border-bottom: 1px solid #e5e7eb;
  }
  h1 {
    font-size: 15px;
    margin: 0;
  }
  .error-banner {
    color: #dc2626;
  }
  .layout {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  nav {
    width: 140px;
    border-right: 1px solid #e5e7eb;
    padding: 8px;
  }
  nav ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  nav button {
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
  }
  nav button.active {
    background: #2563eb;
    color: #fff;
  }
  .grid-area {
    flex: 1;
    min-width: 0;
  }
  .error-panel {
    width: 320px;
    flex-shrink: 0;
    overflow-wrap: anywhere;
    border-left: 1px solid #e5e7eb;
    overflow: auto;
    padding: 8px;
    font-size: 12px;
  }
  .error-panel h2 {
    font-size: 13px;
  }
  .error-panel .rule,
  .peek .rule {
    color: #6b7280;
    font-family: monospace;
  }
  .error-panel li.error {
    color: #b91c1c;
  }
  .error-panel li.warning {
    color: #b45309;
  }
  .peek {
    width: 320px;
    flex-shrink: 0;
    overflow-wrap: anywhere;
    border-left: 1px solid #e5e7eb;
    overflow: auto;
    padding: 8px;
    font-size: 12px;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
  }
  .crumb {
    background: #eff6ff;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .safe {
    color: #15803d;
  }
  :global(.cell-error) {
    background: #fef2f2;
    box-shadow: inset 0 -2px 0 #dc2626;
  }
  :global(.cell-warning) {
    background: #fffbeb;
    box-shadow: inset 0 -2px 0 #d97706;
  }
  :global(.cell-dirty) {
    box-shadow: inset 0 -2px 0 #2563eb;
  }
</style>
