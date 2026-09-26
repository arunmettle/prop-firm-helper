import { defineConfig, devices } from '@playwright/test';

const env = {
  ...process.env,
  NODE_ENV: 'development',
  JEV_PROVIDER: 'fake',
  PAYMENTS_ENABLED: 'false',
} as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Starts API, worker and web against DATABASE_URL (run `pnpm db:up && pnpm db:migrate` first). Reuses running dev servers.
  webServer: [
    {
      command: 'pnpm --filter @cooldown/server start',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: true,
      env,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cooldown/server start:worker',
      reuseExistingServer: true,
      env,
      url: 'http://localhost:3001/api/health',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cooldown/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      env,
      timeout: 60_000,
    },
  ],
});
