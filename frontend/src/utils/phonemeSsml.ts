/**
 * Maps exercise target-sound identifiers (as configured on scenarios/exercises) to
 * IPA phonemes suitable for Azure Speech <phoneme alphabet="ipa" ph="..."> synthesis.
 */
export const SOUND_TO_IPA: Readonly<Record<string, string>> = Object.freeze({
  th: 'θ',
  f: 'f',
  s: 'sː',
  sh: 'ʃː',
  k: 'k',
  r: 'ɹ',
  v: 'vː',
  z: 'zː',
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

const SOUND_PREVIEW_DEFINITIONS: Readonly<Record<string, SoundPreviewDefinition>> = Object.freeze({
  th: {
    defaultStrategy: 'pseudo',
    candidates: {
      ipa: {
        strategy: 'ipa',
        label: 'Direct phoneme',
        input: {
          phoneme: 'θ',
          alphabet: 'ipa',
          fallback_text: 'sound',
        },
      },
      pseudo: {
        strategy: 'pseudo',
        label: 'Pseudo-spelling',
        input: 'thh',
      },
      anchor: {
        strategy: 'anchor',
        label: 'Anchor word',
        input: 'think',
      },
    },
  },
  f: {
    defaultStrategy: 'pseudo',
    candidates: {
      ipa: {
        strategy: 'ipa',
        label: 'Direct phoneme',
        input: {
          phoneme: 'f',
          alphabet: 'ipa',
          fallback_text: 'sound',
        },
      },
      pseudo: {
        strategy: 'pseudo',
        label: 'Pseudo-spelling',
        input: 'fff',
      },
      anchor: {
        strategy: 'anchor',
        label: 'Anchor word',
        input: 'fin',
      },
    },
  },
})

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

export function getAvailablePreviewStrategies(
  sound: string | null | undefined
): PreviewStrategyFamily[] {
  if (!sound) {
    return []
  }

  const key = sound.trim().toLowerCase()
  const definition = SOUND_PREVIEW_DEFINITIONS[key]
  if (definition) {
    return Object.keys(definition.candidates) as PreviewStrategyFamily[]
  }

  return SOUND_TO_IPA[key] ? ['ipa'] : []
}

export function getDefaultPreviewStrategy(
  sound: string | null | undefined
): PreviewStrategyFamily {
  if (!sound) {
    return 'ipa'
  }

  const key = sound.trim().toLowerCase()
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
    const preferredStrategy = strategy ?? definition.defaultStrategy
    return definition.candidates[preferredStrategy]
      ?? definition.candidates[definition.defaultStrategy]
      ?? null
  }

  const payload = buildIsolatedPhonemePayload(key)
  if (!payload) {
    return null
  }

  return {
    strategy: 'ipa',
    label: 'Direct phoneme',
    input: payload,
  }
}
