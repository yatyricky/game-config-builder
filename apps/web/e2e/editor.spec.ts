import { expect, test } from '@playwright/test';

// M8-M10 验收：编辑器加载真数据 → 实时校验标记 → FK peek → 反向引用

test('编辑器：加载 5 表、浏览 Item 数据、错误面板', async ({ page }) => {
  await page.goto('/edit');
  await expect(page.getByRole('heading', { name: 'GCB 编辑器' })).toBeVisible();

  // 表切换侧栏：5 表
  for (const name of ['Item', 'Material', 'Skill', 'Hero', 'Text']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }

  // 切到 Item 表：FK chip 文本（craftFrom → Material display）
  await page.getByRole('button', { name: 'Item', exact: true }).click();
  await expect(page.locator('.grid')).toBeVisible();
  await expect(page.getByText('铁矿石 #2001')).toBeVisible();

  // 错误面板：demo 合法数据 → 0 错误
  await expect(page.locator('.error-panel h2')).toContainText('（0）');
});

test('M9：编辑触发实时校验——违规价格变红，错误面板计数', async ({ page }) => {
  await page.goto('/edit');
  await page.waitForSelector('.row');
  await page.getByRole('button', { name: 'Item', exact: true }).click();
  await page.waitForSelector('.row');

  // 找到 Item 表 price 列（1001 行）的格子：data-row=0, price 列 index=3
  const priceCell = page.locator('[data-row="0"] [data-col="3"]');
  await priceCell.dblclick();
  const input = page.locator('.edit-input');
  await input.fill('33'); // 违反 price % 10 == 0
  await page.locator('.grid').press('Enter');

  // 校验标记出现（cell-error class）+ 错误面板计数 1
  await expect(page.locator('.cell-error').first()).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.error-panel h2')).toContainText('（1）');

  // 修回合法值 → 标记消失
  await priceCell.dblclick();
  await input.fill('30');
  await page.locator('.grid').press('Enter');
  await expect(page.locator('.cell-error')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.error-panel h2')).toContainText('（0）');
});

test('M10：FK chip 点击 → peek 抽屉 + 反向引用', async ({ page }) => {
  await page.goto('/edit');
  await page.waitForSelector('.row');
  await page.getByRole('button', { name: 'Item', exact: true }).click();
  await page.waitForSelector('.row');

  // 点击 craftFrom 列（col index=6）的 chip → peek 显示 Material#2001 + 反向引用
  await page.locator('[data-row="0"] [data-col="6"]').click();
  await expect(page.locator('.peek')).toBeVisible();
  await expect(page.locator('.crumbs')).toContainText('Material#2001');
  await expect(page.locator('.peek h3')).toContainText('反向引用');

  // Hero 表对 Skill#3002 的反向引用：切 Hero，点击 skillIds 不可编辑（list 列）→ 直接验证反引面板经 Item#1002
  await page.getByRole('button', { name: 'Item', exact: true }).click();
  await page.locator('[data-row="1"] [data-col="6"]').click(); // 1002 craftFrom → Material#2002
  await expect(page.locator('.crumbs')).toContainText('Material#2002');
});

test('M11：保存流程——dirty 行 PUT 落盘（哈希护栏 200）', async ({ page }) => {
  await page.goto('/edit');
  await page.waitForSelector('.row');
  await page.getByRole('button', { name: 'Item', exact: true }).click();
  await page.waitForSelector('.row');

  const nameCell = page.locator('[data-row="0"] [data-col="1"]');
  await nameCell.dblclick();
  await page.locator('.edit-input').fill('铁剑·改');
  await page.locator('.grid').press('Enter');

  await page.getByRole('button', { name: /保存/ }).click();
  await expect(page.locator('header span')).toContainText('已保存 1 行', { timeout: 5000 });

  // 落盘验证：直接查 API
  const res = await page.request.get('http://127.0.0.1:8787/api/tables/Item/rows/1001');
  const body = (await res.json()) as { row: Record<string, unknown> };
  expect(body.row['name']).toBe('铁剑·改');
});
