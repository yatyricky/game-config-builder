# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grid.spec.ts >> T6.6/T7.3: keyboard nav + edit commit (numeric rejection)
- Location: e2e\grid.spec.ts:18:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('[data-row="12"] [data-col="6"] span')
Expected substring: "hello"
Received string:    "r12c6"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('[data-row="12"] [data-col="6"] span') with timeout 5000ms
  - waiting for locator('[data-row="12"] [data-col="6"] span')
    14 × locator resolved to <span class="cell-text svelte-etbxz3">r12c6</span>
       - unexpected value "r12c6"

```

```yaml
- text: r12c6
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | test('playground: 1 wan row rendering, windowed DOM, scroll to bottom', async ({ page }) => {
  4  |   await page.goto('/playground');
  5  |   await expect(page.getByRole('heading', { name: 'GCB 网格 playground' })).toBeVisible();
  6  | 
  7  |   await page.waitForSelector('.row');
  8  |   const domRows = await page.locator('.row').count();
  9  |   expect(domRows).toBeGreaterThan(5);
  10 |   expect(domRows).toBeLessThan(60);
  11 | 
  12 |   await page.locator('.grid').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  13 |   await page.waitForTimeout(200);
  14 |   expect(await page.getByText('#10000').isVisible()).toBe(true);
  15 |   expect(await page.locator('.row').count()).toBeLessThan(60);
  16 | });
  17 | 
  18 | test('T6.6/T7.3: keyboard nav + edit commit (numeric rejection)', async ({ page }) => {
  19 |   await page.goto('/playground');
  20 |   await page.waitForSelector('.row');
  21 |   await page.locator('.grid').click(); // center ~ (11,4)
  22 |   await page.locator('.grid').press('ArrowDown'); // (12,4)
  23 |   await page.locator('.grid').press('ArrowRight'); // (12,5) numeric col
  24 |   await page.locator('.grid').press('ArrowRight'); // (12,6) text col
  25 |   await expect(page.locator('.cell.cursor')).toHaveCount(1);
  26 | 
  27 |   await page.locator('.grid').press('h');
  28 |   await page.locator('.edit-input').fill('hello');
  29 |   await page.locator('.grid').press('Enter');
  30 |   await expect(page.locator('.edit-input')).toHaveCount(0);
> 31 |   await expect(page.locator('[data-row="12"] [data-col="6"] span')).toContainText('hello');
     |                                                                     ^ Error: expect(locator).toContainText(expected) failed
  32 | 
  33 |   for (let i = 0; i < 4; i++) {
  34 |     await page.locator('.grid').press('ArrowRight'); // to col10 numeric
  35 |   }
  36 |   await page.locator('.grid').press('x');
  37 |   await page.locator('.edit-input').fill('abc');
  38 |   await page.locator('.grid').press('Enter');
  39 |   await expect(page.locator('.edit-input.error')).toHaveCount(1);
  40 | });
  41 | 
```