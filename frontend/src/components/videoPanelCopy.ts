/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PR12b.3b — pure copy helpers for the VideoPanel mic dock.
 *
 * Split out from `VideoPanel.tsx` so the mode-aware microphone labels /
 * prompt text / aria-labels can be unit tested without rendering the whole
 * Fluent card (which requires BuddyAvatar, styles hook, icons, etc.).
 *
 * These helpers are stateless and only depend on their arguments; when
 * `micMode === 'conversational'` the dock speaks as if the mic is always
 * open, otherwise the legacy push-to-talk copy is returned unchanged.
 */

import type { MicMode } from '../utils/micMode'

export type Audience = 'therapist' | 'child'

export interface MicLabelInput {
  micMode: MicMode
  recording: boolean
  processing: boolean
  sessionFinished: boolean
  introComplete: boolean
  micRequired: boolean
  audience: Audience
}

/** Copy for the mic dock button label (under the icon). */
export function computeMicLabel(input: MicLabelInput): string {
  const { micMode, recording, processing, sessionFinished, introComplete, micRequired, audience } = input

  if (recording) return 'Listening...'
  if (sessionFinished && audience === 'child') return 'Practice finished'
  if (processing && audience === 'child') return 'Checking your try...'
  if (!micRequired) return 'Tap-only listening'

  if (!introComplete) {
    return audience === 'therapist' ? 'Welcome in progress' : 'Listen to your buddy'
  }

  if (micMode === 'conversational') {
    return audience === 'therapist' ? 'Mic open — say anything' : "Mic on — I'm listening"
  }

  return audience === 'therapist' ? 'Mic ready' : 'Tap to talk'
}

/** Aria-label for the mic dock button. */
export function computeMicAriaLabel(micMode: MicMode, recording: boolean): string {
  if (micMode === 'conversational') {
    return recording ? 'Pause microphone' : 'Resume microphone'
  }
  return recording ? 'Stop recording' : 'Start recording'
}

export interface PromptTextInput {
  scenarioDescription: string | null | undefined
  exerciseLabel: string
  childLabel: string
  audience: Audience
  micRequired: boolean
  micMode: MicMode
}

/** Copy for the "Today's practice" prompt card. */
export function computePromptText(input: PromptTextInput): string {
  const { scenarioDescription, exerciseLabel, childLabel, audience, micRequired, micMode } = input

  if (scenarioDescription) return scenarioDescription

  if (audience === 'therapist') {
    if (!micRequired) {
      return `Review ${exerciseLabel} and listen for the buddy's clue. This turn is tap-only.`
    }
    if (micMode === 'conversational') {
      return `Review ${exerciseLabel}. The microphone stays open — ${childLabel} can speak whenever they're ready.`
    }
    return `Review ${exerciseLabel} and use the dock microphone when ${childLabel} is ready.`
  }

  // child audience
  if (!micRequired) {
    return `We are going to practise ${exerciseLabel} together. Listen first, then tap the matching picture.`
  }
  if (micMode === 'conversational') {
    return `We are going to practise ${exerciseLabel} together. The mic is on — speak whenever you're ready.`
  }
  return `We are going to practise ${exerciseLabel} together. Tap to talk when you are ready.`
}
