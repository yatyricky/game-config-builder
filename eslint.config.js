import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '.zcode/**', 'pnpm-lock.yaml'] },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
