import { useState, type FormEvent } from 'react';
import { ArrowRight, Lock, MailCheck } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { Logo } from '../components/Logo';
import { Button, Input } from '../components/ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setState('sending');
    try {
      const r = await api.post<{ ok: true; devLink?: string }>('/api/auth/request', { email });
      setDevLink(r.devLink ?? null);
      setState('sent');
    } catch (err) {
      setError(errorText(err));
      setState('idle');
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line bg-surface lg:block">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(94,234,212,0.18), transparent 45%), radial-gradient(circle at 80% 70%, rgba(147,197,253,0.10), transparent 40%)',
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold">Cooldown</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-3xl leading-tight font-semibold tracking-tight">
              Know what you actually do after a loss — before it costs you the challenge.
            </h1>
            <ul className="mt-8 space-y-4 text-sm text-fg-muted">
              {[
                ['Log trades in seconds', 'A few fields and one line on why — before you enter.'],
                ['Check before you click', 'Position size, remaining daily budget and a calm tilt check.'],
                ['See what decides your outcome', 'Simulate the evaluation with your own trades and habits.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>
                    <span className="font-medium text-fg">{t}.</span> {d}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="flex items-center gap-2 text-xs text-fg-subtle">
            <Lock className="size-3.5" /> We never ask for broker logins. Your trades are never pooled or used
            for training.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo />
            <span className="text-[15px] font-semibold">Cooldown</span>
          </div>
          {state === 'sent' ? (
            <div>
              <div className="mb-4 grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
                <MailCheck className="size-5" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">Check your inbox</h2>
              <p className="mt-2 text-sm text-fg-muted">
                We sent a sign-in link to <span className="text-fg">{email}</span>. It expires in 15 minutes.
              </p>
              {devLink && (
                <a
                  href={devLink}
                  data-testid="dev-login-link"
                  className="mt-6 flex items-center justify-between rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2.5 text-sm text-accent hover:bg-accent/15"
                >
                  Dev mode: open sign-in link <ArrowRight className="size-4" />
                </a>
              )}
              <button
                className="mt-6 text-sm text-fg-muted underline-offset-4 hover:underline"
                onClick={() => setState('idle')}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1.5 text-sm text-fg-muted">
                We’ll email you a one-time link. No password, only your email is stored.
              </p>
              <div className="mt-6 space-y-3">
                <Input
                  type="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  aria-label="Email"
                />
                {error && <p className="text-xs text-stop">{error}</p>}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={state === 'sending'}
                >
                  Email me a sign-in link
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
