import { expect, test } from '@playwright/test';

// Main flow: sign in → add account → log 3 trades → pre-trade check → run a simulation (fake Jev) → see results.
test('sign in, log trades, check, simulate', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /email me a sign-in link/i }).click();
  await page.getByTestId('dev-login-link').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByPlaceholder('e.g. 100k challenge — phase 1').fill('E2E Challenge');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: /E2E Challenge/ })).toBeVisible();

  const trades = [
    { exit: '2420', note: 'London breakout retest, clean structure' },
    { exit: '2390', note: 'NY open liquidity sweep then reclaim' },
    { exit: '2410', note: 'Pullback to 4h demand with confirmation' },
  ];
  for (const t of trades) {
    await page.goto('/trades/new');
    await page.getByLabel('Size (lots)').fill('0.5');
    await page.getByLabel('Entry').fill('2400');
    await page.getByLabel('Stop', { exact: true }).fill('2390');
    await page.getByLabel('Why this trade, in one line?').fill(t.note);
    await page.getByLabel('Trade is closed').check();
    await page.getByLabel('Exit price').fill(t.exit);
    await page.getByRole('button', { name: /save trade/i }).click();
    await expect(page.getByRole('heading', { name: 'Trades' })).toBeVisible();
  }
  await expect(page.getByTestId('trade-table').locator('tbody tr')).toHaveCount(3);

  await page.goto('/check');
  await page.getByTestId('pc-entry').fill('2400');
  await page.getByTestId('pc-stop').fill('2390');
  await page.getByTestId('pc-note').fill('London breakout retest');
  await page.getByTestId('pc-submit').click();
  await expect(page.getByTestId('verdict')).toBeVisible();
  // Balance after the three trades: 100,000 + 1,000 − 500 + 500 = 101,000 → 1% risk over a 10-point stop = 1.01 lots.
  await expect(page.getByTestId('pc-size')).toHaveText('1.01 lots');

  await page.goto('/simulate');
  await page.getByTestId('run-sim').click();
  await expect(page.getByTestId('sim-result')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Simulated outcomes')).toBeVisible();
  await expect(page.getByText('Illustrative — not your profile yet')).toBeVisible();
  await expect(page.getByText(/Past performance does not predict future results/).first()).toBeVisible();
});
