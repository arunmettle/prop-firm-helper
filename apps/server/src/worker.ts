import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createEmailSender } from './lib/email.js';
import { createJevFromConfig } from './services/jev.js';
import type { AppCtx } from './ctx.js';
import { processNext, requeueStale } from './jobs/queue.js';
import { handlers } from './jobs/handlers.js';

const cfg = loadConfig();
const { db, pool } = createDb(cfg.databaseUrl);
const ctx: AppCtx = { cfg, db, email: createEmailSender(cfg), jev: createJevFromConfig(cfg) };

let running = true;
const stop = () => {
  running = false;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.info('[worker] started, polling jobs table');
let lastStaleCheck = 0;
while (running) {
  try {
    if (Date.now() - lastStaleCheck > 60_000) {
      await requeueStale(db);
      lastStaleCheck = Date.now();
    }
    const didWork = await processNext(ctx, handlers);
    if (!didWork) await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    console.error('[worker] loop error:', err instanceof Error ? err.message : err);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await pool.end();
console.info('[worker] stopped');
