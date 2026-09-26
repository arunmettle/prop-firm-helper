import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertOctagon, ListPlus, ShieldCheck, Wallet } from 'lucide-react';
import { useActiveAccount } from '../components/AccountSwitcher';
import { RULE_TEXT, StatusBadge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorBox, Kbd, Meter, PageHeader, Spinner, Stat } from '../components/ui';
import { RecentTrades } from '../components/RecentTrades';
import { api } from '../lib/api';
import { fmtMinutes, fmtMoney, fmtSignedMoney, signClass } from '../lib/format';
import type { AccountDto, AccountStatusDto } from '../lib/types';

export function useAccountStatus(account: AccountDto | null) {
  return useQuery({
    queryKey: ['status', account?.id],
    queryFn: () => api.get<AccountStatusDto>(`/api/accounts/${account!.id}/status`),
    enabled: !!account,
    refetchInterval: 60_000,
  });
}

export function DashboardPage() {
  const { account, isLoading } = useActiveAccount();
  const status = useAccountStatus(account);
  if (isLoading) return <Spinner />;
  if (!account)
    return (
      <>
        <PageHeader title="Dashboard" description="Where you stand today against your evaluation rules." />
        <EmptyState
          icon={<Wallet className="size-5" />}
          title="Add your evaluation account"
          action={
            <Link to="/accounts/new">
              <Button variant="primary">Add account</Button>
            </Link>
          }
        >
          Start by entering your challenge rules. Every number in Cooldown is computed from them.
        </EmptyState>
      </>
    );

  const cur = account.currency;
  const e = status.data?.evaluation;
  const t = status.data?.today;
  const tr = account.traderRules;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {account.label} {e && <StatusBadge status={e.status} />}
          </span>
        }
        description={
          e?.currentDay
            ? `Trading day ${e.currentDay} (${account.rules.dayResetTimezone}) · day ${e.calendarDaysElapsed}${account.rules.maxCalendarDays ? ` of ${account.rules.maxCalendarDays}` : ''}`
            : 'No trades yet.'
        }
        actions={
          <>
            <Link to="/trades/new">
              <Button icon={<ListPlus className="size-4" />}>
                Log trade <Kbd>N</Kbd>
              </Button>
            </Link>
            <Link to="/check">
              <Button variant="primary" icon={<ShieldCheck className="size-4" />}>
                Pre-trade check
              </Button>
            </Link>
          </>
        }
      />
      {status.error && <ErrorBox error={status.error} />}
      {status.isLoading && <Spinner />}
      {e && t && (
        <div className="space-y-5">
          {e.breached && (
            <div className="flex items-start gap-3 rounded-xl border border-stop/30 bg-stop-soft px-4 py-3 text-sm">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-stop" />
              <div>
                <div className="font-medium text-stop">{RULE_TEXT[e.breached.rule]} breached</div>
                <div className="num text-fg-muted">
                  Equity reached {fmtMoney(e.breached.equity, cur)} against a floor of {fmtMoney(e.breached.floor, cur)} (
                  {new Date(e.breached.at).toLocaleString()}).
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Balance" value={fmtMoney(e.balance, cur)} sub={<span className={signClass(e.balance - e.startingBalance)}>{fmtSignedMoney(e.balance - e.startingBalance, cur)} since start</span>} />
            <div className="rounded-xl border border-line bg-surface px-4 py-3.5" title={`Target balance ${fmtMoney(e.profitTargetBalance, cur)}`}>
              <div className="text-[12px] font-medium text-fg-muted">Profit target</div>
              <div className="num mt-1 text-[22px] leading-tight font-semibold">{Math.round(Math.max(0, e.profitProgress) * 100)}%</div>
              <div className="mt-2.5">
                <Meter value={e.profitProgress} tone="go" label="Profit progress" />
              </div>
              <div className="num mt-1.5 text-xs text-fg-subtle">
                {fmtMoney(Math.max(0, e.profitTargetBalance - e.balance), cur)} to go
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface px-4 py-3.5" title={`Today's floor ${fmtMoney(e.dailyFloor, cur)} (from ${fmtMoney(e.dayStartReference, cur)} start-of-day minus ${fmtMoney(e.dailyLossLimit, cur)})`}>
              <div className="text-[12px] font-medium text-fg-muted">Daily loss left today</div>
              <div className={`num mt-1 text-[22px] leading-tight font-semibold ${e.dailyLossRemaining < e.dailyLossLimit * 0.3 ? 'text-caution' : ''}`}>
                {fmtMoney(e.dailyLossRemaining, cur)}
              </div>
              <div className="mt-2.5">
                <Meter value={e.dailyLossRemaining / e.dailyLossLimit} tone={e.dailyLossRemaining < e.dailyLossLimit * 0.3 ? 'caution' : 'accent'} label="Daily budget" />
              </div>
              <div className="num mt-1.5 text-xs text-fg-subtle">of {fmtMoney(e.dailyLossLimit, cur)} · floor {fmtMoney(e.dailyFloor, cur, 0)}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface px-4 py-3.5" title={`Max-loss floor ${fmtMoney(e.maxLossFloor, cur)}${account.rules.maxLossType !== 'static' ? `, high-water mark ${fmtMoney(e.highWaterMark, cur)}` : ''}`}>
              <div className="text-[12px] font-medium text-fg-muted">Distance to max-loss floor</div>
              <div className="num mt-1 text-[22px] leading-tight font-semibold">{fmtMoney(e.distanceToMaxLoss, cur)}</div>
              <div className="mt-2.5">
                <Meter value={e.distanceToMaxLoss / ((e.startingBalance * account.rules.maxLossPct) / 100)} label="Max loss buffer" />
              </div>
              <div className="num mt-1.5 text-xs text-fg-subtle">floor {fmtMoney(e.maxLossFloor, cur, 0)} · {account.rules.maxLossType.replace('_', ' ')}</div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
            <Card title="Today" subtitle="Against your own rules">
              <dl className="space-y-3 text-sm">
                <Row
                  label="Trades today"
                  value={`${t.tradesToday}${tr.maxTradesPerDay ? ` / ${tr.maxTradesPerDay}` : ''}`}
                  warn={!!tr.maxTradesPerDay && t.tradesToday >= tr.maxTradesPerDay}
                />
                <Row
                  label="Losses in a row today"
                  value={`${t.consecutiveLossesToday}${tr.stopAfterLosses ? ` / ${tr.stopAfterLosses}` : ''}`}
                  warn={!!tr.stopAfterLosses && t.consecutiveLossesToday >= tr.stopAfterLosses}
                />
                <Row label="P&L today" value={<span className={signClass(t.pnlToday)}>{fmtSignedMoney(t.pnlToday, cur)}</span>} />
                <Row
                  label="Since last loss"
                  value={fmtMinutes(t.minutesSinceLastLoss)}
                  warn={t.minutesSinceLastLoss != null && t.minutesSinceLastLoss < tr.cooldownMinutes}
                />
                <Row
                  label="Trading days"
                  value={`${e.tradingDays}${account.rules.minTradingDays ? ` / ${account.rules.minTradingDays} min` : ''}`}
                />
                {account.rules.consistencyRulePct && (
                  <Row
                    label="Consistency (best day)"
                    value={fmtMoney(e.bestDayProfit, cur, 0)}
                    warn={!e.consistencyOk}
                  />
                )}
              </dl>
            </Card>
            <RecentTrades account={account} />
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`num font-medium ${warn ? 'text-caution' : ''}`}>{value}</dd>
    </div>
  );
}
