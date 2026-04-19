/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * StructuredConversationPanel — Stage 8 `structured_conversation`.
 *
 * The child picks a topic during a covert EXPOSE phase (no explicit target
 * model) and then enters ~2–5 min of open conversation in PERFORM. The
 * backend (gated by `WULO_STRUCTURED_CONVERSATION=1`) runs a per-connection
 * `TargetTokenTally` and pushes `wulo.target_tally` updates plus
 * `wulo.scaffold_escalate` hints. This panel is purely presentational over
 * that state:
 *
 *   EXPOSE    — topic picker (no explicit sound model)
 *   BRIDGE    — suppressed (`suppressBridge`)
 *   PERFORM   — tally meter, Model it overlay, therapist overrides, mic
 *   REINFORCE — summary panel with counts and standout productions
 *
 * The shell's built-in demoted expose accordion is hidden via
 * `hideDemotedExpose={true}` so Stage 8 can own its own "Model it"
 * affordance inside PERFORM.
 *
 * All tally mutation flows through `onSendRealtime` so the backend remains
 * authoritative. The panel never locally tallies tokens.
 */

import {
  Badge,
  Button,
  Card,
  ProgressBar,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ExerciseMetadata,
  StructuredConversationTopic,
  TargetTally,
} from '../types'
import { ImageCard } from './ImageCard'
import {
  ExerciseShell,
  useExercisePhaseContext,
  useShellAdvance,
  type ExerciseBeatCopy,
} from './ExerciseShell'
import { getPerceptLabel } from './PhonemeIcon'

const DEFAULT_TARGET_COUNT_GATE = 15
const DEFAULT_DURATION_FLOOR_SECONDS = 120

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
  topicGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 'var(--space-md)',
  },
  topicCell: {
    position: 'relative',
    transition: 'transform 180ms ease, opacity 180ms ease',
    cursor: 'pointer',
  },
  topicCellSelected: {
    transform: 'scale(1.03)',
  },
  topicCaption: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.9rem',
    textAlign: 'center',
    marginTop: '4px',
  },
  perform: {
    display: 'grid',
    gap: 'var(--space-md)',
  },
  meter: {
    display: 'grid',
    gap: '6px',
  },
  meterRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontFamily: 'var(--font-display)',
    fontSize: '0.85rem',
  },
  overrideRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
  },
  summary: {
    display: 'grid',
    gap: '6px',
    fontSize: '0.9rem',
  },
  escalateBadge: {
    alignSelf: 'start',
  },
})

export type StructuredConversationOverrideOp =
  | 'increment_correct'
  | 'increment_incorrect'
  | 'decrement_correct'
  | 'decrement_incorrect'

interface StructuredConversationPanelProps {
  scenarioName?: string
  metadata?: Partial<ExerciseMetadata>
  audience?: 'child' | 'therapist'
  readyToStart?: boolean
  realtimeReady?: boolean
  recording?: boolean
  /** Live backend tally snapshot. Undefined until the first `wulo.target_tally` arrives. */
  targetTally?: TargetTally | null
  onToggleRecording?: () => void | Promise<void>
  /**
   * Low-level emitter for Wulo-namespaced custom WS events. The App layer
   * wires this to `useRealtime().send`. Panel only constructs the payloads.
   */
  onSendRealtime?: (payload: Record<string, unknown>) => void
  /** Therapist-initiated TTS of a single target word for "Model it". */
  onSpeakExerciseText?: (text: string) => Promise<void>
  onExerciseComplete?: () => void
}

/**
 * Root panel. Delegates phase copy to the shell and owns only the
 * Stage 8-specific slots + completion gate.
 */
