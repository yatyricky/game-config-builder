import { expect, test } from '@playwright/test';

test('playground: 1 wan row rendering, windowed DOM, scroll to bottom', async ({ page }) => {
  await page.goto('/playground');
  await expect(page.getByRole('heading', { name: 'GCB 网格 playground' })).toBeVisible();

  await page.waitForSelector('.row');
  const domRows = await page.locator('.row').count();
  expect(domRows).toBeGreaterThan(5);
  expect(domRows).toBeLessThan(60);

  await page.locator('.grid').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  expect(await page.getByText('#10000').isVisible()).toBe(true);
  expect(await page.locator('.row').count()).toBeLessThan(60);
});

test('T6.6/T7.3: keyboard nav + edit commit (numeric rejection)', async ({ page }) => {
  await page.goto('/playground');
  await page.waitForSelector('.row');
  await page.locator('.grid').click(); // center ~ (11,4)
  await page.locator('.grid').press('ArrowDown'); // (12,4)
  await page.locator('.grid').press('ArrowRight'); // (12,5) numeric col
  await page.locator('.grid').press('ArrowRight'); // (12,6) text col
  await expect(page.locator('.cell.cursor')).toHaveCount(1);

  await page.locator('.grid').press('h');
  await page.locator('.edit-input').fill('hello');
  await page.locator('.grid').press('Enter');
  await expect(page.locator('.edit-input')).toHaveCount(0);
  await expect(page.locator('[data-row="12"] [data-col="6"] span')).toContainText('hello');

  for (let i = 0; i < 4; i++) {
    await page.locator('.grid').press('ArrowRight'); // to col10 numeric
  }
  await page.locator('.grid').press('x');
  await page.locator('.edit-input').fill('abc');
  await page.locator('.grid').press('Enter');
  await expect(page.locator('.edit-input.error')).toHaveCount(1);
});
