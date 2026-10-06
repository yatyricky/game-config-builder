<script lang="ts">
  // Grid.svelte（T6.3/T6.4）：薄渲染层——订阅 GridModel 事件，行级 keyed each + transform 定位。
  // 铁律（AGENTS §7.2）：不为单元格建组件；不用 top/left 定位；滚动容器 + spacer。
  // 性能护栏（T6.7）：cell 样式创建时求值一次（flex 流布局）；每帧只写行 translateY 与
  // main 层 translateX（各 ~20 次/帧），滚动走合成器路径。
  import { GridModel, visibleColumns } from '@gcb/grid';
  import type { CellCoord, ColumnSpec, RowRange } from '@gcb/grid';

  interface RowData {
    pk: string;
    cells: string[];
  }

  let { rows = [], columns = [], rowHeight = 28, onCommit }: {
    rows?: RowData[];
    columns?: ColumnSpec[];
    rowHeight?: number;
    onCommit?: (coord: CellCoord, raw: string) => string | null;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewportHeight = $state(600);
  let viewportWidth = $state(800);
  let visible: RowRange = $state({ start: 0, end: 0 });
  let cursorPos = $state({ row: 0, col: 0 });
  let editValue = $state<string | null>(null);
  let editError = $state<string | null>(null);

  const rowCount = $derived(rows.length);
  const totalHeightPx = $derived(rows.length * rowHeight);
  const totalWidthPx = $derived(columns.reduce((s, c) => s + c.width, 0));

  function rebuildModel(count: number): void {
    const model = new GridModel(
      { rowCount: count, columns, rowHeight, overscan: 5 },
      {
        onViewportChange: (r) => {
          visible = r;
        },
        onSelectionChange: (sel) => {
          cursorPos = { ...sel.cursor };
        },
        onEditCommit: (coord, raw) => {
          const error = onCommit?.(coord, raw);
          editValue = null;
          if (error !== null && error !== undefined) {
            editError = error;
            editValue = raw; // 拒绝提交：保持编辑态
            gridModel?.beginEdit(coord, raw); // 同步内核编辑态（editCoord 驱动浮层渲染）
          }
        },
        onHistoryChange: () => {},
      },
    );
    gridModel = model;
    visible = model.snapshot().viewport;
    ready = true;
  }

  // 非响应式：纯命令对象（不参与渲染依赖）；渲染由 visible/ready 等 state 驱动
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- effect 与事件回调中读写
  let gridModel: GridModel | undefined;
  let ready = $state(false);

  $effect(() => {
    // 仅依赖结构数值（rowCount/列数），不依赖 rows 引用——数据更新走细粒度 cell 渲染
    const count = rowCount;
    const colCount = columns.length;
    rebuildModel(count);
    void colCount;
    handleScroll(); // 首帧同步容器尺寸（onscroll 只在滚动时触发）
  });

  // 列 x 坐标前缀和（查表 O(1)）
  const colXs = $derived.by(() => {
    const xs: number[] = [];
    let x = 0;
    for (const c of columns) {
      xs.push(x);
      x += c.width;
    }
    return xs;
  });

  // 水平窗口：frozen 组 + windowed 组（列号列表，行渲染时按组分发）
  const colGroups = $derived.by(() => {
    if (!ready) return { frozen: [] as number[], windowed: [] as number[] };
    return visibleColumns(
      { columns, rowHeight, overscan: 5, rowCount: rowCount },
      scrollLeft,
      viewportWidth,
    );
  });

  const frozenWidth = $derived(
    columns.reduce((s, c) => (c.frozen === true ? s + c.width : s), 0),
  );

  function handleScroll(): void {
    if (container === undefined || gridModel === undefined) return;
    scrollTop = container.scrollTop;
    scrollLeft = container.scrollLeft;
    viewportHeight = container.clientHeight;
    viewportWidth = container.clientWidth;
    gridModel.setViewport({ scrollTop, scrollLeft, viewportHeight, viewportWidth });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (gridModel === undefined) return;
    if (editValue !== null) {
      // 编辑态：Enter 提交下移 / Tab 提交右移 / Esc 取消（IME 由 input 原生处理）
      if (event.key === 'Enter') {
        event.preventDefault();
        gridModel.commitEdit(editValue, 'down');
      } else if (event.key === 'Tab') {
        event.preventDefault();
        gridModel.commitEdit(editValue, 'right');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        gridModel.cancelEdit();
        editValue = null;
      }
      return;
    }
    const navigation = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Enter',
      'F2',
      'Escape',
      'Tab',
    ];
    if (navigation.includes(event.key)) {
      event.preventDefault();
      gridModel.handleKeyDown(event.key as never, {
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
      });
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      gridModel.handleKeyDown('character', { shift: event.shiftKey, ctrl: false }, event.key);
      editValue = event.key;
      editError = null;
    }
  }

  function beginEditAt(row: number, col: number, initial: string): void {
    if (gridModel === undefined) return;
    gridModel.setCursor(row, col);
    gridModel.beginEdit({ row, col }, initial);
    editValue = initial;
    editError = null;
  }

  const editCoord = $derived.by(() => {
    void editValue;
    if (gridModel === undefined) return null;
    const edit = gridModel.getEdit();
    return edit === null ? null : edit.coord;
  });

  // 静态 cell 样式（创建时求值一次；flex 流布局，无每帧重算）
  function cellStyle(col: number): string {
    const w = columns[col]?.width ?? 100;
    return `flex:0 0 ${w}px;width:${w}px`;
  }

  // main 层水平偏移：首列逻辑 x 与滚动的差值
  const mainOffset = $derived.by(() => {
    const first = colGroups.windowed[0];
    if (first === undefined) return 0;
    return (colXs[first] ?? 0) - scrollLeft;
  });
