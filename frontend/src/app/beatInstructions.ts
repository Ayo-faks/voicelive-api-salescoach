import type { IntroInstructionOptions } from './introInstructions'

export type Beat = 'orient' | 'bridge' | 'reinforce'

export interface BeatInstructionOptions extends IntroInstructionOptions {
  beat: Beat
  /** Default 'child'. */
  audience?: 'child' | 'therapist'
  /** REINFORCE only. Short phrase describing the child's outcome. */
  outcomeSummary?: string
  /** REINFORCE only. Default true. */
  offerAnotherGo?: boolean
}

/** Hard word limit for BRIDGE beat copy. */
export const BRIDGE_MAX_WORDS = 7
/** Soft word limit for generic ORIENT copy (scripted clinical paths are exempt). */
export const ORIENT_SOFT_WORD_CAP = 25

const SCORING_VOCAB = ['correct', 'wrong', 'score', 'points', 'right answer']
const CORRECTIVE_VOCAB = [
  'wrong',
  'incorrect',
  'no,',
  'try again',
  'not quite',
  "that's not",
  'that is not',
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildBeatInstructions(opts: BeatInstructionOptions): string {
  switch (opts.beat) {
    case 'orient':
      return buildOrient(opts)
    case 'bridge':
      return buildBridge(opts)
    case 'reinforce':
      return buildReinforce(opts)
    /* c8 ignore next 2 */
    default:
      throw new Error(`buildBeatInstructions: unknown beat "${(opts as { beat: string }).beat}"`)
  }
}

// ---------------------------------------------------------------------------
// ORIENT
// ---------------------------------------------------------------------------

function buildOrient(opts: BeatInstructionOptions): string {
  const audience = opts.audience ?? 'child'
  const childLabel = opts.childName || (audience === 'child' ? 'my friend' : 'the child')
  const exerciseLabel = opts.scenarioName || "today's practice"

  // Scripted clinical path — TH silent_sorting. Preserved verbatim from the
  // legacy intro builder because downstream tests and the approved clinical
  // brief assert on this exact wording. The ≤25-word soft cap does not apply
  // to scripted clinical paths.
  if (opts.exerciseType === 'silent_sorting' && opts.targetSound === 'th') {
    if (audience === 'therapist') {
      return [
        `You are ${opts.avatarName}, ${opts.avatarPersona}, and a warm speech-practice buddy supporting a therapist and ${childLabel}.`,
        'Speak first to begin the session.',
        `Say exactly this and do not paraphrase it: "Welcome, therapist! We are starting ${exerciseLabel} with ${childLabel}. Tap a sound button to play a sample, then we will sort the pictures together. Tap the microphone when you are ready."`,
        'Never say the phrases "th sound" or "f sound", and do not try to produce an isolated TH or F sound yourself. Do not spell the letters.',
      ].join(' ')
    }
    return [
      `You are ${opts.avatarName}, ${opts.avatarPersona}, and a warm speech-practice buddy for a child named ${childLabel}.`,
      'Speak first to begin the session.',
      `Say exactly this and do not paraphrase it: "Welcome ${childLabel}! We are going to play a sorting game today. Tap a sound button if you want to listen first, then we will sort the pictures together. Tap the microphone when you are ready."`,
      'Never say the phrases "th sound" or "f sound", and do not try to produce an isolated TH or F sound yourself. Do not spell the letters.',
    ].join(' ')
  }

  // Stage 6 two_word_phrase — short, clinical scripted ORIENT per sound-agnostic
  // template. Scoring narrows to the target word only; carrier word is neutral.
  if (opts.exerciseType === 'two_word_phrase') {
    if (audience === 'therapist') {
      return `Stage 6 two-word phrases for ${childLabel} — we score the target word only; the carrier word is neutral.`
    }
    return `Hi ${childLabel}! Two-word game. We say them together. Tap a picture first.`
  }

  // Stage 8 structured_conversation — connected speech with covert EXPOSE
  // (topic picker) and no BRIDGE beat (ExerciseShell `suppressBridge`).
  // Scoring is target-sound-in-utterance; we recast rather than correct.
  if (opts.exerciseType === 'structured_conversation') {
    if (audience === 'therapist') {
      return `Stage 8 conversation for ${childLabel} — recasts only, no hard correction; tally target productions over connected speech.`
    }
    return `Hi ${childLabel}! Let's chat together. Pick a topic you like.`
  }

  // Generic ORIENT: short, warm, soft ≤25-word cap. EN-GB rule: avoid "test".
  const body =
    audience === 'therapist'
      ? `Welcome the therapist and say practice with ${childLabel} is starting now.`
      : `Hi ${childLabel}, we are starting ${exerciseLabel}. Tap the microphone when you are ready.`

  enforceOrientSoftCap(body)
  return body
}

function enforceOrientSoftCap(text: string): void {
  const count = wordCount(text)
  if (count > ORIENT_SOFT_WORD_CAP && isDev()) {
    // Soft cap → warn only, do not throw. Builders that hit this should be
    // tightened rather than silently shipped.
    // eslint-disable-next-line no-console
    console.warn(
      `[beatInstructions] ORIENT exceeds soft cap (${count} > ${ORIENT_SOFT_WORD_CAP}): "${text}"`,
    )
  }
}

// ---------------------------------------------------------------------------
// BRIDGE
// ---------------------------------------------------------------------------

function buildBridge(opts: BeatInstructionOptions): string {
  // Per-scenario bridge copy. Only silent_sorting is wired in PR1; other
  // exercise types fall through to a safe generic imperative.
  let text: string
  if (opts.exerciseType === 'silent_sorting') {
    text = 'Now sort the pictures.'
  } else if (opts.exerciseType === 'two_word_phrase') {
    text = 'Say them together.'
  } else if (opts.exerciseType === 'structured_conversation') {
    // Stage 8 has no BRIDGE beat (the panel sets `suppressBridge` on the
    // shell). This branch exists so a defensive call does not emit the
    // generic "Your turn now." for a conversation exercise.
    text = ''
  } else {
    text = 'Your turn now.'
  }
  return assertBridgeCopy(text)
}

/**
 * Enforce BRIDGE ≤ 7 words.
 *  - In dev (`import.meta.env.DEV`): throw so the violation is impossible to ship.
 *  - In prod: log a warning and truncate to the first 7 words.
 * Exported for parity with `ExerciseShell`'s `assertBridgeCopy`; both live in
 * their respective module scopes to avoid a cross-module import from Session B
 * into Session A.
 */
export function assertBridgeCopy(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= BRIDGE_MAX_WORDS) {
    return text
  }
  if (isDev()) {
    throw new Error(
      `[beatInstructions] BRIDGE copy exceeds ${BRIDGE_MAX_WORDS} words (got ${words.length}): "${text}"`,
    )
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[beatInstructions] BRIDGE copy exceeds ${BRIDGE_MAX_WORDS} words (got ${words.length}); truncating.`,
  )
  const truncated = words.slice(0, BRIDGE_MAX_WORDS).join(' ')
  // Preserve terminal punctuation if the last kept word lost a trailing period.
  return /[.!?]$/.test(truncated) ? truncated : `${truncated}.`
}

// ---------------------------------------------------------------------------
// REINFORCE
// ---------------------------------------------------------------------------

function buildReinforce(opts: BeatInstructionOptions): string {
  const audience = opts.audience ?? 'child'
  const childLabel = opts.childName || (audience === 'child' ? 'my friend' : 'the child')
  const praise =
    audience === 'therapist'
      ? `Great session with ${childLabel}.`
      : `Great work, ${childLabel}!`
  const summary = opts.outcomeSummary ? ` ${opts.outcomeSummary.trim()}` : ''
  const offer = opts.offerAnotherGo === false ? '' : ' Want another go?'
  const text = `${praise}${summary}${offer}`.trim()

  assertNoCorrective(text)
  return text
}

function assertNoCorrective(text: string): void {
  const lower = text.toLowerCase()
  for (const term of CORRECTIVE_VOCAB) {
    if (lower.includes(term)) {
      if (isDev()) {
        throw new Error(
          `[beatInstructions] REINFORCE must never be corrective. Found "${term}" in: "${text}"`,
        )
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[beatInstructions] REINFORCE contained corrective term "${term}"; scrubbing.`,
      )
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher: queue + flush + preempt semantics
// ---------------------------------------------------------------------------

export type RealtimeEnvelope =
  | { type: 'response.cancel' }
  | {
      type: 'response.create'
      response: { modalities: ['audio', 'text']; instructions: string }
    }

export interface BeatDispatcherOptions {
  send: (envelope: RealtimeEnvelope) => void
  isReady: () => boolean
  /** Test seam; defaults to `Date.now`. */
  now?: () => number
  /** Silently drop persistent failures after this many ms. Default 3000. */
  dropAfterMs?: number
  /** Telemetry-friendly logger. */
  logger?: (event: string, detail?: unknown) => void
}

export interface BeatDispatcher {
  /** Queue or send depending on readiness. Preempts any in-flight beat. */
  send(instructions: string): void
  /** Drain queued beats when readiness flips to true. Idempotent per-ready. */
  flushIfReady(): void
  /** Test helper — queue depth. */
  pendingCount(): number
}

export function createBeatDispatcher(opts: BeatDispatcherOptions): BeatDispatcher {
  const now = opts.now ?? (() => Date.now())
  const dropAfterMs = opts.dropAfterMs ?? 3000
  const log = opts.logger ?? (() => {})

  const queue: string[] = []
  let hasSentOnce = false
  let draining = false
  let lastReadyFlushAtQueueLength: number | null = null

  function emitOne(instructions: string): void {
    const firstAttemptAt = now()
    const doSend = (): void => {
      if (hasSentOnce) {
        opts.send({ type: 'response.cancel' })
      }
      opts.send({
        type: 'response.create',
        response: { modalities: ['audio', 'text'], instructions },
      })
      hasSentOnce = true
    }
    try {
      doSend()
      return
    } catch (err) {
      log('beat.retry', { err: String(err) })
      try {
        doSend()
        return
      } catch (err2) {
        const elapsed = now() - firstAttemptAt
        if (elapsed >= dropAfterMs) {
          log('beat.dropped', { err: String(err2), elapsed, instructions })
        } else {
          log('beat.dropped', { err: String(err2), elapsed, instructions })
        }
      }
    }
  }

  function drain(): void {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0 && opts.isReady()) {
        const next = queue.shift() as string
        emitOne(next)
      }
    } finally {
      draining = false
    }
  }

  return {
    send(instructions: string): void {
      if (!opts.isReady()) {
        queue.push(instructions)
        return
      }
      queue.push(instructions)
      drain()
    },
    flushIfReady(): void {
      if (!opts.isReady()) return
      // Single flush per ready state: if the queue length hasn't grown since
      // the previous ready-flush we do nothing. This prevents retry storms
      // when callers wire flushIfReady into an effect that re-runs.
      if (lastReadyFlushAtQueueLength === queue.length) return
      lastReadyFlushAtQueueLength = queue.length
      drain()
      lastReadyFlushAtQueueLength = queue.length
    },
    pendingCount(): number {
      return queue.length
    },
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

let devOverride: boolean | null = null

function isDev(): boolean {
  if (devOverride !== null) return devOverride
  try {
    // Vite injects import.meta.env.DEV at build time.
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env
    return Boolean(env?.DEV)
  } catch {
    return false
  }
}

// Test-only escape hatch. Not part of the public contract.
export const __testing = {
  wordCount,
  isDev,
  setDevOverride(value: boolean | null): void {
    devOverride = value
  },
  SCORING_VOCAB,
  CORRECTIVE_VOCAB,
}
