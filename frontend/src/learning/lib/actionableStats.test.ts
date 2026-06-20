import { describe, expect, it } from 'vitest'
import { deriveActionableStatCards } from './actionableStats'

const weakTopics = [
  { skillId: 'ratio', label: 'Ratio and proportion' },
  { skillId: 'algebra', label: 'Algebraic expressions' },
]

function stats(overrides: Partial<{
  completed: number
  target: number
  streak_days: number
  current_mastery_pct: number | null
  mastery_delta_pct: number
  mastery_focus_label: string
}> = {}) {
  return {
    sessions: {
      completed: overrides.completed ?? 2,
      target: overrides.target ?? 5,
    },
    streak_days: overrides.streak_days ?? 3,
    current_mastery_pct:
      'current_mastery_pct' in overrides
        ? (overrides.current_mastery_pct ?? null)
        : 62,
    mastery_delta_pct: overrides.mastery_delta_pct ?? 4,
    mastery_focus_label: overrides.mastery_focus_label ?? 'Algebra',
  }
}

describe('deriveActionableStatCards', () => {
  it('always returns the four cards in fixed order', () => {
    const cards = deriveActionableStatCards({ stats: stats(), weakTopics })
    expect(cards.map(c => c.id)).toEqual([
      'sessions',
      'mastery',
      'weak-topics',
      'streak',
    ])
  })

  it('sessions behind target: states how many remain and offers a CTA', () => {
    const [sessions] = deriveActionableStatCards({ stats: stats(), weakTopics })
    expect(sessions.value).toBe('2 / 5')
    expect(sessions.meaning).toBe('3 more sessions to hit your weekly goal.')
    expect(sessions.cta?.action).toEqual({ kind: 'practice', skillId: 'ratio' })
    expect(sessions.band).toBe('behind')
  })

  it('sessions at target: celebratory meaning, no CTA', () => {
    const [sessions] = deriveActionableStatCards({
      stats: stats({ completed: 5 }),
      weakTopics,
    })
    expect(sessions.cta).toBeNull()
    expect(sessions.band).toBe('on_target')
  })

  it('zero sessions: honest encouraging empty, never demo data', () => {
    const [sessions] = deriveActionableStatCards({
      stats: stats({ completed: 0 }),
      weakTopics,
    })
    expect(sessions.value).toBe('0 / 5')
    expect(sessions.band).toBe('zero')
    expect(sessions.cta?.label).toBe('Start a session')
  })

  it('mastery shows current mastery and weekly change context', () => {
    const cards = deriveActionableStatCards({ stats: stats(), weakTopics })
    const mastery = cards.find(c => c.id === 'mastery')!
    expect(mastery.value).toBe('62%')
    expect(mastery.meaning).toContain('Weekly change +4%')
    expect(mastery.meaning).toContain('Algebra')
    expect(mastery.cta?.label).toBe('Keep it up')
    expect(mastery.band).toBe('positive')
  })

  it('negative mastery delta offers a shore-it-up CTA', () => {
    const cards = deriveActionableStatCards({
      stats: stats({ mastery_delta_pct: -3 }),
      weakTopics,
    })
    const mastery = cards.find(c => c.id === 'mastery')!
    expect(mastery.value).toBe('62%')
    expect(mastery.meaning).toContain('Weekly change -3%')
    expect(mastery.cta?.label).toBe('Shore it up')
    expect(mastery.band).toBe('negative')
  })

  it('flat mastery still shows the current mastery value', () => {
    const cards = deriveActionableStatCards({
      stats: stats({ mastery_delta_pct: 0, mastery_focus_label: '' }),
      weakTopics,
    })
    const mastery = cards.find(c => c.id === 'mastery')!
    expect(mastery.value).toBe('62%')
    expect(mastery.meaning).toContain('Weekly change +0%')
    expect(mastery.band).toBe('flat')
  })

  it('no mastery evidence renders the honest empty variant', () => {
    const cards = deriveActionableStatCards({
      stats: stats({
        current_mastery_pct: null,
        mastery_delta_pct: 0,
        mastery_focus_label: '',
      }),
      weakTopics,
    })
    const mastery = cards.find(c => c.id === 'mastery')!
    expect(mastery.value).toBe('—')
    expect(mastery.band).toBe('no_evidence')
  })

  it('weak topics card includes the exam label when known', () => {
    const cards = deriveActionableStatCards({
      stats: stats(),
      weakTopics,
      examLabel: 'JSSCE Maths',
    })
    const weak = cards.find(c => c.id === 'weak-topics')!
    expect(weak.value).toBe('2')
    expect(weak.meaning).toBe('2 topics need attention before JSSCE Maths.')
    expect(weak.cta?.label).toBe('Practise these')
  })

  it('zero weak topics: no CTA, honest meaning', () => {
    const cards = deriveActionableStatCards({ stats: stats(), weakTopics: [] })
    const weak = cards.find(c => c.id === 'weak-topics')!
    expect(weak.cta).toBeNull()
    expect(weak.band).toBe('zero')
  })

  it('active streak nudges today’s practice', () => {
    const cards = deriveActionableStatCards({ stats: stats(), weakTopics })
    const streak = cards.find(c => c.id === 'streak')!
    expect(streak.value).toBe('3 days')
    expect(streak.meaning).toBe('Practise today to keep your streak going.')
    expect(streak.band).toBe('short')
  })

  it('zero streak invites a fresh start', () => {
    const cards = deriveActionableStatCards({
      stats: stats({ streak_days: 0 }),
      weakTopics,
    })
    const streak = cards.find(c => c.id === 'streak')!
    expect(streak.value).toBe('0 days')
    expect(streak.band).toBe('zero')
  })
})
