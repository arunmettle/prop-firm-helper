import clsx from 'clsx';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Coins,
  FileUp,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api';
import { useHotkey, type Me } from '../lib/hooks';
import { Logo } from './Logo';
import { AccountSwitcher } from './AccountSwitcher';
import { Kbd } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/check', label: 'Pre-trade check', icon: ShieldCheck, key: 'p' },
  { to: '/trades', label: 'Trades', icon: ListOrdered, key: 't' },
  { to: '/import', label: 'Import CSV', icon: FileUp },
  { to: '/insights', label: 'Insights', icon: BarChart3, key: 'i' },
  { to: '/simulate', label: 'Simulator', icon: Activity, key: 's' },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
];

export function Layout({ me, children }: { me: Me; children: ReactNode }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  useHotkey('p', () => nav('/check'));
  useHotkey('t', () => nav('/trades'));
  useHotkey('n', () => nav('/trades/new'));
  useHotkey('i', () => nav('/insights'));
  useHotkey('s', () => nav('/simulate'));

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    window.location.href = '/';
  };

  return (
    <div className="flex h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface/60 md:flex">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Cooldown</span>
        </div>
        <div className="px-3 pb-3">
          <AccountSwitcher />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 scrollbar-thin">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx(
                  'group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                  isActive ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <n.icon className="size-4 shrink-0" />
              <span className="flex-1">{n.label}</span>
              {n.key && (
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                  <Kbd>{n.key.toUpperCase()}</Kbd>
                </span>
              )}
            </NavLink>
          ))}
          {me.isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                clsx(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                  isActive ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Gauge className="size-4" /> Admin
            </NavLink>
          )}
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          <NavLink
            to="/credits"
            className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <Coins className="size-4" />
            <span className="flex-1">Credits</span>
            <span
              className="num rounded-md bg-accent-soft px-1.5 text-xs font-semibold text-accent"
              data-testid="credit-balance"
            >
              {me.credits}
            </span>
          </NavLink>
          <NavLink
            to="/settings"
            className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <Settings className="size-4" /> Settings
          </NavLink>
          <div className="flex items-center gap-2 px-2.5 pt-2">
            <div className="grid size-7 place-items-center rounded-full bg-surface-3 text-xs font-semibold uppercase text-fg-muted">
              {me.email[0]}
            </div>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle" title={me.email}>
              {me.email}
            </span>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-md p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact top bar for tablets */}
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
          <Logo className="size-6" />
          <div className="flex-1">
            <AccountSwitcher />
          </div>
          <nav className="flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className="rounded-md p-2 text-fg-muted hover:bg-surface-2"
                title={n.label}
              >
                <n.icon className="size-4" />
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 py-7 md:px-8">{children}</main>
      </div>
    </div>
  );
}
