import { isAbsolute, resolve } from 'node:path';
import { buildApp } from './app.js';

// 相对路径基准：pnpm --filter 会切 cwd，INIT_CWD 才是调用者目录（与 CLI 同一约定）
const projectArg = process.env['GCB_PROJECT'] ?? 'examples/demo';
const projectDir = isAbsolute(projectArg)
  ? projectArg
  : resolve(process.env['INIT_CWD'] ?? process.cwd(), projectArg);
const port = Number(process.env['PORT'] ?? 8787);

const { app, deps, webServed, webDist } = await buildApp({ projectDir });

app.listen({ port, host: '127.0.0.1' }).then(() => {
  const mode = webServed ? 'API + 编辑器托管' : '仅 API（编辑器未构建：pnpm build 后重启可托管）';
  console.log(`gcb server [${mode}]: ${projectDir} (${Object.keys(deps.ir.tables).length} 表)`);
  console.log(`  API:      http://127.0.0.1:${port}/api/healthz`);
  if (webServed) {
    console.log(`  编辑器:   http://127.0.0.1:${port}/edit  (dist: ${webDist})`);
  }
});
