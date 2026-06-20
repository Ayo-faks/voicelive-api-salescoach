// Pure derivation of the actionable stat cards (PRD: Home Activation F2).
// Every card follows `{number} → {meaning line} → {CTA}`; a card with zero
// evidence renders an honest, encouraging empty variant instead of demo data.

import type { LearnerWeeklyStatsResponse } from '../api'

export type StatCardAction =
  | { kind: 'practice'; skillId: string | null }
  | { kind: 'plan' }

export type ActionableStatCard = {
  id: 'sessions' | 'mastery' | 'weak-topics' | 'streak'
  label: string
  value: string
  /** One plain-language line saying what the number means. */
  meaning: string
  cta: { label: string; action: StatCardAction } | null
  /** Coarse bucket for telemetry (`value_band` on stat_card_cta_click). */
  band: string
}

export type ActionableStatInputs = {
  stats: LearnerWeeklyStatsResponse
  weakTopics: Array<{ skillId: string; label: string }>
  /** e.g. "JSSCE Maths" — used in the weak-topics meaning line when known. */
  examLabel?: string
}

export function deriveActionableStatCards(
  inputs: ActionableStatInputs
): ActionableStatCard[] {
  const { stats, weakTopics, examLabel } = inputs
  const cards: ActionableStatCard[] = []
  const focusSkillId = weakTopics[0]?.skillId ?? null

  // Sessions this week.
  const { completed, target } = stats.sessions
  const remaining = Math.max(0, target - completed)
  if (completed === 0) {
    cards.push({
      id: 'sessions',
      label: 'Sessions',
      value: `0 / ${target}`,
      meaning: 'No sessions yet this week — your first one starts the streak.',
      cta: { label: 'Start a session', action: { kind: 'practice', skillId: focusSkillId } },
      band: 'zero',
    })
  } else if (remaining > 0) {
    cards.push({
      id: 'sessions',
      label: 'Sessions',
      value: `${completed} / ${target}`,
      meaning: `${remaining} more ${remaining === 1 ? 'session' : 'sessions'} to hit your weekly goal.`,
      cta: { label: 'Start a session', action: { kind: 'practice', skillId: focusSkillId } },
      band: 'behind',
    })
  } else {
    cards.push({
      id: 'sessions',
      label: 'Sessions',
      value: `${completed} / ${target}`,
      meaning: 'Weekly goal hit — anything extra is a bonus.',
      cta: null,
      band: 'on_target',
    })
  }

  // Current mastery + weekly movement.
  const currentMastery = stats.current_mastery_pct
  const delta = stats.mastery_delta_pct
  const focusLabel = stats.mastery_focus_label
  if (typeof currentMastery !== 'number') {
    cards.push({
      id: 'mastery',
      label: 'Mastery',
      value: '—',
      meaning: 'Practise a few sessions to see your current mastery.',
      cta: { label: 'Start practising', action: { kind: 'practice', skillId: focusSkillId } },
      band: 'no_evidence',
    })
  } else if (delta >= 0) {
    cards.push({
      id: 'mastery',
      label: 'Mastery',
      value: `${Math.round(currentMastery)}%`,
      meaning: focusLabel
        ? `Weekly change +${delta}% — strongest recent focus: ${focusLabel}.`
        : `Weekly change +${delta}%.`,
      cta: { label: 'Keep it up', action: { kind: 'practice', skillId: focusSkillId } },
      band: delta > 0 ? 'positive' : 'flat',
    })
  } else {
    cards.push({
      id: 'mastery',
      label: 'Mastery',
      value: `${Math.round(currentMastery)}%`,
      meaning: focusLabel
        ? `Weekly change ${delta}% — practise ${focusLabel} to repair it.`
        : `Weekly change ${delta}% — a short session repairs it.`,
      cta: { label: 'Shore it up', action: { kind: 'practice', skillId: focusSkillId } },
      band: 'negative',
    })
  }

  // Weak topics detected.
  const weakCount = weakTopics.length
  if (weakCount > 0) {
    cards.push({
      id: 'weak-topics',
      label: 'Weak topics',
      value: String(weakCount),
      meaning: examLabel
        ? `${weakCount} ${weakCount === 1 ? 'topic needs' : 'topics need'} attention before ${examLabel}.`
        : `${weakCount} ${weakCount === 1 ? 'topic needs' : 'topics need'} attention.`,
      cta: { label: 'Practise these', action: { kind: 'practice', skillId: focusSkillId } },
      band: weakCount >= 3 ? 'high' : 'low',
    })
  } else {
    cards.push({
      id: 'weak-topics',
      label: 'Weak topics',
      value: '0',
      meaning: 'No weak topics detected yet — keep practising to map your gaps.',
      cta: null,
      band: 'zero',
    })
  }

  // Streak. We cannot tell client-side whether the learner has already
  // practised today (the API exposes only streak_days), so the nudge shows
  // whenever a streak exists — honest, deterministic, never alarming.
  const streak = stats.streak_days
  if (streak > 0) {
    cards.push({
      id: 'streak',
      label: 'Streak',
      value: `${streak} ${streak === 1 ? 'day' : 'days'}`,
      meaning: 'Practise today to keep your streak going.',
      cta: { label: 'Quick 5-min session', action: { kind: 'practice', skillId: focusSkillId } },
      band: streak >= 7 ? 'long' : 'short',
    })
  } else {
    cards.push({
      id: 'streak',
      label: 'Streak',
      value: '0 days',
      meaning: 'Start a streak today — one short session is enough.',
      cta: { label: 'Quick 5-min session', action: { kind: 'practice', skillId: focusSkillId } },
      band: 'zero',
    })
  }

  return cards
}
