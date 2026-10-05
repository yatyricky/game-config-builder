import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "packages/**/tests/**/*.test.ts",
      "apps/**/tests/**/*.test.ts",
    ],
    // Phase 0 期间包骨架尚未建立（T0.6），允许零用例；T0.6 起每包至少 1 条
    passWithNoTests: true,
  },
});
