/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest'
import {
  computeMicAriaLabel,
  computeMicLabel,
  computePromptText,
} from './videoPanelCopy'

const baseLabel = {
  recording: false,
  processing: false,
  sessionFinished: false,
  introComplete: true,
  micRequired: true,
  audience: 'child' as const,
}

describe('computeMicLabel', () => {
  it('returns conversational child copy when mode=conversational and ready', () => {
    expect(computeMicLabel({ ...baseLabel, micMode: 'conversational' })).toBe(
      "Mic on — I'm listening",
    )
  })

  it('returns conversational therapist copy when mode=conversational and ready', () => {
    expect(
      computeMicLabel({ ...baseLabel, micMode: 'conversational', audience: 'therapist' }),
    ).toBe('Mic open — say anything')
  })

  it('returns legacy tap-to-talk copy in tap mode', () => {
    expect(computeMicLabel({ ...baseLabel, micMode: 'tap' })).toBe('Tap to talk')
  })

  it('returns "Listening..." while recording regardless of mode', () => {
    expect(
      computeMicLabel({ ...baseLabel, micMode: 'conversational', recording: true }),
    ).toBe('Listening...')
    expect(computeMicLabel({ ...baseLabel, micMode: 'tap', recording: true })).toBe(
      'Listening...',
    )
  })

  it('returns "Tap-only listening" when mic is not required', () => {
    expect(
      computeMicLabel({ ...baseLabel, micMode: 'conversational', micRequired: false }),
    ).toBe('Tap-only listening')
  })

  it('returns "Practice finished" for child when session over', () => {
    expect(
      computeMicLabel({ ...baseLabel, micMode: 'conversational', sessionFinished: true }),
    ).toBe('Practice finished')
  })

  it('returns processing copy for child while scoring', () => {
    expect(
      computeMicLabel({ ...baseLabel, micMode: 'conversational', processing: true }),
    ).toBe('Checking your try...')
  })

  it('returns intro-pending copy before intro completes', () => {
    expect(
      computeMicLabel({ ...baseLabel, micMode: 'conversational', introComplete: false }),
    ).toBe('Listen to your buddy')
    expect(
      computeMicLabel({
        ...baseLabel,
        micMode: 'conversational',
        introComplete: false,
        audience: 'therapist',
      }),
    ).toBe('Welcome in progress')
  })
})

describe('computeMicAriaLabel', () => {
  it('uses pause/resume verbs in conversational mode', () => {
    expect(computeMicAriaLabel('conversational', false)).toBe('Resume microphone')
    expect(computeMicAriaLabel('conversational', true)).toBe('Pause microphone')
  })

  it('uses start/stop recording verbs in tap mode', () => {
    expect(computeMicAriaLabel('tap', false)).toBe('Start recording')
    expect(computeMicAriaLabel('tap', true)).toBe('Stop recording')
  })
})

const basePrompt = {
  scenarioDescription: null,
  exerciseLabel: 'S blends',
  childLabel: 'Jamie',
  audience: 'child' as const,
  micRequired: true,
  micMode: 'tap' as const,
}

describe('computePromptText', () => {
  it('always returns scenarioDescription verbatim when present', () => {
    expect(
      computePromptText({ ...basePrompt, scenarioDescription: 'Custom scenario copy' }),
    ).toBe('Custom scenario copy')
  })

  it('child conversational copy mentions the open mic', () => {
    expect(computePromptText({ ...basePrompt, micMode: 'conversational' })).toBe(
      "We are going to practise S blends together. The mic is on — speak whenever you're ready.",
    )
  })

  it('child tap copy keeps the legacy tap-to-talk prompt', () => {
    expect(computePromptText(basePrompt)).toBe(
      'We are going to practise S blends together. Tap to talk when you are ready.',
    )
  })

  it('therapist conversational copy mentions the always-open mic for the child', () => {
    expect(
      computePromptText({ ...basePrompt, audience: 'therapist', micMode: 'conversational' }),
    ).toBe(
      "Review S blends. The microphone stays open — Jamie can speak whenever they're ready.",
    )
  })

  it('therapist tap copy keeps the dock-microphone prompt', () => {
    expect(computePromptText({ ...basePrompt, audience: 'therapist' })).toBe(
      'Review S blends and use the dock microphone when Jamie is ready.',
    )
  })

  it('tap-only listening exercises skip the mic-mode branch for both audiences', () => {
    expect(
      computePromptText({ ...basePrompt, micRequired: false, micMode: 'conversational' }),
    ).toBe(
      'We are going to practise S blends together. Listen first, then tap the matching picture.',
    )
    expect(
      computePromptText({
        ...basePrompt,
        audience: 'therapist',
        micRequired: false,
        micMode: 'conversational',
      }),
    ).toBe("Review S blends and listen for the buddy's clue. This turn is tap-only.")
  })
})
