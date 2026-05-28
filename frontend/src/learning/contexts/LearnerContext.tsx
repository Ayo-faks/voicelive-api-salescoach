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

export interface LearnerContextValue {
  userId: string | null
  weakTopics: LearnerWeakTopic[]
  dailyPlan: LearnerDailyPlanItem[]
  careerFits: LearnerCareerFit[]
  lastWrongAnswer: LearnerLastWrongAnswer | null
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
}

export const LearnerContext = createContext<LearnerContextValue>(
  defaultLearnerContext
)

export function useLearnerContext(): LearnerContextValue {
  return useContext(LearnerContext)
}
