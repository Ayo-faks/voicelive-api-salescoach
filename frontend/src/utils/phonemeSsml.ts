/**
 * Maps exercise target-sound identifiers (as configured on scenarios/exercises) to
 * IPA phonemes suitable for Azure Speech <phoneme alphabet="ipa" ph="..."> synthesis.
 *
 * Keep SOUND_TO_IPA in sync with ``data/lexicons/phoneme-map.json``. The parity
 * test ``backend/tests/unit/test_phoneme_map_parity.py`` enforces this.
 */
import { featureFlags } from './featureFlags'

export const SOUND_TO_IPA: Readonly<Record<string, string>> = Object.freeze({
  r: 'ɹ',
  s: 's',
  sh: 'ʃ',
  th: 'θ',
  dh: 'ð',
  k: 'k',
  g: 'ɡ',
  f: 'f',
  v: 'v',
  z: 'z',
  zh: 'ʒ',
  t: 't',
  d: 'd',
  l: 'l',
  w: 'w',
  ch: 'tʃ',
  j: 'dʒ',
  ng: 'ŋ',
  y: 'j',
  h: 'h',
})

export type PreviewStrategyFamily = 'ipa' | 'pseudo' | 'anchor'

export interface PhonemePayload {
  phoneme: string
  alphabet: 'ipa'
  fallback_text: string
}

export interface PreviewCandidate {
  strategy: PreviewStrategyFamily
  label: string
  input: string | PhonemePayload
}

interface SoundPreviewDefinition {
  defaultStrategy: PreviewStrategyFamily
  candidates: Partial<Record<PreviewStrategyFamily, PreviewCandidate>>
}

function _ipa(ph: string): PreviewCandidate {
  return {
    strategy: 'ipa',
    label: 'Direct phoneme',
    input: { phoneme: ph, alphabet: 'ipa', fallback_text: 'sound' },
  }
}

function _pseudo(input: string): PreviewCandidate {
  return { strategy: 'pseudo', label: 'Pseudo-spelling', input }
}

function _anchor(word: string): PreviewCandidate {
  return { strategy: 'anchor', label: 'Anchor word', input: word }
}

/**
 * Preview definitions for the experimental target sounds (TH and F).
 * These sounds expose the full pseudo-spelling / anchor-word strategy set
 * regardless of the ``tts_preview_strategies_unlocked`` flag because the
 * pseudo-spelling cue is the clinically preferred default for them.
 * Other sounds fall through to the generic IPA-only path below.
 */
const SOUND_PREVIEW_DEFINITIONS: Readonly<Record<string, SoundPreviewDefinition>> = Object.freeze({
  th: {
    defaultStrategy: 'pseudo',
    candidates: { ipa: _ipa('θ'), pseudo: _pseudo('thh'), anchor: _anchor('think') },
  },
  f: {
    defaultStrategy: 'pseudo',
    candidates: { ipa: _ipa('f'), pseudo: _pseudo('fff'), anchor: _anchor('fish') },
  },
})

/**
 * Continuants get lengthened with the IPA length marker (``ː``) when played
 * through the direct-phoneme fallback preview so the audio has enough body
 * for young listeners to perceive the sound in isolation.
 */
const LENGTHENED_CONTINUANTS: Readonly<Set<string>> = Object.freeze(
  new Set(['s', 'ʃ', 'z', 'ʒ', 'f', 'v', 'θ', 'ð', 'ɹ', 'l', 'm', 'n']),
)

/**
 * Build the JSON payload for POST /api/tts that triggers direct SSML
 * synthesis of an isolated phoneme. Returns null when the sound id is not
 * in the known map so callers can fall back to their existing path.
 */
export function buildIsolatedPhonemePayload(
  sound: string | null | undefined,
  options: { override?: string; fallbackText?: string } = {}
): PhonemePayload | null {
  if (!sound) {
    return null
  }
  const key = sound.trim().toLowerCase()
  const ph = options.override ?? SOUND_TO_IPA[key]
  if (!ph) {
    return null
  }
  return {
    phoneme: ph,
    alphabet: 'ipa',
    fallback_text: options.fallbackText ?? 'sound',
  }
}

function _strategiesAllowed(): Set<PreviewStrategyFamily> {
  return featureFlags.tts_preview_strategies_unlocked
    ? new Set<PreviewStrategyFamily>(['ipa', 'pseudo', 'anchor'])
    : new Set<PreviewStrategyFamily>(['ipa'])
}

export function getAvailablePreviewStrategies(
  sound: string | null | undefined
): PreviewStrategyFamily[] {
  if (!sound) {
    return []
  }

  const key = sound.trim().toLowerCase()
  const definition = SOUND_PREVIEW_DEFINITIONS[key]
  if (definition) {
    // Experimental sounds expose every configured strategy regardless of flag.
    return Object.keys(definition.candidates) as PreviewStrategyFamily[]
  }

  const allowed = _strategiesAllowed()
  return SOUND_TO_IPA[key] && allowed.has('ipa') ? ['ipa'] : []
}

export function getDefaultPreviewStrategy(
  sound: string | null | undefined
): PreviewStrategyFamily {
  if (!sound) {
    return 'ipa'
  }

  const key = sound.trim().toLowerCase()
  // Experimental sounds always use their declared default.
  return SOUND_PREVIEW_DEFINITIONS[key]?.defaultStrategy ?? 'ipa'
}

export function buildPreviewCandidate(
  sound: string | null | undefined,
  strategy?: PreviewStrategyFamily
): PreviewCandidate | null {
  if (!sound) {
    return null
  }

  const key = sound.trim().toLowerCase()
  const definition = SOUND_PREVIEW_DEFINITIONS[key]
  if (definition) {
    const requested = strategy ?? definition.defaultStrategy
    return definition.candidates[requested] ?? definition.candidates.ipa ?? null
  }

  const payload = buildIsolatedPhonemePayload(key)
  if (!payload) {
    return null
  }

  // Lengthen continuants so the generic IPA preview has perceptible duration
  // when played in isolation (matches the pseudo-spelling duration for the
  // experimental sounds).
  const phoneme = LENGTHENED_CONTINUANTS.has(payload.phoneme)
    ? `${payload.phoneme}ː`
    : payload.phoneme

  return {
    strategy: 'ipa',
    label: 'Direct phoneme',
    input: { ...payload, phoneme },
  }
}
