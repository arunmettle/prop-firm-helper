import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** A db handle or an open transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

// Return NUMERIC as JS numbers is handled per-column by drizzle (mode: 'number').
export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
