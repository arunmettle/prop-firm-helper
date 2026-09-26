import { isUncertain } from './validate.js';
import type { Answers } from './types.js';
import { BEHAVIOUR_V1, NOTE_CLASSIFIER_V1, NOTE_LABELS_VERSION, OVERRIDE_JUSTIFIED_V1 } from './questions.js';

/** What is stored in trades.note_labels. Every value carries its own `uncertain` flag. */
export interface NoteLabels {
  version: string;
  primary_driver: { value: string; confidence: number; uncertain: boolean };
  followed_own_plan: { p: number; uncertain: boolean };
  impulsiveness: { value: string; score: number; confidence: number; uncertain: boolean };
  override_justified?: { p: number; uncertain: boolean };
  tilt_behaviour: { p: number; uncertain: boolean };
}

export const LABEL_QUESTIONS = { ...NOTE_CLASSIFIER_V1, ...BEHAVIOUR_V1 };
export const LABEL_QUESTIONS_WITH_OVERRIDE = { ...NOTE_CLASSIFIER_V1, ...OVERRIDE_JUSTIFIED_V1, ...BEHAVIOUR_V1 };

export function toNoteLabels(
  a: Answers<typeof LABEL_QUESTIONS> & Partial<Answers<typeof OVERRIDE_JUSTIFIED_V1>>,
): NoteLabels {
  const imp = a.impulsiveness;
  return {
    version: NOTE_LABELS_VERSION,
    primary_driver: { value: a.primary_driver.choice, confidence: a.primary_driver.confidence, uncertain: isUncertain(a.primary_driver) },
    followed_own_plan: { p: a.followed_own_plan.noul, uncertain: isUncertain(a.followed_own_plan) },
    impulsiveness: {
      value: NOTE_CLASSIFIER_V1.impulsiveness.criteria[imp.score] ?? String(imp.score),
      score: imp.score,
      confidence: imp.confidence,
      uncertain: isUncertain(imp),
    },
    ...(a.override_justified
      ? { override_justified: { p: a.override_justified.noul, uncertain: isUncertain(a.override_justified) } }
      : {}),
    tilt_behaviour: { p: a.tilt_behaviour.noul, uncertain: isUncertain(a.tilt_behaviour) },
  };
}
