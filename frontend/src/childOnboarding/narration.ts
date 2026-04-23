/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Thin adapter around {@link api.synthesizeSpeech} +
 * {@link useAudioPlayer} for child-mode mascot narration.
 *
 * Design notes (docs/onboarding/onboarding-plan-v2.md §Tier C):
 *  - Single in-flight request; at most one follow-up is queued. New
 *    utterances replace any already-queued follow-up.
 *  - The reusable audio pipeline is injected, so callers pass the
 *    ``playAudio`` / ``stopAudio`` pair from the existing
 *    {@link useAudioPlayer} hook. We never instantiate a second
 *    AudioContext.
 *  - Captions are surfaced through a user-supplied callback so the
 *    consumer can render an ``aria-live="polite"`` region — SR users
 *    are not reliant on TTS audio.
 *  - ``muted`` turns off TTS synthesis entirely but still fires the
 *    caption so the screen-reader path survives a silent-mode toggle.
 *  - Zero telemetry. The {@link telemetry} shim is already sealed for
 *    child persona by {@link OnboardingRuntime}; we do not call
 *    ``trackEvent`` here regardless.
 */

import type { api as ApiService } from '../services/api'

export interface NarrateRequest {
  /** Stable caption key (``child.<surface>.<role>.<n>``). */
  key: string
  /** The resolved caption text (already ≤ 25 words per copy.ts). */
  text: string
  /** Override voice; defaults to the backend-picked mascot voice. */
  voiceName?: string
}

export interface NarrationAdapterOptions {
  /** Injected so tests can substitute a stub. Defaults to ``api.synthesizeSpeech``. */
  synthesize: (typeof ApiService)['synthesizeSpeech']
  /** Injected so we reuse the one ``AudioContext`` owned by
   *  {@link useAudioPlayer}. */
  playAudio: (base64: string) => void
  /** Called when playback should be cancelled. */
  stopAudio: () => void
  /** Called with each utterance's caption so the consumer can render an
   *  ``aria-live`` region. */
  onCaption?: (caption: string) => void
  /** When true, skip the TTS request entirely but still fire
   *  ``onCaption``. */
  muted?: boolean
}

export interface NarrationAdapter {
  narrate(request: NarrateRequest): Promise<void>
  cancelNarration(): void
  /** Number of utterances currently queued (0, 1, or 2). Test-only. */
  readonly _queueDepth: number
}

/** Create a narration adapter bound to the caller's audio pipeline. */
export function createNarrationAdapter(
  options: NarrationAdapterOptions,
): NarrationAdapter {
  let inFlight: Promise<void> | null = null
  let queued: NarrateRequest | null = null
  let cancelled = false
  let controller: AbortController | null = null

  const run = async (request: NarrateRequest): Promise<void> => {
    // Fire caption first so the SR path is never dependent on TTS.
    options.onCaption?.(request.text)
    if (options.muted) return
    controller = new AbortController()
    try {
      const audio = await options.synthesize(
        {
          text: request.text,
          voiceName: request.voiceName,
        },
        { signal: controller.signal },
      )
      if (cancelled) return
      options.playAudio(audio)
    } catch {
      // Narration is best-effort: a TTS failure must never break the
      // child UI. The caption already landed via onCaption.
    } finally {
      controller = null
    }
  }

  const pump = async (request: NarrateRequest): Promise<void> => {
    try {
      await run(request)
    } finally {
      const next = queued
      queued = null
      if (next && !cancelled) {
        inFlight = pump(next)
        await inFlight
      } else {
        inFlight = null
      }
    }
  }

  return {
    async narrate(request: NarrateRequest): Promise<void> {
      cancelled = false
      if (!inFlight) {
        inFlight = pump(request)
        await inFlight
        return
      }
      // Already playing — replace any queued follow-up so we never
      // build up a backlog of stale captions.
      queued = request
    },
    cancelNarration(): void {
      cancelled = true
      queued = null
      if (controller) {
        controller.abort()
        controller = null
      }
      options.stopAudio()
    },
    get _queueDepth(): number {
      return (inFlight ? 1 : 0) + (queued ? 1 : 0)
    },
  }
}
