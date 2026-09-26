import { defineQuestions } from './types.js';

/**
 * Versioned question sets. Bump the version string whenever a set changes; trades whose `labels_version`
 * differs can be re-labelled from the Trades page.
 */

export const NOTE_CLASSIFIER_V1 = defineQuestions({
  primary_driver: {
    type: 'choice',
    instructions:
      'What mainly drove this trading decision? Use `pre_note` (written before entry), `override_kind`, `override_note`, and context such as `minutes_since_previous_loss`, `trades_earlier_today` and `size_vs_user_average`.',
    criteria: {
      plan: 'Followed a defined setup or rule',
      fomo: 'Chasing a move that was already underway',
      revenge: 'Trying to win back a recent loss',
      fear: 'Exiting or avoiding because of anxiety',
      greed: 'Holding or adding beyond the plan for more profit',
      boredom: 'Trading for activity without a real setup',
      unclear: 'Not enough information to tell',
    },
  },
  followed_own_plan: {
    type: 'noul',
    instructions:
      'Did the trader follow their own plan on this trade, judging from `pre_note`, `override_kind` and `override_note`?',
    criteria: {
      true: 'The note describes a planned setup and any change was part of the plan',
      false: 'The note or override shows the trader departed from their plan',
    },
  },
  impulsiveness: {
    type: 'score',
    instructions:
      'How impulsive was the decision to take or manage this trade, based on `pre_note` and the timing context?',
    criteria: ['Deliberate', 'Somewhat rushed', 'Impulsive'],
  },
});

export const OVERRIDE_JUSTIFIED_V1 = defineQuestions({
  override_justified: {
    type: 'noul',
    instructions:
      'The trader changed the trade mid-way (`override_kind`). Was the change a defined plan rule (e.g. exiting before news, a time stop) rather than an emotional reaction? Use `override_note`.',
    criteria: {
      true: 'The change follows a stated rule or plan',
      false: 'The change was an emotional or unplanned reaction',
    },
  },
});

export const BEHAVIOUR_V1 = defineQuestions({
  tilt_behaviour: {
    type: 'noul',
    instructions:
      'Was this trade taken or managed in a tilted, emotional state rather than according to plan? Consider `pre_note`, `override_kind`, `size_vs_user_average`, `minutes_since_previous_loss`, `trades_earlier_today` and `precheck` if present.',
    criteria: {
      true: 'Tilt: emotional, reactive, or outside the trader’s own rules',
      false: 'Plan: consistent with the trader’s own setups and rules',
    },
  },
});

export const PRECHECK_V1 = defineQuestions({
  tilt_risk: {
    type: 'score',
    instructions:
      'Given `today` (trades so far, losses in a row, minutes since last loss), `recent_trades` (outcomes and labels) and `pre_note`, how high is the risk that this trader is acting from tilt right now? Do not judge the market or the trade idea.',
    criteria: ['Low', 'Elevated', 'High'],
  },
  matches_stated_setup: {
    type: 'noul',
    instructions:
      'Does `pre_note` describe one of the trader’s own setups listed in `stated_setups` or `setup_tag`?',
    criteria: {
      true: 'The note describes one of the stated setups',
      false: 'The note does not describe a stated setup',
    },
  },
  likely_impulse: {
    type: 'noul',
    instructions:
      'Does `pre_note`, together with `today`, suggest this entry is an impulse rather than a planned decision?',
    criteria: { true: 'Likely an impulse entry', false: 'Likely a planned entry' },
  },
});

export const NOTE_LABELS_VERSION = 'note-v1+behaviour-v1';
export const PRECHECK_VERSION = 'precheck-v1';

export type DriverKey = keyof (typeof NOTE_CLASSIFIER_V1)['primary_driver']['criteria'];
export const TILT_DRIVERS: DriverKey[] = ['fomo', 'revenge', 'greed', 'boredom'];
