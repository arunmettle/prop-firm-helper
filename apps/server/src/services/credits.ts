import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { creditsLedger } from '../db/schema.js';

/** Balance is always derived from the ledger. Never store it. */
export async function balanceOf(db: Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${creditsLedger.delta}), 0)` })
    .from(creditsLedger)
    .where(eq(creditsLedger.userId, userId));
  return Number(row?.total ?? 0);
}

export async function grantSignupCredits(db: Tx, userId: string, n: number): Promise<void> {
  if (n > 0)
    await db
      .insert(creditsLedger)
      .values({ userId, delta: n, reason: 'admin_grant', refId: `signup:${userId}` });
}

/** Lock the user's ledger rows for the duration of the transaction (serialises concurrent spends). */
export async function lockLedger(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

export async function grantCredits(db: Tx, userId: string, n: number, refId: string): Promise<void> {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Credits must be a positive integer');
  await db.insert(creditsLedger).values({ userId, delta: n, reason: 'admin_grant', refId });
}
