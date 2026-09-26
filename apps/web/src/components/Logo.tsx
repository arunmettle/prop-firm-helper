export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#101a22" stroke="#223040" />
      <path
        d="M9 20c2.5-6 11.5-6 14 0"
        stroke="#5eead4"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="16" cy="12" r="2.4" fill="#5eead4" />
    </svg>
  );
}
