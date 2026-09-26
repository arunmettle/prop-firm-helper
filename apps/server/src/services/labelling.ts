import type { Tx } from '../db/client.js';
import type { AppCtx } from '../ctx.js';

/** Hook called whenever trades are created/updated/imported. Labelling lands in phase 5. */
export async function onTradesChanged(_ctx: AppCtx, _tx: Tx, _userId: string, _tradeIds: string[]): Promise<void> {}
