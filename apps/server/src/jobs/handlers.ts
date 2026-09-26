import type { HandlerSet } from './queue.js';
import { labelTradesJob } from '../services/labelling.js';

export const handlers: HandlerSet = {
  run: {
    label_trades: labelTradesJob,
  },
  onFinalFailure: {},
};
