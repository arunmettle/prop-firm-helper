import type { Config } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  readonly kind: 'console' | 'resend' | 'memory';
  send(msg: EmailMessage): Promise<void>;
}

/** Dev adapter: prints the message (incl. magic link) to the console. */
export class ConsoleEmailSender implements EmailSender {
  readonly kind = 'console' as const;
  async send(msg: EmailMessage): Promise<void> {
    console.info(`\n[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
  }
}

/** Test adapter: keeps messages in memory. */
export class MemoryEmailSender implements EmailSender {
  readonly kind = 'memory' as const;
  sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

export class ResendEmailSender implements EmailSender {
  readonly kind = 'resend' as const;
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new Error(`Resend failed with HTTP ${res.status}`);
  }
}

export function createEmailSender(cfg: Config): EmailSender {
  return cfg.email.resendApiKey
    ? new ResendEmailSender(cfg.email.resendApiKey, cfg.email.from)
    : new ConsoleEmailSender();
}
