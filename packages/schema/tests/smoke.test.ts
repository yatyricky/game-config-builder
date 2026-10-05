import { expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

it('入口可导入且名称标记正确', () => {
  expect(PACKAGE_NAME).toBe('@gcb/schema');
});
