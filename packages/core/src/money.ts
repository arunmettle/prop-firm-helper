/** Money helpers. All comparisons against limits are done in integer cents to avoid float drift. */

export const toCents = (x: number): number => Math.round(x * 100);

/** Round to 2 decimals (half away from zero via Math.round on cents). */
export const round2 = (x: number): number => toCents(x) / 100;

/** a < b in cents. */
export const ltCents = (a: number, b: number): boolean => toCents(a) < toCents(b);
/** a >= b in cents. */
export const gteCents = (a: number, b: number): boolean => toCents(a) >= toCents(b);

export const roundTo = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};
