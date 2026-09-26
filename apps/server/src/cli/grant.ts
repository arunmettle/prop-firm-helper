import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { balanceOf, grantCredits } from '../services/credits.js';

// Usage: pnpm admin:grant <email> <n>
const [email, nRaw] = process.argv.slice(2).filter((a) => a !== '--');
const n = Number(nRaw);
if (!email || !Number.isInteger(n) || n <= 0) {
  console.error('Usage: pnpm admin:grant <email> <positive integer>');
  process.exit(1);
}
const { db, pool } = createDb(loadConfig().databaseUrl);
const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
if (!user) {
  console.error(`No user with email ${email}. They must sign in once first.`);
  await pool.end();
  process.exit(1);
}
await grantCredits(db, user.id, n, `cli:${randomUUID()}`);
console.info(`Granted ${n} credit(s) to ${user.email}. Balance: ${await balanceOf(db, user.id)}`);
await pool.end();
