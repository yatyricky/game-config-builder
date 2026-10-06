// 命令式撤销/重做（T7.4）与 TSV 粘贴解析（T7.5）。
// HistoryStack 由上层提供 invert（编辑器知道如何生成逆操作），内核只管栈与游标。

export interface HistoryCommand {
  /** 执行（重做） */
  apply(): void;
  /** 逆操作（撤销） */
  undo(): void;
  /** 合并标识：连续单格编辑合并为一条（可选） */
  coalesceKey?: string;
}

export class HistoryStack {
  private done: HistoryCommand[] = [];
  private undone: HistoryCommand[] = [];
  private limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  push(cmd: HistoryCommand): void {
    // 连续同 key 的单格编辑合并（Excel 语义：同格连续输入算一条）
    const top = this.done[this.done.length - 1];
    if (top !== undefined && cmd.coalesceKey !== undefined && top.coalesceKey === cmd.coalesceKey) {
      // 合并 = 保留旧命令（其 undo 已覆盖旧值），丢弃新命令对象但执行其 apply
      cmd.apply();
      this.undone = [];
      return;
    }
    cmd.apply();
    this.done.push(cmd);
    this.undone = [];
    if (this.done.length > this.limit) {
      this.done.shift();
    }
  }

  /** 入栈但不执行 apply（调用方已完成首次执行；用于撤销栈登记） */
  pushWithoutExecute(cmd: HistoryCommand): void {
    const top = this.done[this.done.length - 1];
    if (top !== undefined && cmd.coalesceKey !== undefined && top.coalesceKey === cmd.coalesceKey) {
      return; // 合并：首执行已发生，栈保持旧命令（其 undo 仍回原值）
    }
    this.done.push(cmd);
    this.undone = [];
    if (this.done.length > this.limit) this.done.shift();
  }

  undo(): boolean {
    const cmd = this.done.pop();
    if (cmd === undefined) return false;
    cmd.undo();
    this.undone.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.undone.pop();
    if (cmd === undefined) return false;
    cmd.apply();
    this.done.push(cmd);
    return true;
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}

/** TSV 粘贴文本 → 二维数组（\t 切列、\n 切行；尾换行不算新行；\r 归一） */
export function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}

/** 粘贴矩阵映射到选区：越界裁剪（M6 决策：默认裁剪不扩展） */
export function mapPasteToRect(
  matrix: string[][],
  startRow: number,
  startCol: number,
  rowCount: number,
  colCount: number,
): Array<{ row: number; col: number; raw: string }> {
  const out: Array<{ row: number; col: number; raw: string }> = [];
  for (let r = 0; r < matrix.length; r++) {
    const line = matrix[r];
    if (line === undefined) continue;
    const targetRow = startRow + r;
    if (targetRow >= rowCount) break; // 越界裁剪
    for (let c = 0; c < line.length; c++) {
      const raw = line[c];
      if (raw === undefined) continue;
      const targetCol = startCol + c;
      if (targetCol >= colCount) break;
      out.push({ row: targetRow, col: targetCol, raw });
    }
  }
  return out;
}

/** 拖拽填充序列：复制源 + 数字列线性序列（简化 Excel：数字等差 +1，其余复制） */
export function fillSequence(source: string[][], targetRows: number): string[][] {
  // source: 选区内容（1 列时向下填充 targetRows 行）
  const isNumericColumn = (col: number): boolean => {
    for (const row of source) {
      const v = row[col];
      if (v === undefined || v === '' || Number.isNaN(Number(v))) return false;
    }
    return true;
  };
  const out: string[][] = [];
  const srcRows = source.length;
  for (let r = 0; r < targetRows; r++) {
    const srcRow = source[r % srcRows];
    if (srcRow === undefined) {
      out.push([]);
      continue;
    }
    out.push(
      srcRow.map((v, c) => {
        if (srcRows === 1 && isNumericColumn(c)) {
          // 单源数字列：线性序列 +1
          return String(Number(v) + r);
        }
        return v;
      }),
    );
  }
  return out;
}
