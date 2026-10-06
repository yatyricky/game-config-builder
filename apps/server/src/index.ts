import { resolve } from 'node:path';
import { buildApp } from './app.js';

const projectDir = resolve(process.env['GCB_PROJECT'] ?? 'examples/demo');
const port = Number(process.env['PORT'] ?? 8787);

const { app, deps } = await buildApp({ projectDir });

app.listen({ port, host: '127.0.0.1' }).then(() => {
  app.log.info(
    `gcb server: ${projectDir} (${Object.keys(deps.ir.tables).length} tables) on http://127.0.0.1:${port}`,
  );
});
