/**
 * pnpm jev:ping — one real Jev call with a synthetic note (no user data) to verify the configured provider,
 * key, model and response shape. Prints the parsed answers, latency, tokens and cost.
 */
import { LABEL_QUESTIONS, PRECHECK_V1 } from '@cooldown/core/jev';
import { loadConfig } from '../config.js';
import { createJevFromConfig } from '../services/jev.js';

const cfg = loadConfig();
const jev = createJevFromConfig(cfg);
console.info(
  `[jev:ping] provider=${jev.provider}${cfg.jev.provider === 'openrouter' ? ` model=${cfg.jev.openrouterModel}` : ''}`,
);
try {
  const a = await jev.evaluate(
    {
      pre_note: 'Missed the first move, jumping in before it runs away',
      override_kind: null,
      override_note: null,
      exit_type: 'stop',
      r_multiple: -1,
      minutes_since_previous_loss: 8,
      trades_earlier_today: 2,
      size_vs_user_average: 1.8,
      precheck: null,
    },
    LABEL_QUESTIONS,
  );
  console.info('[jev:ping] note classifier:', JSON.stringify(a.answers, null, 2));
  console.info(
    `[jev:ping] latency=${a.latencyMs}ms tokens=${a.usage.input_tokens}/${a.usage.output_tokens} cost=$${(a.usage.cost ?? 0).toFixed(6)}`,
  );
  const p = await jev.evaluate(
    {
      pre_note: 'London breakout retest',
      today: { trades_so_far: 1, consecutive_losses: 0, minutes_since_last_loss: null },
      stated_setups: ['London breakout retest'],
    },
    PRECHECK_V1,
  );
  console.info('[jev:ping] precheck:', JSON.stringify(p.answers, null, 2));
  console.info(`[jev:ping] OK latency=${p.latencyMs}ms`);
} catch (err) {
  console.error(`[jev:ping] FAILED: ${(err as Error).message}`);
  process.exit(1);
}