export function StructuredConversationPanel({
  scenarioName,
  metadata,
  audience = 'child',
  readyToStart = false,
  realtimeReady,
  recording = false,
  targetTally,
  onToggleRecording,
  onSendRealtime,
  onSpeakExerciseText,
  onExerciseComplete,
}: StructuredConversationPanelProps) {
  const styles = useStyles()

  const topics: StructuredConversationTopic[] = metadata?.topics ?? []
  const imageAssets: string[] = metadata?.imageAssets ?? []
  const targetSound = metadata?.targetSound ?? ''
  const perceptLabel = useMemo(
    () => (targetSound ? getPerceptLabel(targetSound) : 'the target sound'),
    [targetSound],
  )
  const targetCountGate = metadata?.targetCountGate ?? DEFAULT_TARGET_COUNT_GATE
  const durationFloorSeconds =
    metadata?.durationFloorSeconds ?? DEFAULT_DURATION_FLOOR_SECONDS

  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)

  // Tell the backend which target-sound + substitution signals to track as
  // soon as the exercise mounts. Safe to re-send on any metadata change.
  const configuredKeyRef = useRef<string>('')
  useEffect(() => {
    if (!onSendRealtime || !realtimeReady) return
    const suggested = topics.flatMap(t => t.suggestedTargetWords ?? [])
    const key = JSON.stringify({
      suggested,
      subs: metadata?.expectedSubstitutions ?? [],
      gate: metadata?.scaffoldEscalation ?? {},
    })
    if (key === configuredKeyRef.current) return
    configuredKeyRef.current = key
    onSendRealtime({
      type: 'wulo.tally_configure',
      payload: {
        suggestedTargetWords: suggested,
        expectedSubstitutions: metadata?.expectedSubstitutions ?? [],
        windowSeconds: metadata?.scaffoldEscalation?.windowSeconds,
        minTokensInWindow: metadata?.scaffoldEscalation?.minTokensInWindow,
        cooldownSeconds: metadata?.scaffoldEscalation?.cooldownSeconds,
      },
    })
  }, [metadata, onSendRealtime, realtimeReady, topics])

  const performComplete = useMemo(() => {
    if (!targetTally) return false
    return (
      targetTally.elapsedSeconds >= durationFloorSeconds &&
      targetTally.totalCount >= targetCountGate
    )
  }, [durationFloorSeconds, targetCountGate, targetTally])

  const beats: ExerciseBeatCopy = useMemo(
    () => ({
      orient:
        audience === 'therapist'
          ? `Structured conversation — ${perceptLabel}. Pick a topic with the child, then chat naturally.`
          : "Let's chat! Pick a topic you like.",
      bridge: '',
      reinforce:
        audience === 'therapist'
          ? 'Review productions and overrides together.'
          : 'Great chatting! See you next time.',
    }),
    [audience, perceptLabel],
  )

  const shellMetadata = useMemo(
    () => ({
      targetSound,
      targetWords: [] as string[],
      difficulty: metadata?.difficulty ?? 'medium',
      type: 'structured_conversation' as const,
      imageAssets: [],
    }),
    [metadata?.difficulty, targetSound],
  )

  const handleOverride = useCallback(
    (op: StructuredConversationOverrideOp) => {
      if (!onSendRealtime) return
      const payload =
        op === 'increment_correct'
          ? { correctDelta: 1 }
          : op === 'increment_incorrect'
          ? { incorrectDelta: 1 }
          : op === 'decrement_correct'
          ? { correctDelta: -1 }
          : { incorrectDelta: -1 }
      onSendRealtime({ type: 'wulo.therapist_override', payload })
    },
    [onSendRealtime],
  )

  const handleRequestPause = useCallback(() => {
    onSendRealtime?.({ type: 'wulo.request_pause' })
  }, [onSendRealtime])

  const handleRequestResume = useCallback(() => {
    onSendRealtime?.({ type: 'wulo.request_resume' })
  }, [onSendRealtime])

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>
        {scenarioName || 'Structured conversation'}
      </Text>
      <Text className={styles.subtitle}>
        {audience === 'therapist'
          ? `Connected speech for ${perceptLabel}. Target ${targetCountGate} productions over ${durationFloorSeconds}s minimum. Recasts only; no hard correction.`
          : "Pick a topic, then tell me all about it!"}
      </Text>
      <ExerciseShell
        metadata={shellMetadata}
        audience={audience}
        beats={beats}
        therapistCanSkipIntro={audience === 'therapist'}
        realtimeReady={realtimeReady}
        suppressBridge
        hideDemotedExpose
        slots={{
          expose: (
            <TopicPickerSlot
              topics={topics}
              imageAssets={imageAssets}
              readyToStart={readyToStart}
              selectedTopicId={selectedTopicId}
              onSelectTopic={setSelectedTopicId}
            />
          ),
          perform: (
            <PerformSlot
              audience={audience}
              topics={topics}
              selectedTopicId={selectedTopicId}
              recording={recording}
              targetTally={targetTally ?? null}
              targetCountGate={targetCountGate}
              durationFloorSeconds={durationFloorSeconds}
              onToggleRecording={onToggleRecording}
              onOverride={handleOverride}
              onRequestPause={handleRequestPause}
              onRequestResume={handleRequestResume}
              onSpeakExerciseText={onSpeakExerciseText}
            />
          ),
          reinforce: (
            <ReinforceSlot audience={audience} targetTally={targetTally ?? null} />
          ),
        }}
        performComplete={performComplete}
        onBeatEnter={phase => {
          if (phase === 'reinforce' && onExerciseComplete) {
            onExerciseComplete()
          }
        }}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// EXPOSE — topic picker (covert; no explicit target-sound model).
