/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TwoWordPhrasePanel — Stage 6 `two_word_phrase`.
 *
 * Child practices a carrier+target phrase (e.g. "my thumb", "red fish").
 * Scoring narrows to `targetWord` only; the carrier word provides natural
 * co-articulation context but is not assessed.
 *
 *   1. EXPOSE — composite phrase card grid. Tapping a card plays the
 *      phrase via TTS (preferring `ssmlTemplate` when present so the
 *      target word can be phoneme-hinted).
 *   2. PERFORM — active phrase with the target word highlighted, mic
 *      driven by parent. Each phrase requires `successesPerPhrase`
 *      successful attempts (score >= masteryThreshold) to complete.
 *   3. REINFORCE — shell owns REINFORCE copy; we fire `onExerciseComplete`
 *      on entry so App can kick off silent wrap-up.
 *
 * The component calls `onActiveTargetWordChange(targetWord)` to drive the
 * App-level active-target state so `getReferenceText()` returns the single
 * target word. Combined with `metadata.scoreScope='target_only'`, App
 * narrows `exercise_metadata.targetWords` for `/api/assess-utterance`.
 */

import { Badge, Button, Card, ProgressBar, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ExerciseMetadata, PhraseExemplar, PronunciationAssessment } from '../types'
import type { MicMode } from '../utils/micMode'
import { api } from '../services/api'
import { ImageCard } from './ImageCard'
import {
  ExerciseShell,
  useExercisePhaseContext,
  useShellAdvance,
  type ExerciseBeatCopy,
} from './ExerciseShell'
import { getPerceptLabel } from './PhonemeIcon'

const useStyles = makeStyles({
  card: {
    padding: 'var(--space-lg)',
    borderRadius: '0px',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'none',
    display: 'grid',
    gap: 'var(--space-md)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    // PR9 — teal panel title anchors each exercise card to the brand palette.
    color: 'var(--color-primary-dark)',
    fontSize: '1rem',
    fontWeight: '700',
  },
  subtitle: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.84rem',
    lineHeight: 1.5,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 720px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
    '@media (max-width: 480px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  cellShell: {
    position: 'relative',
    transition: 'transform 180ms ease, opacity 180ms ease',
  },
  cellActive: {
    transform: 'scale(1.03)',
  },
  cellDone: {
    opacity: 0.72,
  },
  cellBadge: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    zIndex: 1,
  },
  phraseCaption: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.9rem',
    textAlign: 'center',
    marginTop: '4px',
    color: 'var(--color-text-primary)',
  },
  phraseTarget: {
    fontWeight: 800,
    color: 'var(--color-primary-dark)',
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    textUnderlineOffset: '3px',
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
  },
  startButton: {
    minHeight: '44px',
  },
  activeBlock: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 220px) 1fr',
    gap: 'var(--space-md)',
    alignItems: 'center',
    '@media (max-width: 620px)': {
      gridTemplateColumns: '1fr',
    },
  },
  activePhrase: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.4rem',
    fontWeight: 700,
    color: 'var(--color-text-primary)',
  },
  attemptsMeta: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.82rem',
  },
  feedback: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.95rem',
    fontWeight: 600,
    padding: 'var(--space-xs) var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
  },
  feedbackOk: {
    color: 'var(--color-success-dark, #0f5132)',
    backgroundColor: 'var(--color-success-soft, rgba(25, 135, 84, 0.12))',
  },
  feedbackRetry: {
    color: 'var(--color-warning-dark, #664d03)',
    backgroundColor: 'var(--color-warning-soft, rgba(255, 193, 7, 0.15))',
  },
  micBanner: {
    color: 'var(--color-warning-dark, #664d03)',
    fontSize: '0.82rem',
    padding: 'var(--space-xs) var(--space-sm)',
    backgroundColor: 'var(--color-warning-soft, rgba(255, 193, 7, 0.12))',
    border: '1px dashed var(--color-border)',
    borderRadius: 'var(--radius-sm)',
  },
  progressWrap: {
    display: 'grid',
    gap: '4px',
  },
})

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  audience?: 'therapist' | 'child'
  readyToStart?: boolean
  realtimeReady?: boolean
  recording?: boolean
  utteranceFeedback?: PronunciationAssessment | null
  scoringUtterance?: boolean
  onActiveTargetWordChange?: (word: string) => void
  onToggleRecording?: () => void | Promise<void>
  onExerciseComplete?: () => void
  /** PR12b.3c — mic-mode preference. Accepted for future conversational-turn wiring; today prop-only. */
  micMode?: MicMode
  /** PR12b.3c.3 — conversational-mode scored-turn callbacks (prop-only today). */
  onScoredTurnBegin?: (payload: {
    turnId: string
    targetWord: string
    referenceText?: string
    windowMs?: number
  }) => void
  onScoredTurnEnd?: (turnId: string) => void
}

