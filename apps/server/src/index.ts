import fastify from 'fastify';

const app = fastify({ logger: true });

app.get('/healthz', async () => ({ status: 'ok' }));

const port = Number(process.env['PORT'] ?? 8787);

try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
