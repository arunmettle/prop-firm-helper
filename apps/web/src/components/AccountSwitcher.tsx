import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { useActiveAccountId } from '../lib/hooks';
import type { AccountDto } from '../lib/types';
import { Select } from './ui';

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountDto[]>('/api/accounts') });
}

/** Resolves the active account, falling back to the first active one. */
export function useActiveAccount(): {
  account: AccountDto | null;
  accounts: AccountDto[];
  isLoading: boolean;
} {
  const { data, isLoading } = useAccounts();
  const [id, setId] = useActiveAccountId();
  const accounts = data ?? [];
  const active = accounts.find((a) => a.id === id) ?? accounts.find((a) => a.status === 'active') ?? null;
  useEffect(() => {
    if (active && active.id !== id) setId(active.id);
  }, [active, id, setId]);
  return { account: active, accounts, isLoading };
}

export function AccountSwitcher() {
  const { account, accounts } = useActiveAccount();
  const [, setId] = useActiveAccountId();
  if (!accounts.length) return null;
  return (
    <Select
      aria-label="Active account"
      value={account?.id ?? ''}
      onChange={(e) => setId(e.target.value)}
      className="h-9 bg-surface-2 text-[13px]"
    >
      {accounts
        .filter((a) => a.status === 'active' || a.id === account?.id)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
    </Select>
  );
}
