/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WordPositionPracticePanel — Stage 5b `word_position_practice`.
 *
 * Child practices the target sound in a specific position (medial or final)
 * across a curated word list. For each word:
 *   1. Tap the card to preview (TTS).
 *   2. After at least one preview, press "Start practice" → BRIDGE → PERFORM.
 *   3. In PERFORM, the active word's reference text is scored per attempt
 *      via `/api/assess-utterance`. Each word requires `successesPerWord`
 *      successful attempts (score >= masteryThreshold) to complete.
 *   4. Once all words complete, `performComplete=true` triggers REINFORCE.
 *
 * Scoring narrowing is achieved by calling `onActiveTargetWordChange(word)`
 * which updates the App-level active-target state, so `getReferenceText`
 * returns the single active word instead of the joined `targetWords` list.
 */

import { Badge, Button, Card, ProgressBar, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExerciseMetadata, PronunciationAssessment } from '../types'
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
    color: 'var(--color-text-primary)',
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
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  startButton: {
    minHeight: '44px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
  activeBlock: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, 220px) 1fr',
    gap: 'var(--space-md)',
    alignItems: 'center',
    '@media (max-width: 560px)': {
      gridTemplateColumns: '1fr',
    },
  },
  activeWord: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.6rem',
    fontWeight: '800',
    color: 'var(--color-primary-dark)',
  },
  attemptsMeta: {
    fontSize: '0.82rem',
    color: 'var(--color-text-secondary)',
  },
  feedback: {
    fontSize: '0.82rem',
    color: 'var(--color-text-primary)',
  },
  feedbackOk: {
    color: 'var(--color-success, #1f7a3a)',
  },
  feedbackRetry: {
    color: 'var(--color-text-secondary)',
  },
  micBanner: {
    fontSize: '0.82rem',
    color: 'var(--color-warning, #a26500)',
    padding: 'var(--space-sm)',
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
  recording?: boolean
  utteranceFeedback?: PronunciationAssessment | null
  scoringUtterance?: boolean
  onActiveTargetWordChange?: (word: string) => void
  onToggleRecording?: () => void | Promise<void>
  onExerciseComplete?: () => void
}

interface WordProgress {
  attempts: number
  successes: number
  lastScore: number | null
  complete: boolean
}

function positionLabel(sub: 'medial' | 'final' | undefined): string {
  if (sub === 'final') return 'end'
  if (sub === 'medial') return 'middle'
  return ''
}

