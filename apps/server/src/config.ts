import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://cooldown:cooldown@localhost:5432/cooldown'),
  APP_URL: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().default(3001),
  ADMIN_EMAILS: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Cooldown <login@example.com>'),
  JEV_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['openrouter', 'cloudflare', 'typesafe', 'fake']).optional(),
  ),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_JEV_MODEL: z.string().default('typesafe/jev-1.13'),
  CLOUDFLARE_ACCOUNT_ID: z.string().default(''),
  CLOUDFLARE_API_TOKEN: z.string().default(''),
  TYPESAFE_API_KEY: z.string().default(''),
  PAYMENTS_ENABLED: bool,
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_CREDIT_PACKS: z.string().default(''),
  SIGNUP_FREE_CREDITS: z.coerce.number().int().min(0).default(3),
});

export interface CreditPack {
  id: string;
  credits: number;
  priceId: string;
  label?: string;
}

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = envSchema.parse(env);
  // Empty/unset JEV_PROVIDER = auto: OpenRouter if its key is set, then Cloudflare, else the deterministic fake.
  const jevProvider =
    e.JEV_PROVIDER ??
    (e.OPENROUTER_API_KEY
      ? 'openrouter'
      : e.CLOUDFLARE_API_TOKEN && e.CLOUDFLARE_ACCOUNT_ID
        ? 'cloudflare'
        : e.TYPESAFE_API_KEY
          ? 'typesafe'
          : 'fake');
  let packs: CreditPack[] = [];
  if (e.STRIPE_CREDIT_PACKS) packs = JSON.parse(e.STRIPE_CREDIT_PACKS) as CreditPack[];
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    databaseUrl: e.DATABASE_URL,
    appUrl: e.APP_URL.replace(/\/$/, ''),
    port: e.PORT,
    adminEmails: e.ADMIN_EMAILS.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    email: { resendApiKey: e.RESEND_API_KEY, from: e.EMAIL_FROM },
    jev: {
      provider: jevProvider,
      openrouterApiKey: e.OPENROUTER_API_KEY,
      openrouterModel: e.OPENROUTER_JEV_MODEL,
      cloudflareAccountId: e.CLOUDFLARE_ACCOUNT_ID,
      cloudflareApiToken: e.CLOUDFLARE_API_TOKEN,
      typesafeApiKey: e.TYPESAFE_API_KEY,
    },
    payments: {
      enabled: e.PAYMENTS_ENABLED,
      stripeSecretKey: e.STRIPE_SECRET_KEY,
      webhookSecret: e.STRIPE_WEBHOOK_SECRET,
      packs,
    },
    signupFreeCredits: e.SIGNUP_FREE_CREDITS,
  };
}