interface PhraseProgress {
  attempts: number
  successes: number
  lastScore: number | null
  complete: boolean
}

function renderPhraseCaption(
  phrase: PhraseExemplar,
  targetClass: string,
): ReactNode {
  // Split on whitespace but keep order; highlight tokens that equal targetWord.
  const tokens = phrase.phraseText.split(/(\s+)/)
  return tokens.map((tok, i) => {
    const norm = tok.trim().toLowerCase().replace(/[^a-z']/g, '')
    const targetNorm = phrase.targetWord.toLowerCase()
    if (norm && norm === targetNorm) {
      return (
        <span key={i} className={targetClass}>
          {tok}
        </span>
      )
    }
    return <span key={i}>{tok}</span>
  })
}

export function TwoWordPhrasePanel({
  scenarioName,
  metadata,
  audience = 'child',
  readyToStart = true,
  realtimeReady,
  recording = false,
  utteranceFeedback,
  scoringUtterance = false,
  onActiveTargetWordChange,
  onToggleRecording,
  onExerciseComplete,
  micMode = 'tap',
  onScoredTurnBegin,
  onScoredTurnEnd,
}: Props) {
  const styles = useStyles()
  const targetSound = metadata?.targetSound || 'target'
  const phrases: PhraseExemplar[] = useMemo(() => metadata?.phrases ?? [], [metadata?.phrases])
  const masteryThreshold = metadata?.masteryThreshold ?? 80
  const repetitionTarget = metadata?.repetitionTarget ?? Math.max(10, phrases.length * 2)
  const successesPerPhrase = phrases.length > 0
    ? Math.max(1, Math.ceil(repetitionTarget / phrases.length))
    : 1
  const perceptLabel = getPerceptLabel(targetSound)
  const frame = metadata?.phraseFrame ?? 'adj_noun'

  const shellMetadata: ExerciseMetadata = {
    type: 'two_word_phrase',
    targetSound,
    targetWords: phrases.map(p => p.targetWord),
    difficulty: metadata?.difficulty ?? 'medium',
    ...metadata,
  }

  const beats: ExerciseBeatCopy = useMemo(
    () => ({
      orient:
        audience === 'therapist'
          ? `Stage 6 ${perceptLabel} two-word phrases (${frame === 'poss_noun' ? 'my/your + noun' : 'adj + noun'}). Scoring narrows to the target word only.`
          : `Let's say two-word phrases with ${perceptLabel}. Tap a picture first.`,
      bridge: 'Say them together.',
      reinforce: 'Great phrases! See you next time.',
    }),
    [audience, frame, perceptLabel],
  )

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Two-word phrases'}</Text>
      <Text className={styles.subtitle}>
        {audience === 'therapist'
          ? `Practice ${perceptLabel} in ${phrases.length} carrier+target phrases. Mastery: ${masteryThreshold}% × ${successesPerPhrase} on target word only.`
          : `Hear each little phrase, then say it back together.`}
      </Text>
      <ExerciseShell
        metadata={shellMetadata}
        audience={audience}
        beats={beats}
        therapistCanSkipIntro={audience === 'therapist'}
        realtimeReady={realtimeReady}
        slots={{
          expose: (
            <ExposeSlot
              phrases={phrases}
              imageAssets={metadata?.imageAssets ?? []}
              readyToStart={readyToStart}
              onActiveTargetWordChange={onActiveTargetWordChange}
            />
          ),
          perform: (
            <PerformSlot
              phrases={phrases}
              imageAssets={metadata?.imageAssets ?? []}
              masteryThreshold={masteryThreshold}
              successesPerPhrase={successesPerPhrase}
              recording={recording}
              utteranceFeedback={utteranceFeedback ?? null}
              scoringUtterance={scoringUtterance}
              onActiveTargetWordChange={onActiveTargetWordChange}
              onToggleRecording={onToggleRecording}
              micMode={micMode}
              onScoredTurnBegin={onScoredTurnBegin}
              onScoredTurnEnd={onScoredTurnEnd}
            />
          ),
        }}
        performComplete={false}
        onBeatEnter={(phase) => {
          if (phase === 'reinforce' && onExerciseComplete) {
            onExerciseComplete()
          }
        }}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// EXPOSE — phrase card grid. Tap a card to hear the full phrase (SSML when
// provided so the target may be phoneme-hinted). A single preview unlocks
// the Start button.
// ---------------------------------------------------------------------------

interface ExposeSlotProps {
  phrases: PhraseExemplar[]
  imageAssets: string[]
  readyToStart: boolean
  onActiveTargetWordChange?: (word: string) => void
}

function ExposeSlot({
  phrases,
  imageAssets,
  readyToStart,
  onActiveTargetWordChange,
}: ExposeSlotProps) {
  const styles = useStyles()
  const { advance, notifyExposeInteract } = useShellAdvance()
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [previewedIndexes, setPreviewedIndexes] = useState<Set<number>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const play = useCallback(
    async (index: number) => {
      if (playingIndex !== null) return
      const phrase = phrases[index]
      if (!phrase) return
      notifyExposeInteract()
      setPlayingIndex(index)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const payload = phrase.ssmlTemplate
          ? { ssml: phrase.ssmlTemplate, fallback_text: phrase.phraseText }
          : { text: phrase.phraseText }
        const b64 = await api.synthesizeSpeech(payload, { signal: controller.signal })
        if (controller.signal.aborted) return
        const blob = new Blob(
          [Uint8Array.from(atob(b64), c => c.charCodeAt(0))],
          { type: 'audio/mpeg' },
        )
        const url = URL.createObjectURL(blob)
        await new Promise<void>((resolve) => {
          const audio = new Audio(url)
          const cleanup = () => {
            URL.revokeObjectURL(url)
            resolve()
          }
          audio.onended = cleanup
          audio.onerror = cleanup
          controller.signal.addEventListener('abort', () => {
            audio.pause()
            cleanup()
          }, { once: true })
          void audio.play().catch(cleanup)
        })
      } catch {
        // Abort or network — stay quiet.
      } finally {
        if (!controller.signal.aborted) {
          setPlayingIndex(null)
          setPreviewedIndexes(prev => {
            const next = new Set(prev)
            next.add(index)
            return next
          })
        }
      }
    },
    [notifyExposeInteract, phrases, playingIndex],
  )

  const handleStart = useCallback(() => {
    if (phrases[0]) {
      onActiveTargetWordChange?.(phrases[0].targetWord)
    }
    advance()
  }, [advance, onActiveTargetWordChange, phrases])

  const canStart = readyToStart && previewedIndexes.size > 0 && playingIndex === null

  return (
    <>
      <div className={styles.controls}>
        <Text className={styles.attemptsMeta}>
          {previewedIndexes.size === 0
            ? 'Tap a picture to hear the phrase.'
            : `${previewedIndexes.size} of ${phrases.length} previewed`}
        </Text>
        <Button
          appearance="primary"
          className={styles.startButton}
          disabled={!canStart}
          onClick={handleStart}
        >
          Start practice
        </Button>
      </div>
      <div className={styles.grid}>
        {phrases.map((phrase, i) => {
          const active = playingIndex === i
          const previewed = previewedIndexes.has(i)
          return (
            <div
              key={`twp-preview-${phrase.phraseText}-${i}`}
              data-testid={`twp-preview-${i}`}
              data-active={active ? 'true' : 'false'}
              data-previewed={previewed ? 'true' : 'false'}
              className={mergeClasses(
                styles.cellShell,
                active && styles.cellActive,
              )}
            >
              <ImageCard
                word={phrase.phraseText}
                imagePath={imageAssets[i]}
                onClick={() => { void play(i) }}
                disabled={playingIndex !== null && playingIndex !== i}
              />
              <div className={styles.phraseCaption}>
                {renderPhraseCaption(phrase, styles.phraseTarget)}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// PERFORM — active phrase + mic. Scoring is narrowed to phrase.targetWord
// via onActiveTargetWordChange; feedback accrues per phrase.
// ---------------------------------------------------------------------------

interface PerformSlotProps {
  phrases: PhraseExemplar[]
  imageAssets: string[]
  masteryThreshold: number
  successesPerPhrase: number
  recording: boolean
  utteranceFeedback: PronunciationAssessment | null
  scoringUtterance: boolean
  onActiveTargetWordChange?: (word: string) => void
  onToggleRecording?: () => void | Promise<void>
  micMode?: MicMode
  onScoredTurnBegin?: (payload: {
    turnId: string
    targetWord: string
    referenceText?: string
    windowMs?: number
  }) => void
  onScoredTurnEnd?: (turnId: string) => void
}

function PerformSlot({
  phrases,
  imageAssets,
  masteryThreshold,
  successesPerPhrase,
  recording,
  utteranceFeedback,
  scoringUtterance,
  onActiveTargetWordChange,
  onToggleRecording,
  micMode = 'tap',
  onScoredTurnBegin,
  onScoredTurnEnd,
}: PerformSlotProps) {
  const styles = useStyles()
  const ctx = useExercisePhaseContext()
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState<PhraseProgress[]>(
    () => phrases.map(() => ({ attempts: 0, successes: 0, lastScore: null, complete: false })),
  )
  const [micError, setMicError] = useState<string | null>(null)
  const lastFeedbackRef = useRef<PronunciationAssessment | null>(null)
  const performDoneRef = useRef(false)

  useEffect(() => {
    const phrase = phrases[activeIndex]
    if (phrase) {
      onActiveTargetWordChange?.(phrase.targetWord)
    }
  }, [activeIndex, onActiveTargetWordChange, phrases])

  // PR12b.3c.4 — in conversational mode, open a scored-turn window per active
  // phrase. The referenceText is the full phrase (so pronunciation assessment
  // can score the whole utterance), while targetWord narrows to the sound.
  const activeTurnIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (micMode !== 'conversational') return
    const phrase = phrases[activeIndex]
    if (!phrase || !onScoredTurnBegin) return
    const turnId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `twp-${activeIndex}-${Date.now()}`
    activeTurnIdRef.current = turnId
    onScoredTurnBegin({
      turnId,
      targetWord: phrase.targetWord,
      referenceText: phrase.phraseText,
    })
    return () => {
      if (activeTurnIdRef.current === turnId) {
        onScoredTurnEnd?.(turnId)
        activeTurnIdRef.current = null
      }
    }
  }, [activeIndex, micMode, onScoredTurnBegin, onScoredTurnEnd, phrases])

  useEffect(() => {
    if (!utteranceFeedback) return
    if (utteranceFeedback === lastFeedbackRef.current) return
    lastFeedbackRef.current = utteranceFeedback

    const score = Number.isFinite(utteranceFeedback.pronunciation_score)
      ? utteranceFeedback.pronunciation_score
      : utteranceFeedback.accuracy_score
    const success = score >= masteryThreshold

    setProgress(prev => {
      const next = prev.slice()
      const cur = next[activeIndex]
      if (!cur || cur.complete) return prev
      const attempts = cur.attempts + 1
      const successes = cur.successes + (success ? 1 : 0)
      const complete = successes >= successesPerPhrase
      next[activeIndex] = { attempts, successes, lastScore: score, complete }
      return next
    })
  }, [activeIndex, masteryThreshold, successesPerPhrase, utteranceFeedback])

  useEffect(() => {
    const cur = progress[activeIndex]
    if (!cur?.complete) return
    const nextIndex = progress.findIndex((p, i) => i > activeIndex && !p.complete)
    if (nextIndex >= 0) {
      setActiveIndex(nextIndex)
    } else {
      const anyIncomplete = progress.findIndex(p => !p.complete)
      if (anyIncomplete >= 0) {
        setActiveIndex(anyIncomplete)
      } else if (!performDoneRef.current) {
        performDoneRef.current = true
        ctx.dispatch({ type: 'PERFORM_DONE' })
      }
    }
  }, [activeIndex, ctx, progress])

  const handleMicToggle = useCallback(async () => {
    if (!onToggleRecording) return
    try {
      await onToggleRecording()
      setMicError(null)
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Microphone unavailable')
    }
  }, [onToggleRecording])

  const activePhrase = phrases[activeIndex]
  const activeImage = imageAssets[activeIndex]
  const activeProgress = progress[activeIndex]
  const overallDone = progress.filter(p => p.complete).length
  const overallPct = phrases.length > 0 ? (overallDone / phrases.length) * 100 : 0
  const lastScore = activeProgress?.lastScore
  const lastWasSuccess = lastScore !== null && lastScore !== undefined && lastScore >= masteryThreshold

  if (!activePhrase) return null

  return (
    <>
      <div className={styles.progressWrap}>
        <Text className={styles.attemptsMeta}>
          {overallDone} of {phrases.length} phrases complete
        </Text>
        <ProgressBar value={overallPct / 100} thickness="medium" />
      </div>
      <div className={styles.activeBlock}>
        {activeImage ? (
          <ImageCard word={activePhrase.phraseText} imagePath={activeImage} selected />
        ) : null}
        <div style={{ display: 'grid', gap: '8px' }}>
          <Text className={styles.activePhrase}>
            {renderPhraseCaption(activePhrase, styles.phraseTarget)}
          </Text>
          <Text className={styles.attemptsMeta}>
            {activeProgress
              ? `Tries: ${activeProgress.attempts} · Successes: ${activeProgress.successes}/${successesPerPhrase} · Scoring: ${activePhrase.targetWord}`
              : null}
          </Text>
          {lastScore !== null && lastScore !== undefined ? (
            <Text
              className={mergeClasses(
                styles.feedback,
                lastWasSuccess ? styles.feedbackOk : styles.feedbackRetry,
              )}
            >
              {lastWasSuccess
                ? `Nice — ${Math.round(lastScore)}/100. Keep going!`
                : `That was ${Math.round(lastScore)}/100. Try again.`}
            </Text>
          ) : null}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              appearance="primary"
              className={styles.startButton}
              disabled={scoringUtterance}
              onClick={() => { void handleMicToggle() }}
            >
              {recording ? 'Stop' : scoringUtterance ? 'Scoring…' : 'Say the phrase'}
            </Button>
            <Button
              appearance="secondary"
              onClick={() => {
                const nextIndex = (activeIndex + 1) % phrases.length
                setActiveIndex(nextIndex)
              }}
              disabled={phrases.length <= 1}
            >
              Next phrase
            </Button>
          </div>
          {micError ? (
            <Text className={styles.micBanner}>
              {micError}. Check browser microphone permissions, then try again.
            </Text>
          ) : null}
        </div>
      </div>
      <div className={styles.grid}>
        {phrases.map((phrase, i) => {
          const p = progress[i]
          const active = i === activeIndex
          const disabled = p?.complete
          const selectPhrase = () => {
            if (disabled) return
            setActiveIndex(i)
          }
          return (
            <button
              type="button"
              key={`twp-active-${phrase.phraseText}-${i}`}
              data-testid={`twp-active-${i}`}
              data-active={active ? 'true' : 'false'}
              data-complete={disabled ? 'true' : 'false'}
              className={mergeClasses(
                styles.cellShell,
                active && styles.cellActive,
                disabled && styles.cellDone,
              )}
              onClick={selectPhrase}
              disabled={disabled}
              style={{
                cursor: disabled ? 'default' : 'pointer',
                background: 'transparent',
                border: 'none',
                padding: 0,
                textAlign: 'inherit',
              }}
            >
              {p?.complete ? (
                <Badge appearance="filled" color="success" className={styles.cellBadge}>
                  Done
                </Badge>
              ) : null}
              <ImageCard word={phrase.phraseText} imagePath={imageAssets[i]} selected={active} />
              <div className={styles.phraseCaption}>
                {renderPhraseCaption(phrase, styles.phraseTarget)}
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}
