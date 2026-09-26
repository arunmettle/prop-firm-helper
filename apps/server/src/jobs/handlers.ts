import type { HandlerSet } from './queue.js';

/** Job handlers are registered here as features land. */
export const handlers: HandlerSet = {
  run: {},
  onFinalFailure: {},
};
