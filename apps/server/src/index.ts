import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createEmailSender } from './lib/email.js';
import { createJevFromConfig } from './services/jev.js';
import { buildApp } from './app.js';
import type { AppCtx } from './ctx.js';

const cfg = loadConfig();
const { db } = createDb(cfg.databaseUrl);
const ctx: AppCtx = { cfg, db, email: createEmailSender(cfg), jev: createJevFromConfig(cfg) };
const app = await buildApp(ctx, { logger: true });

// In production the API also serves the built web app (single origin, cookies stay first-party).
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: cfg.port, host: '0.0.0.0' });
