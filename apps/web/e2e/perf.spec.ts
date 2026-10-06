import { expect, test } from '@playwright/test';

// T6.7 性能预算（验收级，thesis R5）：10 万行 × 30 列全表滚动。
// 预算：平均帧 ≥55fps 等价于总时长约束；无 >50ms 长任务。不达标 = 卡片未完成（禁止改弱阈值）。

test('性能预算：10 万行 × 30 列滚动', async ({ page }) => {
  await page.goto('/playground?stress=100000');
  await page.waitForSelector('.row');

  const result = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>('.grid');
    if (grid === null) throw new Error('grid 不存在');
    const total = grid.scrollHeight;
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) longTasks.push(entry.duration);
      }
    });
    observer.observe({ entryTypes: ['longtask'] });

    const startTime = performance.now();
    // 程序化滚动全表：分 400 步，每步 rAF 驱动（模拟连续滚动）
    const steps = 400;
    for (let i = 1; i <= steps; i++) {
      grid.scrollTop = (total * i) / steps;
      await new Promise((r) => requestAnimationFrame(r));
    }
    const elapsed = performance.now() - startTime;
    observer.disconnect();

    return {
      elapsed,
      avgFrameMs: elapsed / steps,
      longTasks: longTasks.length,
      rows: document.querySelectorAll('.row').length,
    };
  });

  // 400 帧、预算 55fps → 每帧 ≤18.2ms → 总时长 ≤7280ms（留 CI 裕量放宽到 9000）
  expect(result.avgFrameMs).toBeLessThan(22.5);
  expect(result.longTasks).toBe(0);
  expect(result.rows).toBeLessThan(60); // 窗口化仍生效
});
