import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { accounts, trades, type Account, type Trade } from '../db/schema.js';
import { notFound } from '../lib/http.js';

/** Every lookup is scoped by user_id; another user's id is indistinguishable from a missing one (404). */
export async function ownedAccount(db: Tx, userId: string, id: string): Promise<Account> {
  if (!isUuid(id)) throw notFound('Account not found');
  const [a] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId))).limit(1);
  if (!a) throw notFound('Account not found');
  return a;
}

export async function ownedTrade(db: Tx, userId: string, id: string): Promise<Trade> {
  if (!isUuid(id)) throw notFound('Trade not found');
  const [t] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, userId))).limit(1);
  if (!t) throw notFound('Trade not found');
  return t;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
