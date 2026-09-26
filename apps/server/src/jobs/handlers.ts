import type { HandlerSet } from './queue.js';
import { labelTradesJob } from '../services/labelling.js';
import { simulateFailed, simulateJob } from '../services/simulation.js';

export const handlers: HandlerSet = {
  run: {
    label_trades: labelTradesJob,
    simulate: simulateJob,
  },
  onFinalFailure: {
    simulate: simulateFailed,
  },
};
