const DRILL_TOKEN_DISPLAY_MAP = {
  R_RAH_MODEL: 'rrr-ah, rah',
  R_ROO_MODEL: 'rrr-oo, roo',
  R_ROW_MODEL: 'rrr-oh, row',
  R_REE_MODEL: 'rrr-ee, ree',
  K_KEY_MODEL: 'k-ee, key',
  K_COW_MODEL: 'k-ow, cow',
  K_COO_MODEL: 'k-oo, coo',
  K_KAY_MODEL: 'k-ay, kay',
  S_SEE_MODEL: 'sss-ee, see',
  S_SIGH_MODEL: 'sss-eye, sigh',
  S_SEW_MODEL: 'sss-oh, sew',
  S_SUE_MODEL: 'sss-oo, sue',
  SH_SHE_MODEL: 'sh-ee, she',
  SH_SHY_MODEL: 'sh-eye, shy',
  SH_SHOW_MODEL: 'sh-oh, show',
  SH_SHOE_MODEL: 'sh-oo, shoe',
  TH_THEE_MODEL: 'th-ee, thee',
  TH_THIGH_MODEL: 'th-eye, thigh',
  TH_THOUGH_MODEL: 'th-oh, though',
  TH_THOO_MODEL: 'th-oo, thoo',
  TH_THIN_MODEL: 'th-in, thin',
  TH_THREE_MODEL: 'th-ree, three',
  TH_THORN_MODEL: 'th-orn, thorn',
  TH_THUMB_MODEL: 'th-umb, thumb',
  F_FIN_MODEL: 'fff-in, fin',
  F_FREE_MODEL: 'fff-ree, free',
  F_FAWN_MODEL: 'fff-awn, fawn',
} as const

const DRILL_WORD_TO_TOKEN_MAP = Object.entries(DRILL_TOKEN_DISPLAY_MAP).reduce<Record<string, string>>(
  (tokenMap, [token, displayText]) => {
    const displaySegments = displayText.split(',')
    const spokenWord = displayText.includes(',')
      ? displaySegments[displaySegments.length - 1]?.trim().toLowerCase()
      : displayText.trim().toLowerCase()

    if (spokenWord) {
      tokenMap[spokenWord] = token
    }

    return tokenMap
  },
  {},
)

const DRILL_TOKENS = Object.keys(DRILL_TOKEN_DISPLAY_MAP).sort(
  (left, right) => right.length - left.length,
)
const DRILL_TOKEN_PATTERN = new RegExp(DRILL_TOKENS.join('|'), 'g')
const DRILL_TOKEN_PREFIXES = new Set(
  DRILL_TOKENS.flatMap(token =>
    Array.from({ length: token.length - 1 }, (_, index) => token.slice(0, index + 1)),
  ),
)
const MAX_DRILL_TOKEN_LENGTH = DRILL_TOKENS.reduce(
  (maxLength, token) => Math.max(maxLength, token.length),
  0,
)

export { DRILL_TOKEN_DISPLAY_MAP }