</script>

<svelte:window on:resize={handleScroll} />

<div
  bind:this={container}
  class="grid"
  role="grid"
  tabindex="0"
  onscroll={handleScroll}
  onkeydown={handleKeydown}
  ondblclick={(e) => {
    const target = (e.target as HTMLElement).closest('[data-row]');
    if (target !== null) {
      const cell = (e.target as HTMLElement).closest('[data-col]');
      if (cell !== null) {
        beginEditAt(Number(target.getAttribute('data-row')), Number(cell.getAttribute('data-col')), '');
      }
    }
  }}
>
  <div class="spacer" style="height:{totalHeightPx}px;width:{totalWidthPx}px"></div>
  {#if ready}
    {#each rows.slice(visible.start, visible.end) as row, i (row.pk)}
      {@const rowIdx = visible.start + i}
      <div
        class="row"
        class:cursor-row={rowIdx === cursorPos.row}
        data-row={rowIdx}
        style="transform:translateY({rowIdx * rowHeight}px);width:{totalWidthPx}px"
      >
        {#if colGroups.frozen.length > 0}
          <div class="frozen-layer">
            {#each colGroups.frozen as col (col)}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div
                class="cell"
                role="gridcell"
                tabindex="-1"
                class:cursor={rowIdx === cursorPos.row && col === cursorPos.col}
                data-col={col}
                style={cellStyle(col)}
                onclick={() => gridModel?.setCursor(rowIdx, col)}
              >
                {#if editValue !== null && editCoord !== null && editCoord.row === rowIdx && editCoord.col === col}
                  <input
                    class="edit-input"
                    class:error={editError !== null}
                    value={editValue}
                    oninput={(e) => (editValue = e.currentTarget.value)}
                    onblur={() => {
                      if (editValue !== null) gridModel?.commitEdit(editValue, 'none');
                    }}
                  />
                {/if}
                <span class="cell-text">{row.cells[col] ?? ''}</span>
              </div>
            {/each}
          </div>
        {/if}
        <div class="main-layer" style="left:{frozenWidth}px;transform:translateX({mainOffset}px)">
          {#each colGroups.windowed as col (col)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="cell"
              role="gridcell"
              tabindex="-1"
              class:cursor={rowIdx === cursorPos.row && col === cursorPos.col}
              data-col={col}
              style={cellStyle(col)}
              onclick={() => gridModel?.setCursor(rowIdx, col)}
            >
              {#if editValue !== null && editCoord !== null && editCoord.row === rowIdx && editCoord.col === col}
                <input
                  class="edit-input"
                  class:error={editError !== null}
                  value={editValue}
                  oninput={(e) => (editValue = e.currentTarget.value)}
                  onblur={() => {
                    if (editValue !== null) gridModel?.commitEdit(editValue, 'none');
                  }}
                />
              {/if}
              <span class="cell-text">{row.cells[col] ?? ''}</span>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .grid {
    position: relative;
    height: 100%;
    overflow: auto;
    outline: none;
    background: var(--grid-bg, #fff);
    font-family: var(--grid-font, 'Segoe UI', system-ui, sans-serif);
    font-size: 13px;
  }
  .spacer {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }
  .row {
    position: absolute;
    top: 0;
    left: 0;
    height: 28px;
    will-change: transform;
  }
  .cursor-row {
    background: var(--row-hover, #f6f8fa);
  }
  .frozen-layer,
  .main-layer {
    position: absolute;
    top: 0;
    left: 0;
    height: 28px;
    display: flex;
  }
  .frozen-layer {
    z-index: 2;
    background: inherit;
  }
  .main-layer {
    will-change: transform;
  }
  .cell {
    position: relative;
    height: 28px;
    line-height: 28px;
    padding: 0 8px;
    border-right: 1px solid var(--grid-line, #e5e7eb);
    border-bottom: 1px solid var(--grid-line, #e5e7eb);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: cell;
    box-sizing: border-box;
    background: inherit;
  }
  .cell.cursor {
    outline: 2px solid var(--accent, #2563eb);
    outline-offset: -2px;
    z-index: 2;
  }
  .cell-text {
    pointer-events: none;
  }
  .edit-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    padding: 0 8px;
    font: inherit;
    outline: 2px solid var(--accent, #2563eb);
    outline-offset: -2px;
    z-index: 3;
  }
  .edit-input.error {
    outline-color: var(--danger, #dc2626);
  }
</style>
