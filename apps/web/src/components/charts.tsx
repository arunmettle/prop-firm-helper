import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { ReactNode } from 'react';

const POS = 'var(--color-viz-pos)';
const NEG = 'var(--color-viz-neg)';
const MID = 'var(--color-viz-mid)';
const axis = { fill: 'var(--color-fg-subtle)', fontSize: 11 };

function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-xl">
      {children}
    </div>
  );
}

/** R-multiple histogram. Diverging: orange = losing bins, gray = around zero, blue = winning bins. */
export function RDistributionChart({ data }: { data: { bin: string; n: number }[] }) {
  const color = (i: number) => (i < 2 ? NEG : i === 2 ? MID : POS);
  const total = data.reduce((s, d) => s + d.n, 0);
  return (
    <div className="h-56" role="img" aria-label="Distribution of R-multiples">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap={6}>
          <CartesianGrid vertical={false} stroke="var(--color-viz-grid)" />
          <XAxis
            dataKey="bin"
            tick={axis}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-strong)' }}
            interval={0}
          />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <TooltipBox>
                  <div className="font-medium text-fg">{payload[0].payload.bin}</div>
                  <div className="num text-fg-muted">
                    {payload[0].payload.n} trades ·{' '}
                    {total ? Math.round((payload[0].payload.n / total) * 100) : 0}%
                  </div>
                </TooltipBox>
              ) : null
            }
          />
          <Bar dataKey="n" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((_, i) => (
              <Cell key={i} fill={color(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface GroupDatum {
  key: string;
  label: string;
  value: number | null;
  n: number;
  enough: boolean;
  sub?: string;
}

/** Horizontal bars of a signed value (avg R / net R), one per group, with n on every row. */
export function SignedBars({
  data,
  unit = 'R',
  onSelect,
}: {
  data: GroupDatum[];
  unit?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(0.5, ...data.map((d) => Math.abs(d.value ?? 0)));
  return (
    <div className="space-y-1.5">
      {data.map((d) => {
        const v = d.value ?? 0;
        const w = (Math.abs(v) / max) * 50;
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onSelect?.(d.key)}
            className="group grid w-full grid-cols-[120px_1fr_120px] items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-surface-2/60"
            title={
              d.enough
                ? `${d.label}: ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}${unit} over ${d.n} trades`
                : `Not enough data yet (n=${d.n})`
            }
          >
            <span className="truncate text-[13px] text-fg-muted group-hover:text-fg">{d.label}</span>
            <span className="relative h-5">
              <span className="absolute top-0 left-1/2 h-full w-px bg-line-strong" />
              {d.enough && d.value !== null && (
                <span
                  className="absolute top-1 h-3 rounded-[3px]"
                  style={{
                    left: v >= 0 ? '50%' : `${50 - w}%`,
                    width: `${Math.max(w, 0.5)}%`,
                    background: v >= 0 ? POS : NEG,
                  }}
                />
              )}
              {!d.enough && (
                <span
                  className="absolute top-1 left-[35%] h-3 w-[30%] rounded-[3px] border border-dashed border-line-strong"
                  style={{
                    background:
                      'repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.05) 4px 6px)',
                  }}
                />
              )}
            </span>
            <span className="num text-right text-[12px]">
              {d.enough && d.value !== null ? (
                <span className="text-fg">
                  {v >= 0 ? '+' : '−'}
                  {Math.abs(v).toFixed(2)}
                  {unit}
                </span>
              ) : (
                <span className="text-fg-subtle">not enough data</span>
              )}
              <span className="ml-1.5 text-fg-subtle">n={d.n}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
