// Starts Postgres via docker compose when Docker is available; otherwise checks DATABASE_URL is reachable.
import { execSync } from 'node:child_process';
import net from 'node:net';

function hasDocker() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(host, port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, host, () => {
        s.end();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (hasDocker()) {
  execSync('docker compose up -d --wait db', { stdio: 'inherit' });
} else {
  console.log('[db-up] Docker not available — expecting a Postgres 16 server on localhost:5432 (see README).');
}
const ok = await waitForPort('127.0.0.1', 5432, 30000);
if (!ok) {
  console.error('[db-up] Postgres is not reachable on localhost:5432.');
  process.exit(1);
}
