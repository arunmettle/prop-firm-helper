import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { EmailSender } from './lib/email.js';

export interface AppCtx {
  cfg: Config;
  db: Db;
  email: EmailSender;
}
