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
  TH_THIN_MODEL: 'thin',
  TH_THREE_MODEL: 'three',
  TH_THORN_MODEL: 'thorn',
  TH_THUMB_MODEL: 'thumb',
  F_FIN_MODEL: 'fin',
  F_FREE_MODEL: 'free',
  F_FAWN_MODEL: 'fawn',
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