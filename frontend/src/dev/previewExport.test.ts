import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewCandidate } from '../utils/phonemeSsml'
import {
  buildFilenameBase,
  buildInputSlug,
  buildMetadata,
  exportPreviewTake,
  formatTimestampUtc,
  isPreviewExportEnabled,
  PREVIEW_EXPORT_FILENAME_PREFIX,
  resetPreviewExportState,
} from './previewExport'

const pseudoThCandidate: PreviewCandidate = {
  strategy: 'pseudo',
  label: 'Pseudo-spelling',
  input: 'thh',
}

const ipaThCandidate: PreviewCandidate = {
  strategy: 'ipa',
  label: 'Direct phoneme',
  input: {
    phoneme: 'θ',
    alphabet: 'ipa',
    fallback_text: 'sound',
  },
}

const fixedDate = new Date(Date.UTC(2026, 3, 19, 14, 52, 30))

describe('formatTimestampUtc', () => {
  it('formats as YYYYMMDDTHHMMZ in UTC', () => {
    expect(formatTimestampUtc(fixedDate)).toBe('20260419T1452Z')
  })

  it('zero-pads single-digit components', () => {
    expect(formatTimestampUtc(new Date(Date.UTC(2026, 0, 3, 4, 5, 0)))).toBe('20260103T0405Z')
  })
})

describe('buildInputSlug', () => {
  it('slugifies plain text candidates', () => {
    expect(buildInputSlug(pseudoThCandidate)).toBe('thh')
    expect(buildInputSlug({ ...pseudoThCandidate, input: 'think' })).toBe('think')
  })

  it('emits ipa-<ascii> for phoneme payloads', () => {
    expect(buildInputSlug(ipaThCandidate)).toBe('ipa-theta')
    expect(buildInputSlug({
      ...ipaThCandidate,
      input: { phoneme: 'f', alphabet: 'ipa', fallback_text: 'sound' },
    })).toBe('ipa-f')
  })

  it('falls back to ipa-payload for unknown glyphs', () => {
    expect(buildInputSlug({
      ...ipaThCandidate,
      input: { phoneme: 'qq', alphabet: 'ipa', fallback_text: 'sound' },
    })).toBe('ipa-payload')
  })
})

describe('buildFilenameBase', () => {
  it('produces a predictable, sortable name', () => {
    expect(
      buildFilenameBase({
        sound: 'th',
        strategy: 'pseudo',
        candidate: pseudoThCandidate,
        timestamp: fixedDate,
      }),
    ).toBe(`${PREVIEW_EXPORT_FILENAME_PREFIX}_th_pseudo_thh_voice-unknown_20260419T1452Z`)
  })

  it('uses ipa slug for phoneme payloads', () => {
    expect(
      buildFilenameBase({
        sound: 'th',
        strategy: 'ipa',
        candidate: ipaThCandidate,
        timestamp: fixedDate,
      }),
    ).toBe(`${PREVIEW_EXPORT_FILENAME_PREFIX}_th_ipa_ipa-theta_voice-unknown_20260419T1452Z`)
  })

  it('appends a collision suffix when greater than one', () => {
    expect(
      buildFilenameBase({
        sound: 'th',
        strategy: 'pseudo',
        candidate: pseudoThCandidate,
        timestamp: fixedDate,
        collisionSuffix: 2,
      }),
    ).toMatch(/_20260419T1452Z_2$/)
  })
})

describe('buildMetadata', () => {
  it('captures text-mode input fully', () => {
    const meta = buildMetadata({
      sound: 'TH',
      bucket: 'target',
      strategy: 'pseudo',
      candidate: pseudoThCandidate,
      audioBytes: 1234,
      timestamp: fixedDate,
      appPath: '/session',
    })
    expect(meta.schema_version).toBe(1)
    expect(meta.kind).toBe('wulo-preview-take')
    expect(meta.sound).toBe('th')
    expect(meta.bucket).toBe('target')
    expect(meta.strategy).toBe('pseudo')
    expect(meta.candidate_label).toBe('Pseudo-spelling')
    expect(meta.input).toEqual({
      mode: 'text',
      text: 'thh',
      phoneme: null,
      alphabet: null,
      fallback_text: null,
    })
    expect(meta.audio).toEqual({ format: 'mp3', source: 'POST /api/tts', bytes: 1234 })
    expect(meta.voice.source).toBe('backend-default')
    expect(meta.app).toEqual({ path: '/session', panel: 'SilentSortingPanel', build: 'dev' })
    expect(meta.saved_at_utc).toBe('2026-04-19T14:52:30Z')
  })

  it('captures phoneme-mode input fully', () => {
    const meta = buildMetadata({
      sound: 'th',
      bucket: 'target',
      strategy: 'ipa',
      candidate: ipaThCandidate,
      audioBytes: 42,
      timestamp: fixedDate,
    })
    expect(meta.input).toEqual({
      mode: 'phoneme',
      text: null,
      phoneme: 'θ',
      alphabet: 'ipa',
      fallback_text: 'sound',
    })
  })
})

describe('exportPreviewTake', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    resetPreviewExportState()
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    // jsdom already provides a working `atob`; no override needed.
    vi.useFakeTimers()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.useRealTimers()
  })

  it('downloads an mp3 and matching json, returns result', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = exportPreviewTake({
      sound: 'th',
      bucket: 'target',
      strategy: 'pseudo',
      candidate: pseudoThCandidate,
      audioBase64: 'dGVzdA==', // "test"
      now: () => fixedDate,
    })

    expect(clickSpy).toHaveBeenCalledTimes(2)
    expect(result.audioFilename).toBe(`${result.filenameBase}.mp3`)
    expect(result.metadataFilename).toBe(`${result.filenameBase}.json`)
    expect(result.filenameBase).toBe(
      `${PREVIEW_EXPORT_FILENAME_PREFIX}_th_pseudo_thh_voice-unknown_20260419T1452Z`,
    )
    expect(result.metadata.audio.bytes).toBe(4) // "test" decoded is 4 bytes

    clickSpy.mockRestore()
  })

  it('appends collision suffix when saved within the same minute', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const first = exportPreviewTake({
      sound: 'th',
      bucket: 'target',
      strategy: 'pseudo',
      candidate: pseudoThCandidate,
      audioBase64: 'dGVzdA==',
      now: () => fixedDate,
    })
    const second = exportPreviewTake({
      sound: 'th',
      bucket: 'target',
      strategy: 'pseudo',
      candidate: pseudoThCandidate,
      audioBase64: 'dGVzdA==',
      now: () => fixedDate,
    })

    expect(first.filenameBase).not.toMatch(/_2$/)
    expect(second.filenameBase).toMatch(/_2$/)

    clickSpy.mockRestore()
  })
})

describe('isPreviewExportEnabled', () => {
  it('returns false by default in the test env (VITE_ENABLE_PREVIEW_EXPORT unset)', () => {
    expect(isPreviewExportEnabled()).toBe(false)
  })

  // Positive path is covered indirectly by the SilentSortingPanel UI test
  // ("exposes Save take when the dev flag is on..."). Stubbing both DEV and
  // VITE_* against Vite's `import.meta.env` proxy is brittle here, so we rely
  // on the component-level coverage for the enabled branch.
})
