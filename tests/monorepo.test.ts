import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tsconfigBase from '../tsconfig.base.json';

// T0.3 管线冒烟 + T0.2 配置守护：这些断言锁定 monorepo 基线不被无意回退
describe('monorepo 基线', () => {
  it('tsconfig.base.json 保持严格编译标志', () => {
    const opts = tsconfigBase.compilerOptions;
    expect(opts.strict).toBe(true);
    expect(opts.noUncheckedIndexedAccess).toBe(true);
    expect(opts.exactOptionalPropertyTypes).toBe(true);
    expect(opts.moduleResolution).toBe('bundler');
    expect(opts.target).toBe('ES2022');
  });

  it('workspace 根配置就位', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string;
      private: boolean;
    };
    expect(pkg.name).toBe('game-config-builder');
    expect(pkg.private).toBe(true);
  });
});
