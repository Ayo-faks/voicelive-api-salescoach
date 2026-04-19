/**
 * Dev-only helper for saving TH/F preview audio takes to disk.
 *
 * TEMPORARY: this module and its callers are gated behind
 * `import.meta.env.DEV` + `VITE_ENABLE_PREVIEW_EXPORT=true` and are
 * scheduled for removal once final preview assets are curated. See
 * `/memories/session/plan.md` for the cleanup checklist.
 */

import type { PhonemePayload, PreviewCandidate, PreviewStrategyFamily } from '../utils/phonemeSsml'

export const PREVIEW_EXPORT_SCHEMA_VERSION = 1
export const PREVIEW_EXPORT_FILENAME_PREFIX = 'wulo-preview'

const IPA_TO_ASCII: Readonly<Record<string, string>> = Object.freeze({
  'θ': 'theta',
  'ð': 'eth',
  'ʃ': 'esh',
  'ʒ': 'ezh',
  'ŋ': 'eng',
  'ɹ': 'turned-r',
  'ː': 'long',
  'f': 'f',
  's': 's',
  'z': 'z',
  'k': 'k',
  'v': 'v',
})

function isPhonemePayload(input: PreviewCandidate['input']): input is PhonemePayload {
  return typeof input === 'object' && input !== null && 'phoneme' in input
}

function phonemeToAsciiSlug(phoneme: string): string {
  const parts: string[] = []
  for (const ch of Array.from(phoneme)) {
    const mapped = IPA_TO_ASCII[ch]
    if (mapped) {
      parts.push(mapped)
    }
  }
  return parts.length > 0 ? parts.join('-') : 'payload'
}

function textToSlug(text: string, maxLen = 16): string {
  const cleaned = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const truncated = cleaned.slice(0, maxLen)
  return truncated || 'input'
}

export function buildInputSlug(candidate: PreviewCandidate): string {
  if (isPhonemePayload(candidate.input)) {
    return `ipa-${phonemeToAsciiSlug(candidate.input.phoneme)}`
  }
  return textToSlug(candidate.input)
}

export function formatTimestampUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}Z`
  )
}

export interface FilenameBaseArgs {
  sound: string
  strategy: PreviewStrategyFamily
  candidate: PreviewCandidate
  timestamp: Date
  collisionSuffix?: number
  voiceSlug?: string
}

export function buildFilenameBase(args: FilenameBaseArgs): string {
  const soundSlug = textToSlug(args.sound, 8) || 'sound'
  const strategySlug = args.strategy
  const inputSlug = buildInputSlug(args.candidate)
  const voiceSlug = args.voiceSlug ?? 'voice-unknown'
  const stamp = formatTimestampUtc(args.timestamp)
  const suffix = args.collisionSuffix && args.collisionSuffix > 1 ? `_${args.collisionSuffix}` : ''
  return `${PREVIEW_EXPORT_FILENAME_PREFIX}_${soundSlug}_${strategySlug}_${inputSlug}_${voiceSlug}_${stamp}${suffix}`
}

export interface MetadataArgs {
  sound: string
  bucket: 'target' | 'error'
  strategy: PreviewStrategyFamily
  candidate: PreviewCandidate
  audioBytes: number
  timestamp: Date
  appPath?: string
}

export interface PreviewTakeMetadata {
  schema_version: number
  kind: 'wulo-preview-take'
  saved_at_utc: string
  sound: string
  bucket: 'target' | 'error'
  strategy: PreviewStrategyFamily
  candidate_label: string
  input: {
    mode: 'text' | 'phoneme'
    text: string | null
    phoneme: string | null
    alphabet: string | null
    fallback_text: string | null
  }
  audio: {
    format: 'mp3'
    source: 'POST /api/tts'
    bytes: number
  }
  voice: {
    source: 'backend-default'
    note: string
  }
  app: {
    path: string
    panel: 'SilentSortingPanel'
    build: 'dev'
  }
}

export function buildMetadata(args: MetadataArgs): PreviewTakeMetadata {
  const isoSeconds = args.timestamp.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const input = args.candidate.input
  const inputBlock = isPhonemePayload(input)
    ? {
        mode: 'phoneme' as const,
        text: null,
        phoneme: input.phoneme,
        alphabet: input.alphabet,
        fallback_text: input.fallback_text,
      }
    : {
        mode: 'text' as const,
        text: input,
        phoneme: null,
        alphabet: null,
        fallback_text: null,
      }

  return {
    schema_version: PREVIEW_EXPORT_SCHEMA_VERSION,
    kind: 'wulo-preview-take',
    saved_at_utc: isoSeconds,
    sound: args.sound.toLowerCase(),
    bucket: args.bucket,
    strategy: args.strategy,
    candidate_label: args.candidate.label,
    input: inputBlock,
    audio: {
      format: 'mp3',
      source: 'POST /api/tts',
      bytes: args.audioBytes,
    },
    voice: {
      source: 'backend-default',
      note: 'not returned by /api/tts',
    },
    app: {
      path: args.appPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/'),
      panel: 'SilentSortingPanel',
      build: 'dev',
    },
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Revoke on next tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const collisionCounters = new Map<string, number>()

export function resetPreviewExportState(): void {
  collisionCounters.clear()
}

export interface ExportPreviewTakeArgs {
  sound: string
  bucket: 'target' | 'error'
  strategy: PreviewStrategyFamily
  candidate: PreviewCandidate
  audioBase64: string
  now?: () => Date
}

export interface ExportPreviewTakeResult {
  filenameBase: string
  audioFilename: string
  metadataFilename: string
  metadata: PreviewTakeMetadata
}

/**
 * Download the given preview take as a paired MP3 + JSON sidecar.
 * Caller must have already obtained `audioBase64` from `api.synthesizeSpeech`.
 */
export function exportPreviewTake(args: ExportPreviewTakeArgs): ExportPreviewTakeResult {
  const timestamp = (args.now ?? (() => new Date()))()
  const stampKey = formatTimestampUtc(timestamp)
  const collisionKeyBase = `${args.sound}_${args.strategy}_${buildInputSlug(args.candidate)}_${stampKey}`
  const currentCount = (collisionCounters.get(collisionKeyBase) ?? 0) + 1
  collisionCounters.set(collisionKeyBase, currentCount)

  const filenameBase = buildFilenameBase({
    sound: args.sound,
    strategy: args.strategy,
    candidate: args.candidate,
    timestamp,
    collisionSuffix: currentCount,
  })
  const audioFilename = `${filenameBase}.mp3`
  const metadataFilename = `${filenameBase}.json`

  const audioBlob = base64ToBlob(args.audioBase64, 'audio/mpeg')
  const metadata = buildMetadata({
    sound: args.sound,
    bucket: args.bucket,
    strategy: args.strategy,
    candidate: args.candidate,
    audioBytes: audioBlob.size,
    timestamp,
  })
  const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' })

  triggerBlobDownload(audioBlob, audioFilename)
  triggerBlobDownload(metadataBlob, metadataFilename)

  return { filenameBase, audioFilename, metadataFilename, metadata }
}

/**
 * Returns whether the dev-only preview export UI should be rendered.
 * Centralised so the gate is consistent everywhere and trivial to remove.
 */
export function isPreviewExportEnabled(): boolean {
  return Boolean(import.meta.env.DEV) && import.meta.env.VITE_ENABLE_PREVIEW_EXPORT === 'true'
}
