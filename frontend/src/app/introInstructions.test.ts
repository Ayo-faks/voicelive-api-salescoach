import { describe, expect, it } from 'vitest'

import { buildChildIntroInstructions, buildTherapistIntroInstructions } from './introInstructions'

const BASE = {
  avatarName: 'Ollie',
  avatarPersona: 'a playful robot',
  scenarioName: 'TH Sound Sorting',
  scenarioDescription: 'sort pictures by their starting sound',
}

describe('introInstructions TH Sound Sorting cue', () => {
  it('child intro points to sound buttons without naming TH/F labels aloud', () => {
    const out = buildChildIntroInstructions({
      ...BASE,
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    expect(out).toContain('sound button')
    expect(out).not.toContain('Hear TH')
    expect(out).not.toContain('Hear F')
    expect(out).not.toContain('TH_THIN_MODEL')
    expect(out).not.toContain('F_FIN_MODEL')
  })

  it('therapist intro points to sound buttons without naming TH/F labels aloud', () => {
    const out = buildTherapistIntroInstructions({
      ...BASE,
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    expect(out).toContain('sound button')
    expect(out).not.toContain('Hear TH')
    expect(out).not.toContain('Hear F')
    expect(out).not.toContain('TH_THIN_MODEL')
    expect(out).not.toContain('F_FIN_MODEL')
  })

  it('omits sound button cue for non-TH silent_sorting exercises', () => {
    const out = buildChildIntroInstructions({
      ...BASE,
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'r',
    })
    expect(out).not.toContain('sound button')
  })

  it('omits cue for non-silent_sorting exercise types even when targetSound is th', () => {
    const out = buildTherapistIntroInstructions({
      ...BASE,
      childName: 'Sam',
      exerciseType: 'drill',
      targetSound: 'th',
    })
    expect(out).not.toContain('sound button')
    expect(out).not.toContain('TH_THIN_MODEL')
  })
})