// IPA pronunciations for drill target words and common minimal-pair partners.
//
// Neural TTS (Voice Live / Azure Speech) defaults short monosyllables like
// "fin", "thin", "sin" to their higher-frequency long-vowel neighbours
// ("fine", "thine", "sign") because (a) the long-vowel form is ~100× more
// frequent in the training corpus and (b) the isolated-word prosodic floor
// stretches a short /ɪ/ past its natural length. Wrapping the word in an
// SSML <phoneme alphabet="ipa" …> tag pins the pronunciation deterministically
// without needing the "fff-in, fin" phonetic-onset sentinel.
//
// Only include words where we have verified IPA. Anything missing falls back
// to the bare word, which is still safe — worst case it pronounces as the
// long-vowel variant, which is the same behaviour we already have today.
const DRILL_WORD_IPA: Readonly<Record<string, string>> = Object.freeze({
  // F drill set
  fin: 'fɪn',
  free: 'friː',
  fawn: 'fɔn',
  // TH (voiceless /θ/) drill set
  thin: 'θɪn',
  three: 'θriː',
  thorn: 'θɔrn',
  thumb: 'θʌm',
  thigh: 'θaɪ',
  // TH (voiced /ð/) drill set
  thee: 'ðiː',
  though: 'ðoʊ',
  // R drill set
  rah: 'rɑ',
  roo: 'ruː',
  row: 'roʊ',
  ree: 'riː',
  // K drill set
  key: 'kiː',
  cow: 'kaʊ',
  coo: 'kuː',
  kay: 'keɪ',
  // S drill set
  see: 'siː',
  sigh: 'saɪ',
  sew: 'soʊ',
  sue: 'suː',
  // SH drill set
  she: 'ʃiː',
  shy: 'ʃaɪ',
  show: 'ʃoʊ',
  shoe: 'ʃuː',
  // Common minimal-pair partners (short-vowel confusable with long-vowel bias)
  sin: 'sɪn',
  tin: 'tɪn',
  pin: 'pɪn',
  bin: 'bɪn',
  win: 'wɪn',
  din: 'dɪn',
  sum: 'sʌm',
  some: 'sʌm',
  dumb: 'dʌm',
  drum: 'drʌm',
  tree: 'triː',
  torn: 'tɔrn',
  horn: 'hɔrn',
  born: 'bɔrn',
  corn: 'kɔrn',
})

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Return an SSML `<phoneme>` wrapper that pins `word` to its IPA pronunciation
 * when we have one, otherwise the bare word. Safe to embed in strings that are
 * forwarded to Voice Live as `response.create` → `instructions`; the backend
 * `tts_normalizer` masks existing `<phoneme>` blocks, and `replaceDrillTokens`
 * only rewrites `<SOUND>_<WORD>_MODEL` sentinel tokens, so no pipeline layer
 * double-wraps or strips this tag.
 */
export function getDrillWordSsml(word: string): string {
  if (!word) {
    return word
  }
  const normalized = word.trim().toLowerCase()
  const ipa = DRILL_WORD_IPA[normalized]
  if (!ipa) {
    return word
  }
  return `<phoneme alphabet="ipa" ph="${escapeXml(ipa)}">${escapeXml(word)}</phoneme>`
}

export function hasDrillWordIpa(word: string): boolean {
  if (!word) {
    return false
  }
  return Object.prototype.hasOwnProperty.call(DRILL_WORD_IPA, word.trim().toLowerCase())
}

/**
 * Return the raw IPA string for a drill word, or `null` if we don't have
 * a verified pronunciation. Callers forwarding to the REST /api/tts path
 * should pass this as `phoneme` with `alphabet: 'ipa'` and `fallback_text`
 * set to the original word, so the Azure Speech custom-lexicon/SSML pipeline
 * clamps the pronunciation deterministically (unlike the Voice Live
 * conversational channel which reads SSML verbatim).
 */
export function getDrillWordIpa(word: string): string | null {
  if (!word) {
    return null
  }
  const normalized = word.trim().toLowerCase()
  return DRILL_WORD_IPA[normalized] ?? null
}

export function getDrillModelToken(text: string): string {
  if (!text) {
    return text
  }

  const normalizedText = text.trim().toLowerCase()
  return DRILL_WORD_TO_TOKEN_MAP[normalizedText] ?? text
}

export function replaceDrillTokens(text: string): string {
  if (!text) {
    return text
  }

  return text.replace(DRILL_TOKEN_PATTERN, token => {
    return DRILL_TOKEN_DISPLAY_MAP[token as keyof typeof DRILL_TOKEN_DISPLAY_MAP] ?? token
  })
}

export function normalizeStreamingDrillText(text: string): string {
  if (!text) {
    return text
  }

  const pendingTokenLength = getPendingTokenLength(text)
  const safeText = pendingTokenLength > 0 ? text.slice(0, -pendingTokenLength) : text

  return replaceDrillTokens(safeText)
}

function getPendingTokenLength(text: string): number {
  const maxSuffixLength = Math.min(text.length, Math.max(0, MAX_DRILL_TOKEN_LENGTH - 1))

  for (let length = maxSuffixLength; length > 0; length -= 1) {
    const suffix = text.slice(-length)
    if (DRILL_TOKEN_PREFIXES.has(suffix)) {
      return length
    }
  }

  return 0
}