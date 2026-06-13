// Pure derivation of the learner-home intent chips (PRD: Home Activation F1).
// Chips are computed entirely from data the home already fetched — zero new
// API calls — and every chip routes into an existing, already-gated flow.
// A chip whose action would land on an empty state is never emitted.

import type { LearnerWeeklyStatsResponse } from '../api'

export type HomeChipAction =
  | { kind: 'study'; skillId: string | null; skillLabel: string | null }
  | { kind: 'stats' }
  | { kind: 'ask'; mode: 'text' | 'voice' }
  | { kind: 'goal' }
  | { kind: 'quiz' }

export type HomeChip = {
  id: string
  label: string
  /** Full intent for screen readers (F1.5). */
  ariaLabel: string
  action: HomeChipAction
}

export type HomeChipInputs = {
  /** Real weekly stats, or null while loading / on error / flag off. */
  stats: LearnerWeeklyStatsResponse | null
  /** Weak-topic profile already on the home (skill id + display label). */
  weakTopics: Array<{ skillId: string; label: string }>
  /** Today's revision/plan queue; empty = no plan yet (cold start). */
  planItems: Array<{ skillId: string; label: string }>
  /** Ask Wulo overlay reachable from this surface (AskSurfaceProvider mounted). */
  askAvailable: boolean
  /** Learner voice fully available (flag + config + safety gate). */
  voiceAvailable: boolean
  /**
   * Unified assistant surface active. When true, the standalone text "Ask
   * Wulo" chip is dropped: the one morphing surface (reached via Study with
   * Wulo / voice) already opens with a text composer, so a separate typed
   * entry is redundant clutter. Voice keeps its own chip. Default false.
   */
  unified?: boolean
}

function hasStatsEvidence(stats: LearnerWeeklyStatsResponse | null): boolean {
  if (!stats) return false
  return (
    stats.sessions.completed > 0 ||
    stats.streak_days > 0 ||
    stats.mastery_focus_label !== ''
  )
}

/** Fixed, predictable order (no behaviour-based reshuffling for children). */
export function deriveHomeChips(inputs: HomeChipInputs): HomeChip[] {
  const {
    stats,
    weakTopics,
    planItems,
    askAvailable,
    voiceAvailable,
    unified = false,
  } = inputs
  const chips: HomeChip[] = []
  const warm = hasStatsEvidence(stats) || weakTopics.length > 0 || planItems.length > 0

  // The tutor hub is the flagship entry, warm or cold. Warm learners get the
  // chip anchored on their focus skill ("Study Differentiation with Wulo") so
  // the call to action stays specific; cold learners get the plain hub.
  const focusSkill = weakTopics[0] ?? planItems[0] ?? null
  chips.push({
    id: 'study-with-wulo',
    label: focusSkill ? `Study ${focusSkill.label} with Wulo` : 'Study with Wulo',
    ariaLabel: focusSkill
      ? `Start a tutor session with Wulo on ${focusSkill.label}`
      : 'Start a tutor session with Wulo',
    action: {
      kind: 'study',
      skillId: focusSkill?.skillId ?? null,
      skillLabel: focusSkill?.label ?? null,
    },
  })

  if (warm) {
    if (hasStatsEvidence(stats)) {
      chips.push({
        id: 'how-am-i-doing',
        label: 'How am I doing?',
        ariaLabel: 'See your weekly stats and mastery progress',
        action: { kind: 'stats' },
      })
    }
  } else {
    // Cold start: onboarding-flavoured starters, never a dead-end chip.
    chips.push({
      id: 'first-goal',
      label: 'Set my first goal',
      ariaLabel: 'Set your first study goal',
      action: { kind: 'goal' },
    })
    chips.push({
      id: 'quick-quiz',
      label: 'Try a quick quiz',
      ariaLabel: 'Try a quick practice quiz',
      action: { kind: 'quiz' },
    })
  }

  if (askAvailable) {
    // Unified surface folds free-form typed asking into the one morphing
    // surface (it opens with a composer), so the standalone text chip is
    // dropped to cut clutter; Study with Wulo + voice remain the entries.
    if (!unified) {
      chips.push({
        id: 'ask-wulo',
        label: 'Ask Wulo something',
        ariaLabel: 'Ask Wulo a question by typing',
        action: { kind: 'ask', mode: 'text' },
      })
    }
    if (voiceAvailable) {
      chips.push({
        id: 'talk-it-through',
        label: 'Talk it through',
        ariaLabel: 'Talk it through with Wulo by voice',
        action: { kind: 'ask', mode: 'voice' },
      })
    }
  }

  return chips.slice(0, 5)
}