export function WordPositionPracticePanel({
  scenarioName,
  metadata,
  audience = 'child',
  readyToStart = true,
  recording = false,
  utteranceFeedback,
  scoringUtterance = false,
  onActiveTargetWordChange,
  onToggleRecording,
  onExerciseComplete,
}: Props) {
  const styles = useStyles()
  const targetSound = metadata?.targetSound || 'target'
  const subStep: 'medial' | 'final' | undefined =
    metadata?.subStep ??
    (metadata?.wordPosition === 'medial' || metadata?.wordPosition === 'final'
      ? metadata.wordPosition
      : undefined)
  const posWord = positionLabel(subStep)
  const targetWords = useMemo(() => metadata?.targetWords ?? [], [metadata?.targetWords])
  const imageAssets = useMemo(() => metadata?.imageAssets ?? [], [metadata?.imageAssets])
  const masteryThreshold = metadata?.masteryThreshold ?? 80
  const repetitionTarget = metadata?.repetitionTarget ?? 20
  const successesPerWord = targetWords.length > 0
    ? Math.max(1, Math.ceil(repetitionTarget / targetWords.length))
    : 1
  const perceptLabel = getPerceptLabel(targetSound)

  const shellMetadata: ExerciseMetadata = {
    type: 'word_position_practice',
    targetSound,
    targetWords,
    difficulty: metadata?.difficulty ?? 'medium',
    ...metadata,
  }

  const beats: ExerciseBeatCopy = useMemo(
    () => ({
      orient:
        audience === 'therapist'
          ? `Stage 5b ${perceptLabel}${posWord ? ` in the ${posWord}` : ''}. Tap a picture to preview, then practice.`
          : posWord
            ? `Let's say ${perceptLabel} words with the sound in the ${posWord}.`
            : `Let's practice ${perceptLabel} words together.`,
      bridge: posWord
        ? `Sound goes in the ${posWord}.`
        : 'Sound on target.',
      reinforce: 'Great practice! See you next time.',
    }),
    [audience, perceptLabel, posWord],
  )

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Word practice'}</Text>
      <Text className={styles.subtitle}>
        {audience === 'therapist'
          ? `Practice ${perceptLabel}${posWord ? `-${subStep}` : ''} across ${targetWords.length} curated words. Mastery: ${masteryThreshold}% × ${successesPerWord}.`
          : posWord
            ? `Hear the ${perceptLabel} sound in the ${posWord} of each word, then say it back.`
            : 'Hear each word, then say it back.'}
      </Text>
      <ExerciseShell
        metadata={shellMetadata}
        audience={audience}
        beats={beats}
        therapistCanSkipIntro={audience === 'therapist'}
        slots={{
          expose: (
            <ExposeSlot
              targetWords={targetWords}
              imageAssets={imageAssets}
              readyToStart={readyToStart}
              voiceName={undefined}
              onActiveTargetWordChange={onActiveTargetWordChange}
            />
          ),
          perform: (
            <PerformSlot
              targetWords={targetWords}
              imageAssets={imageAssets}
              masteryThreshold={masteryThreshold}
              successesPerWord={successesPerWord}
              recording={recording}
              utteranceFeedback={utteranceFeedback ?? null}
              scoringUtterance={scoringUtterance}
              onActiveTargetWordChange={onActiveTargetWordChange}
              onToggleRecording={onToggleRecording}
            />
          ),
        }}
        performComplete={false /* PerformSlot writes via ref-bridge below */}
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
// EXPOSE — preview grid. Tapping a card plays the word via TTS and marks the
// expose gate as touched so Start Practice enables.
// ---------------------------------------------------------------------------

interface ExposeSlotProps {
  targetWords: string[]
  imageAssets: string[]
  readyToStart: boolean
  voiceName?: string
  onActiveTargetWordChange?: (word: string) => void
}

function ExposeSlot({
  targetWords,
  imageAssets,
  readyToStart,
  voiceName,
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
      const word = targetWords[index]
      if (!word) return
      notifyExposeInteract()
      setPlayingIndex(index)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const b64 = await api.synthesizeSpeech(
          voiceName ? { text: word, voiceName } : { text: word },
          { signal: controller.signal },
        )
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
    [notifyExposeInteract, playingIndex, targetWords, voiceName],
  )

  const handleStart = useCallback(() => {
    if (targetWords[0]) {
      onActiveTargetWordChange?.(targetWords[0])
    }
    advance()
  }, [advance, onActiveTargetWordChange, targetWords])

  const canStart = readyToStart && previewedIndexes.size > 0 && playingIndex === null

  return (
    <>
      <div className={styles.controls}>
        <Text className={styles.attemptsMeta}>
          {previewedIndexes.size === 0
            ? 'Tap a picture to hear it.'
            : `${previewedIndexes.size} of ${targetWords.length} previewed`}
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
        {targetWords.map((word, i) => {
          const active = playingIndex === i
          const previewed = previewedIndexes.has(i)
          return (
            <div
              key={`wpp-preview-${word}`}
              data-testid={`wpp-preview-${i}`}
              data-active={active ? 'true' : 'false'}
              data-previewed={previewed ? 'true' : 'false'}
              className={mergeClasses(
                styles.cellShell,
                active && styles.cellActive,
              )}
            >
              <ImageCard
                word={word}
                imagePath={imageAssets[i]}
                onClick={() => { void play(i) }}
                disabled={playingIndex !== null && playingIndex !== i}
              />
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// PERFORM — active word + mic, per-word progress, auto-advance.
// ---------------------------------------------------------------------------

interface PerformSlotProps {
  targetWords: string[]
  imageAssets: string[]
  masteryThreshold: number
  successesPerWord: number
  recording: boolean
  utteranceFeedback: PronunciationAssessment | null
  scoringUtterance: boolean
  onActiveTargetWordChange?: (word: string) => void
  onToggleRecording?: () => void | Promise<void>
}

function PerformSlot({
  targetWords,
  imageAssets,
  masteryThreshold,
  successesPerWord,
  recording,
  utteranceFeedback,
  scoringUtterance,
  onActiveTargetWordChange,
  onToggleRecording,
}: PerformSlotProps) {
  const styles = useStyles()
  const ctx = useExercisePhaseContext()
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState<WordProgress[]>(
    () => targetWords.map(() => ({ attempts: 0, successes: 0, lastScore: null, complete: false })),
  )
  const [micError, setMicError] = useState<string | null>(null)
  const lastFeedbackRef = useRef<PronunciationAssessment | null>(null)
  const performDoneRef = useRef(false)

  // On mount / when active word changes, inform App of the active reference.
  useEffect(() => {
    const word = targetWords[activeIndex]
    if (word) {
      onActiveTargetWordChange?.(word)
    }
  }, [activeIndex, onActiveTargetWordChange, targetWords])

  // Observe new utteranceFeedback instances and attribute them to active word.
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
      const complete = successes >= successesPerWord
      next[activeIndex] = { attempts, successes, lastScore: score, complete }
      return next
    })
  }, [activeIndex, masteryThreshold, successesPerWord, utteranceFeedback])

  // When the active word completes, auto-advance to next unfinished word, or
  // mark perform complete.
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

  const activeWord = targetWords[activeIndex] || ''
  const activeImage = imageAssets[activeIndex]
  const activeProgress = progress[activeIndex]
  const overallDone = progress.filter(p => p.complete).length
  const overallPct = targetWords.length > 0 ? (overallDone / targetWords.length) * 100 : 0
  const lastScore = activeProgress?.lastScore
  const lastWasSuccess = lastScore !== null && lastScore !== undefined && lastScore >= masteryThreshold

  return (
    <>
      <div className={styles.progressWrap}>
        <Text className={styles.attemptsMeta}>
          {overallDone} of {targetWords.length} words complete
        </Text>
        <ProgressBar value={overallPct / 100} thickness="medium" />
      </div>
      <div className={styles.activeBlock}>
        {activeImage ? (
          <ImageCard word={activeWord} imagePath={activeImage} selected />
        ) : null}
        <div style={{ display: 'grid', gap: '8px' }}>
          <Text className={styles.activeWord}>{activeWord}</Text>
          <Text className={styles.attemptsMeta}>
            {activeProgress
              ? `Tries: ${activeProgress.attempts} · Successes: ${activeProgress.successes}/${successesPerWord}`
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
              {recording ? 'Stop' : scoringUtterance ? 'Scoring…' : 'Say the word'}
            </Button>
            <Button
              appearance="secondary"
              onClick={() => {
                const nextIndex = (activeIndex + 1) % targetWords.length
                setActiveIndex(nextIndex)
              }}
              disabled={targetWords.length <= 1}
            >
              Next word
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
        {targetWords.map((word, i) => {
          const p = progress[i]
          const active = i === activeIndex
          const disabled = p?.complete
          const selectWord = () => {
            if (disabled) return
            setActiveIndex(i)
          }
          return (
            <button
              type="button"
              key={`wpp-active-${word}`}
              data-testid={`wpp-active-${i}`}
              data-active={active ? 'true' : 'false'}
              data-complete={disabled ? 'true' : 'false'}
              className={mergeClasses(
                styles.cellShell,
                active && styles.cellActive,
                disabled && styles.cellDone,
              )}
              onClick={selectWord}
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
              <ImageCard word={word} imagePath={imageAssets[i]} selected={active} />
            </button>
          )
        })}
      </div>
    </>
  )
}
