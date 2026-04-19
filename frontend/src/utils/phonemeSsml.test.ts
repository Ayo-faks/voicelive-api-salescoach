import { describe, expect, it } from 'vitest'

import {
  SOUND_TO_IPA,
  buildIsolatedPhonemePayload,
  buildPreviewCandidate,
  getAvailablePreviewStrategies,
  getDefaultPreviewStrategy,
} from './phonemeSsml'

describe('SOUND_TO_IPA', () => {
  it('maps th and f to direct IPA phonemes', () => {
    expect(SOUND_TO_IPA.th).toBe('θ')
    expect(SOUND_TO_IPA.f).toBe('f')
  })

  it('includes common therapy targets', () => {
    expect(SOUND_TO_IPA.s).toBeDefined()
    expect(SOUND_TO_IPA.sh).toBeDefined()
    expect(SOUND_TO_IPA.r).toBeDefined()
    expect(SOUND_TO_IPA.k).toBeDefined()
  })
})

describe('buildIsolatedPhonemePayload', () => {
  it('returns IPA payload with fallback text for known sound', () => {
    expect(buildIsolatedPhonemePayload('th')).toEqual({
      phoneme: 'θ',
      alphabet: 'ipa',
      fallback_text: 'sound',
    })
  })

  it('normalises case and whitespace', () => {
    expect(buildIsolatedPhonemePayload('  TH ')).toEqual({
      phoneme: 'θ',
      alphabet: 'ipa',
      fallback_text: 'sound',
    })
  })

  it('returns null for unknown or empty sound', () => {
    expect(buildIsolatedPhonemePayload(null)).toBeNull()
    expect(buildIsolatedPhonemePayload('')).toBeNull()
    expect(buildIsolatedPhonemePayload('xyz')).toBeNull()
  })

  it('respects explicit override', () => {
    expect(buildIsolatedPhonemePayload('th', { override: 'ð' })).toEqual({
      phoneme: 'ð',
      alphabet: 'ipa',
      fallback_text: 'sound',
    })
  })

  it('respects custom fallback_text', () => {
    expect(buildIsolatedPhonemePayload('f', { fallbackText: 'f sound' })).toEqual({
      phoneme: 'f',
      alphabet: 'ipa',
      fallback_text: 'f sound',
    })
  })
})

describe('preview strategy helpers', () => {
  it('prefers pseudo strategy for TH and F experiments', () => {
    expect(getDefaultPreviewStrategy('th')).toBe('pseudo')
    expect(getDefaultPreviewStrategy('f')).toBe('pseudo')
  })

  it('returns all configured strategies for TH', () => {
    expect(getAvailablePreviewStrategies('th')).toEqual(['ipa', 'pseudo', 'anchor'])
  })

  it('builds pseudo and anchor candidates for TH', () => {
    expect(buildPreviewCandidate('th', 'pseudo')).toEqual({
      strategy: 'pseudo',
      label: 'Pseudo-spelling',
      input: 'thh',
    })

    expect(buildPreviewCandidate('th', 'anchor')).toEqual({
      strategy: 'anchor',
      label: 'Anchor word',
      input: 'think',
    })
  })

  it('falls back to IPA candidates for non-experimental sounds', () => {
    expect(buildPreviewCandidate('s', 'pseudo')).toEqual({
      strategy: 'ipa',
      label: 'Direct phoneme',
      input: {
        phoneme: 'sː',
        alphabet: 'ipa',
        fallback_text: 'sound',
      },
    })
  })
})