// ---------------------------------------------------------------------------

interface TopicPickerSlotProps {
  topics: StructuredConversationTopic[]
  imageAssets: string[]
  readyToStart: boolean
  selectedTopicId: string | null
  onSelectTopic: (topicId: string) => void
}

function TopicPickerSlot({
  topics,
  imageAssets,
  readyToStart,
  selectedTopicId,
  onSelectTopic,
}: TopicPickerSlotProps) {
  const styles = useStyles()
  const { advance, notifyExposeInteract } = useShellAdvance()
  const phase = useExercisePhaseContext().phase

  const handleSelect = useCallback(
    (topicId: string) => {
      onSelectTopic(topicId)
      notifyExposeInteract()
    },
    [notifyExposeInteract, onSelectTopic],
  )

  if (topics.length === 0) {
    return (
      <Text size={300}>
        (No topics configured. Add <code>topics[]</code> to the exercise
        YAML.)
      </Text>
    )
  }

  return (
    <div>
      <div
        className={styles.topicGrid}
        data-slot="structured-conversation-topics"
      >
        {topics.map((topic, idx) => {
          const isSelected = topic.topicId === selectedTopicId
          const src = imageAssets[idx]
          return (
            <button
              type="button"
              key={topic.topicId}
              className={mergeClasses(
                styles.topicCell,
                isSelected && styles.topicCellSelected,
              )}
              data-topic-id={topic.topicId}
              onClick={() => handleSelect(topic.topicId)}
              aria-pressed={isSelected}
              aria-label={`Pick topic ${topic.title}`}
            >
              <ImageCard
                word={topic.title}
                imagePath={src}
                selected={isSelected}
              />
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 'var(--space-md)' }}>
        <Button
          appearance="primary"
          disabled={!readyToStart || !selectedTopicId || phase !== 'expose'}
          onClick={() => advance()}
          data-testid="structured-conversation-start"
        >
          Start talking
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PERFORM — tally meter, Model it affordance, therapist overrides, mic.
// ---------------------------------------------------------------------------

interface PerformSlotProps {
  audience: 'child' | 'therapist'
  topics: StructuredConversationTopic[]
  selectedTopicId: string | null
  recording: boolean
  targetTally: TargetTally | null
  targetCountGate: number
  durationFloorSeconds: number
  onToggleRecording?: () => void | Promise<void>
  onOverride: (op: StructuredConversationOverrideOp) => void
  onRequestPause: () => void
  onRequestResume: () => void
  onSpeakExerciseText?: (text: string) => Promise<void>
}

function PerformSlot({
  audience,
  topics,
  selectedTopicId,
  recording,
  targetTally,
  targetCountGate,
  durationFloorSeconds,
  onToggleRecording,
  onOverride,
  onRequestPause,
  onRequestResume,
  onSpeakExerciseText,
}: PerformSlotProps) {
  const styles = useStyles()
  const [paused, setPaused] = useState(false)

  const topic = useMemo(
    () => topics.find(t => t.topicId === selectedTopicId) ?? null,
    [selectedTopicId, topics],
  )

  const handleModelIt = useCallback(async () => {
    if (!topic || !onSpeakExerciseText) return
    const word = topic.suggestedTargetWords[0]
    if (!word) return
    setPaused(true)
    onRequestPause()
    try {
      await onSpeakExerciseText(word)
    } finally {
      setPaused(false)
      onRequestResume()
    }
  }, [onRequestPause, onRequestResume, onSpeakExerciseText, topic])

  const elapsed = targetTally?.elapsedSeconds ?? 0
  const total = targetTally?.totalCount ?? 0
  const accuracy = targetTally?.accuracy ?? 0
  const scaffoldEscalated = targetTally?.scaffoldEscalated ?? false
  const progress = Math.min(1, total / Math.max(1, targetCountGate))

  return (
    <div className={styles.perform} data-slot="structured-conversation-perform">
      {topic ? (
        <Text className={styles.subtitle}>
          Topic: <strong>{topic.title}</strong>
        </Text>
      ) : null}
      {scaffoldEscalated ? (
        <Badge
          className={styles.escalateBadge}
          appearance="filled"
          color="warning"
          data-slot="scaffold-escalate-badge"
        >
          Offer a target-biased prompt
        </Badge>
      ) : null}
      <div className={styles.meter} data-slot="tally-meter">
        <div className={styles.meterRow}>
          <span>
            {total}/{targetCountGate} productions
          </span>
          <span>
            {Math.min(99, Math.round((elapsed / durationFloorSeconds) * 100))}% time
          </span>
        </div>
        <ProgressBar value={progress} thickness="medium" shape="square" />
        <div className={styles.meterRow}>
          <span>Correct: {targetTally?.correctCount ?? 0}</span>
          <span>Incorrect: {targetTally?.incorrectCount ?? 0}</span>
          <span>Accuracy: {Math.round(accuracy * 100)}%</span>
        </div>
      </div>

      <div className={styles.overrideRow}>
        <Button
          appearance={recording ? 'secondary' : 'primary'}
          onClick={() => onToggleRecording?.()}
          data-testid="structured-conversation-mic"
        >
          {recording ? 'Stop' : 'Talk'}
        </Button>
        <Button
          appearance="secondary"
          onClick={handleModelIt}
          disabled={!topic || paused}
          data-testid="structured-conversation-model-it"
        >
          Model it
        </Button>
      </div>

      {audience === 'therapist' ? (
        <div
          className={styles.overrideRow}
          data-slot="structured-conversation-overrides"
        >
          <Button
            size="small"
            onClick={() => onOverride('increment_correct')}
            data-testid="override-inc-correct"
          >
            +1 correct
          </Button>
          <Button
            size="small"
            onClick={() => onOverride('increment_incorrect')}
            data-testid="override-inc-incorrect"
          >
            +1 incorrect
          </Button>
          <Button
            size="small"
            onClick={() => onOverride('decrement_correct')}
          >
            -1 correct
          </Button>
          <Button
            size="small"
            onClick={() => onOverride('decrement_incorrect')}
          >
            -1 incorrect
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// REINFORCE — summary panel.
// ---------------------------------------------------------------------------

interface ReinforceSlotProps {
  audience: 'child' | 'therapist'
  targetTally: TargetTally | null
}

function ReinforceSlot({ audience, targetTally }: ReinforceSlotProps) {
  const styles = useStyles()
  if (!targetTally) {
    return <Text size={300}>{audience === 'therapist' ? 'No tally recorded.' : 'All done!'}</Text>
  }
  return (
    <div className={styles.summary} data-slot="structured-conversation-summary">
      <Text>
        {targetTally.correctCount} correct / {targetTally.incorrectCount} incorrect
        {' '}
        ({Math.round(targetTally.accuracy * 100)}% accuracy)
      </Text>
      <Text>
        {Math.round(targetTally.elapsedSeconds)} seconds of connected speech
      </Text>
      {targetTally.standouts && targetTally.standouts.length > 0 ? (
        <Text>
          Great words: {targetTally.standouts.join(', ')}
        </Text>
      ) : null}
    </div>
  )
}
