# Risks: things that could silently produce wrong numbers

- **Floating P&L is invisible.** We only see closed trades. Firms measure equity (incl. open positions) intraday; a trade that dipped through a floor and recovered would breach at the firm but not in `evaluateAccount`. Mitigation: the simulator uses a pessimistic −1R intraday path; real-history checks are labelled as based on closed trades.
- **`start_of_day_equity_or_balance_higher` is approximated by balance** for real history (we don't know floating P&L at the reset). If a position was open over the reset in profit, the real floor is higher (stricter) than ours → we would be optimistic.
- **Trailing intraday uses realised peaks.** Real firms often trail unrealised equity peaks, which is stricter.
- **"Exactly at the floor" semantics** vary by firm (some treat touching as a breach). We treat touching as allowed.
- **Instrument contract sizes and point values** vary by broker (esp. index CFDs). Wrong spec → wrong risk, R and position size. Defaults are shown with their formula and are overridable.
- **Manual P&L vs price-based P&L.** If the user enters net P&L (after commissions/swap), R-multiples use it; price-based P&L ignores commissions and swap.
- **Trades without a stop** have no risk amount and no R; they are excluded from R statistics (but count toward P&L and rules).
