/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, it, expect, vi } from 'vitest'

import { createNarrationAdapter } from './narration'

function makeHarness(opts: { muted?: boolean; synthesizeDelayMs?: number } = {}) {
  const captions: string[] = []
  const played: string[] = []
  const synthesize = vi.fn(async (input: unknown, _opt?: unknown) => {
    if (opts.synthesizeDelayMs) {
      await new Promise(resolve => setTimeout(resolve, opts.synthesizeDelayMs))
    }
    const text =
      typeof input === 'string'
        ? input
        : (input as { text?: string }).text ?? ''
    return `audio::${text}`
  })
  const playAudio = vi.fn((base64: string) => {
    played.push(base64)
  })
  const stopAudio = vi.fn()
  const adapter = createNarrationAdapter({
    synthesize: synthesize as never,
    playAudio,
    stopAudio,
    onCaption: c => captions.push(c),
    muted: opts.muted,
  })
  return { adapter, captions, played, synthesize, playAudio, stopAudio }
}

describe('narration adapter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires caption before any TTS synthesis', async () => {
    const h = makeHarness({ synthesizeDelayMs: 0 })
    const order: string[] = []
    h.synthesize.mockImplementation(async () => {
      order.push('synth')
      return 'AUDIO'
    })
    const originalOnCaption = h.captions
    const adapter = createNarrationAdapter({
      synthesize: async () => {
        order.push('synth')
        return 'AUDIO'
      },
      playAudio: () => order.push('play'),
      stopAudio: () => undefined,
      onCaption: () => order.push('caption'),
    })
    await adapter.narrate({ key: 'k', text: 'hello' })
    expect(order[0]).toBe('caption')
    expect(originalOnCaption).toEqual([])
  })

  it('plays audio for a single utterance', async () => {
    const h = makeHarness()
    await h.adapter.narrate({ key: 'k1', text: 'hello' })
    expect(h.captions).toEqual(['hello'])
    expect(h.played).toEqual(['audio::hello'])
  })

  it('queues at most one follow-up and replaces stale queued utterances', async () => {
    const h = makeHarness({ synthesizeDelayMs: 10 })
    const p1 = h.adapter.narrate({ key: 'k1', text: 'first' })
    // `first` is now in-flight. Queue two more; only the latest survives.
    h.adapter.narrate({ key: 'k2', text: 'stale' })
    h.adapter.narrate({ key: 'k3', text: 'latest' })
    expect(h.adapter._queueDepth).toBeLessThanOrEqual(2)
    await p1
    // Allow the pump to drain the queued utterance.
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(h.captions).toEqual(['first', 'latest'])
    expect(h.played).toEqual(['audio::first', 'audio::latest'])
  })

  it('cancelNarration aborts the pipeline and stops audio', async () => {
    const h = makeHarness({ synthesizeDelayMs: 50 })
    const p = h.adapter.narrate({ key: 'k1', text: 'hello' })
    h.adapter.cancelNarration()
    await p
    expect(h.stopAudio).toHaveBeenCalledTimes(1)
    // Audio must not play for a cancelled utterance.
    expect(h.played).toEqual([])
  })

  it('muted mode fires caption but no TTS or audio', async () => {
    const h = makeHarness({ muted: true })
    await h.adapter.narrate({ key: 'k1', text: 'hello' })
    expect(h.captions).toEqual(['hello'])
    expect(h.synthesize).not.toHaveBeenCalled()
    expect(h.played).toEqual([])
  })

  it('swallows synthesize failures without throwing', async () => {
    const h = makeHarness()
    h.synthesize.mockRejectedValueOnce(new Error('boom'))
    await expect(
      h.adapter.narrate({ key: 'k1', text: 'hello' }),
    ).resolves.toBeUndefined()
    expect(h.captions).toEqual(['hello'])
    expect(h.played).toEqual([])
  })
})
