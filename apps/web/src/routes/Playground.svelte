<script lang="ts">
  // /playground（T6.3/T7.5）：网格开发场——合成数据 1 万行 + demo 数据只读页签
  import Grid from '../lib/Grid.svelte';
  import type { CellCoord } from '@gcb/grid';

  const COLS = 30;
  const ROWS = 10_000;

  type Row = { pk: string; cells: string[] };

  function makeRows(n: number): Row[] {
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      const cells: string[] = [`#${i + 1}`];
      for (let c = 1; c < COLS; c++) {
        cells.push(c % 5 === 0 ? `${(i * c) / 7}` : `r${i}c${c}`);
      }
      rows.push({ pk: String(i + 1), cells });
    }
    return rows;
  }

  const columns = [
    { name: 'pk', width: 90, frozen: true },
    ...Array.from({ length: COLS - 1 }, (_, i) => ({ name: `col${i + 1}`, width: 110 })),
  ];

  const stressParam = new URLSearchParams(window.location.search).get('stress');
  const ROWS_EFF = stressParam !== null ? Number(stressParam) : ROWS;

  let data = $state(makeRows(ROWS_EFF));
  let status = $state('就绪');

  // 提交协议（T7.3 简版）：数字列拒绝非数字，返回错误串则浮层保持
  function handleCommit(coord: CellCoord, raw: string): string | null {
    if (coord.col > 0 && coord.col % 5 === 0 && raw.trim() !== '' && Number.isNaN(Number(raw))) {
      status = `拒绝：第 ${coord.row + 1} 行 col${coord.col} 需要数字，得到「${raw}」`;
      return '需要数字';
    }
    const row = data[coord.row];
    if (row !== undefined) {
      row.cells[coord.col] = raw;
      data = [...data];
    }
    status = `已提交：#${coord.row + 1} col${coord.col} = ${raw}`;
    return null;
  }
</script>

<main>
  <header>
    <h1>GCB 网格 playground</h1>
    <p>
      合成数据 {ROWS.toLocaleString()} 行 × {COLS} 列。操作：方向键/Tab/Enter/Home/End/PageUp/PageDown；
      双击或直接键入编辑；数字列校验。当前：<code>{status}</code>
    </p>
  </header>
  <div class="grid-wrap">
    <Grid {columns} rows={data} rowHeight={28} onCommit={handleCommit} />
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    margin: 0;
  }
  header {
    padding: 8px 16px;
    border-bottom: 1px solid #e5e7eb;
  }
  h1 {
    font-size: 16px;
    margin: 0 0 4px;
  }
  p {
    margin: 0;
    font-size: 12px;
    color: #6b7280;
  }
  .grid-wrap {
    flex: 1;
    min-height: 0;
  }
</style>
