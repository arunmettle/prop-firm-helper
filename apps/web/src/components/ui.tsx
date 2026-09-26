import { cn as clsx } from '../lib/cn';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { DISCLAIMER } from '@cooldown/core';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'lg' && 'h-11 px-5 text-[15px]',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line-strong bg-surface-2 text-fg hover:bg-surface-3',
        variant === 'ghost' && 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'border border-stop/40 bg-stop-soft text-stop hover:bg-stop/20',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

const fieldBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(fieldBase, 'h-9', invalid && 'border-stop/70', rest.type === 'number' && 'num', className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={clsx(fieldBase, 'min-h-20 py-2', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx(fieldBase, 'h-9 appearance-none bg-no-repeat pr-8', className)} style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa6b4' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      backgroundPosition: 'right 10px center',
    }} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium tracking-wide text-fg-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-stop">{error}</p> : hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  collapsed,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  collapsed?: boolean;
}) {
  return (
    <section className={clsx('rounded-[var(--radius-card)] border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className={clsx('flex items-start justify-between gap-4 px-5 py-3.5', !collapsed && 'border-b border-line')}>
          <div>
            {title && <h2 className="text-[14px] font-semibold text-fg">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {!collapsed && <div className={clsx('p-5', bodyClassName)}>{children}</div>}
    </section>
  );
}

type Tone = 'neutral' | 'accent' | 'go' | 'caution' | 'stop' | 'info';
export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-3 text-fg-muted',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'go' && 'bg-go-soft text-go',
        tone === 'caution' && 'bg-caution-soft text-caution',
        tone === 'stop' && 'bg-stop-soft text-stop',
        tone === 'info' && 'bg-info/10 text-info',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'go' | 'caution' | 'stop';
  title?: string;
}) {
  return (
    <div title={title} className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[12px] font-medium text-fg-muted">{label}</div>
      <div
        className={clsx(
          'num mt-1 text-[22px] leading-tight font-semibold tracking-tight',
          tone === 'go' && 'text-go',
          tone === 'caution' && 'text-caution',
          tone === 'stop' && 'text-stop',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-fg-subtle">{sub}</div>}
    </div>
  );
}

export function Meter({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'go' | 'caution' | 'stop'; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={pct} aria-label={label}>
      <div
        className={clsx(
          'h-full rounded-full transition-[width] duration-500',
          tone === 'accent' && 'bg-accent',
          tone === 'go' && 'bg-go',
          tone === 'caution' && 'bg-caution',
          tone === 'stop' && 'bg-stop',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-xl bg-surface-2 text-fg-muted">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, title = 'Couldn’t load this' }: { error: unknown; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-xl border border-stop/30 bg-stop-soft px-4 py-3 text-sm">
      <div className="font-medium text-stop">{title}</div>
      <div className="mt-0.5 text-fg-muted">{msg}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-fg-muted justify-center">
      <Loader2 className="size-4 animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={clsx('flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg-muted', className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      {DISCLAIMER}
    </p>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-px font-mono text-[10px] text-fg-muted">{children}</kbd>
  );
}

/** Stat value that hides itself behind "not enough data" when n is below a threshold. */
export function Gated({ n, min = 10, children }: { n: number; min?: number; children: ReactNode }) {
  if (n < min)
    return (
      <span className="text-sm font-normal text-fg-subtle" title={`Needs at least ${min} trades`}>
        not enough data yet (n={n})
      </span>
    );
  return <>{children}</>;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: 'go' | 'stop' }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md px-3 font-medium transition-colors',
            size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
            value === o.value
              ? o.tone === 'go'
                ? 'bg-go-soft text-go'
                : o.tone === 'stop'
                  ? 'bg-stop-soft text-stop'
                  : 'bg-surface-3 text-fg'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
