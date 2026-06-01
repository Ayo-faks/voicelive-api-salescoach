/**
 * LearnerContext — shared learner profile signals consumed by the unified
 * Ask Pathfinder drawer (FAB lives in the app shell, not on a specific route).
 *
 * Phase 1 ships static defaults that mirror what `StudentLearningHome` renders
 * (weak topics, daily plan, career fits) so the deterministic assistant can
 * quote the learner's profile back to them without a round-trip. Phase 2
 * (see `/memories/repo/pathfinder-ask-assistant-phase2.md`) will replace the
 * defaults with values pushed from the Home route + voice transcripts.
 */
import { createContext, useContext } from 'react'

export type LearnerWeakTopic = {
  skillId: string
  label: string
  mastery?: number
}

export type LearnerDailyPlanItem = {
  id: string
  title: string
  minutes?: number
}

export type LearnerCareerFit = {
  id: string
  label: string
  url?: string
}

export type LearnerLastWrongAnswer = {
  skillId: string
  label: string
}

/**
 * The diagnostic/practice item the learner is currently looking at. When set,
 * the Dig-Deeper drawer anchors the tutor on it: the model grounds its reply on
 * this item (and keeps Socratic guidance while `scored` is false so it never
 * hands over the answer mid-assessment). All fields optional — an absent focus
 * item means a free-form question.
 */
export type LearnerFocusItem = {
  stem?: string
  options?: string[]
  chosen?: string
  correct?: string
  rationale?: string
  skillId?: string
  misconception?: string
  scored?: boolean
}

/** Subject + year group used to scope curriculum retrieval. */
export type LearnerSetupSignal = {
  subject?: string
  yearGroup?: string
}

/**
 * A past wrong attempt the learner made, tagged with the misconception it hit.
 * Feeds the consent-gated episodic "trap recall" callback (Phase 5): when the
 * same misconception recurs, the tutor opens with a heads-up nudge. This is
 * working memory pushed from the practice/diagnostic flow; the backend also has
 * a durable episodic store, so this list may be empty without losing recall.
 */
export type LearnerAttempt = {
  misconceptionCode: string
  topic: string
  correct?: boolean
  occurredAt?: string
}

export interface LearnerContextValue {
  userId: string | null
  weakTopics: LearnerWeakTopic[]
  dailyPlan: LearnerDailyPlanItem[]
  careerFits: LearnerCareerFit[]
  lastWrongAnswer: LearnerLastWrongAnswer | null
  focusItem: LearnerFocusItem | null
  learnerSetup: LearnerSetupSignal | null
  attemptHistory: LearnerAttempt[]
}

export const defaultLearnerContext: LearnerContextValue = {
  userId: null,
  weakTopics: [
    { skillId: 'ratio-proportion', label: 'Ratio and proportion', mastery: 42 },
    {
      skillId: 'fraction-operations',
      label: 'Fraction operations',
      mastery: 61,
    },
    { skillId: 'reading-inference', label: 'Reading inference', mastery: 68 },
  ],
  dailyPlan: [
    { id: 'diagnostic-refresh', title: 'Ratio mini diagnostic', minutes: 5 },
    { id: 'mistake-review', title: 'Explain one mistake', minutes: 4 },
    { id: 'career-link', title: 'Career fit check', minutes: 3 },
  ],
  careerFits: [
    { id: 'health-sciences', label: 'Health sciences' },
    { id: 'data-business', label: 'Data and business operations' },
    { id: 'renewable-energy', label: 'Renewable energy technician' },
  ],
  lastWrongAnswer: null,
  focusItem: null,
  learnerSetup: null,
  attemptHistory: [],
}

export const LearnerContext = createContext<LearnerContextValue>(
  defaultLearnerContext
)

export function useLearnerContext(): LearnerContextValue {
  return useContext(LearnerContext)
}
