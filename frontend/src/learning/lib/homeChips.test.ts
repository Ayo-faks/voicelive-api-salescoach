import { describe, expect, it } from 'vitest'
import { deriveHomeChips, type HomeChipInputs } from './homeChips'

const warmStats = {
  sessions: { completed: 2, target: 5 },
  streak_days: 3,
  current_mastery_pct: 62,
  mastery_delta_pct: 4,
  mastery_focus_label: 'Algebra',
}

const base: HomeChipInputs = {
  stats: warmStats,
  weakTopics: [{ skillId: 'ratio', label: 'Ratio and proportion' }],
  planItems: [{ skillId: 'linear-equations', label: 'Linear equations' }],
  askAvailable: true,
  voiceAvailable: true,
}

describe('deriveHomeChips', () => {
  it('emits the warm chip set in fixed order, capped at five', () => {
    const chips = deriveHomeChips(base)
    expect(chips.map(c => c.id)).toEqual([
      'study-with-wulo',
      'how-am-i-doing',
      'ask-wulo',
      'talk-it-through',
    ])
    expect(chips[0].label).toBe('Study Ratio and proportion with Wulo')
    expect(chips[0].action).toEqual({
      kind: 'study',
      skillId: 'ratio',
      skillLabel: 'Ratio and proportion',
    })
  })

  it('falls back to the first plan item for the study chip when no weak topics exist', () => {
    const chips = deriveHomeChips({ ...base, weakTopics: [] })
    expect(chips[0]).toMatchObject({
      id: 'study-with-wulo',
      label: 'Study Linear equations with Wulo',
      action: {
        kind: 'study',
        skillId: 'linear-equations',
        skillLabel: 'Linear equations',
      },
    })
  })

  it('omits the stats chip when there is no stats evidence', () => {
    const chips = deriveHomeChips({
      ...base,
      stats: {
        sessions: { completed: 0, target: 5 },
        streak_days: 0,
        current_mastery_pct: null,
        mastery_delta_pct: 0,
        mastery_focus_label: '',
      },
    })
    expect(chips.find(c => c.id === 'how-am-i-doing')).toBeUndefined()
  })

  it('serves a plain study chip plus onboarding starters on a true cold start — never a dead-end chip', () => {
    const chips = deriveHomeChips({
      stats: null,
      weakTopics: [],
      planItems: [],
      askAvailable: true,
      voiceAvailable: false,
    })
    expect(chips.map(c => c.id)).toEqual([
      'study-with-wulo',
      'first-goal',
      'quick-quiz',
      'ask-wulo',
    ])
    expect(chips[0].label).toBe('Study with Wulo')
    expect(chips[0].action).toEqual({
      kind: 'study',
      skillId: null,
      skillLabel: null,
    })
  })

  it('hides ask/voice chips when those surfaces are unavailable', () => {
    const chips = deriveHomeChips({
      ...base,
      askAvailable: false,
      voiceAvailable: false,
    })
    expect(chips.find(c => c.id === 'ask-wulo')).toBeUndefined()
    expect(chips.find(c => c.id === 'talk-it-through')).toBeUndefined()
  })

  it('hides the voice chip when only voice is unavailable', () => {
    const chips = deriveHomeChips({ ...base, voiceAvailable: false })
    expect(chips.find(c => c.id === 'ask-wulo')).toBeDefined()
    expect(chips.find(c => c.id === 'talk-it-through')).toBeUndefined()
  })

  it('gives every chip a full-intent aria label', () => {
    for (const chip of deriveHomeChips(base)) {
      expect(chip.ariaLabel.length).toBeGreaterThan(chip.label.length - 1)
    }
  })

  it('drops the standalone text ask chip when the unified surface is active', () => {
    const chips = deriveHomeChips({ ...base, unified: true })
    expect(chips.map(c => c.id)).toEqual([
      'study-with-wulo',
      'how-am-i-doing',
      'talk-it-through',
    ])
    expect(chips.find(c => c.id === 'ask-wulo')).toBeUndefined()
  })

  it('keeps only study + voice as Wulo entries on a cold start when unified', () => {
    const chips = deriveHomeChips({
      stats: null,
      weakTopics: [],
      planItems: [],
      askAvailable: true,
      voiceAvailable: true,
      unified: true,
    })
    expect(chips.find(c => c.id === 'ask-wulo')).toBeUndefined()
    expect(chips.find(c => c.id === 'study-with-wulo')).toBeDefined()
    expect(chips.find(c => c.id === 'talk-it-through')).toBeDefined()
  })
})
