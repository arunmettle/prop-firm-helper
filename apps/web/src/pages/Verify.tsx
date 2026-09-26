import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '../lib/api';
import { Logo } from '../components/Logo';
import { Button, Spinner } from '../components/ui';

export function VerifyPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setError('This sign-in link is missing its token.');
      return;
    }
    api
      .post('/api/auth/verify', { token })
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ['me'] });
        window.history.replaceState(null, '', '/');
        window.location.assign('/');
      })
      .catch((e) => setError(errorText(e)));
  }, [qc]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <Logo className="size-10" />
      {error ? (
        <div className="max-w-sm text-center">
          <p className="text-sm text-stop">{error}</p>
          <Button className="mt-4" onClick={() => window.location.assign('/')}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <Spinner label="Signing you in…" />
      )}
    </div>
  );
}
