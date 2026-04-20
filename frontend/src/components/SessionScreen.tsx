/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Card,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import type React from 'react'
import type {
  ChildProfile,
  CustomScenario,
  ExerciseMetadata,
  Message,
  PronunciationAssessment,
  Scenario,
  TargetTally,
} from '../types'
import { ChatPanel } from './ChatPanel'
import { ExerciseFeedback } from './ExerciseFeedback'
import { ListeningMinimalPairsPanel } from './ListeningMinimalPairsPanel'
import { SilentSortingPanel } from './SilentSortingPanel'
import { AuditoryBombardmentPanel } from './AuditoryBombardmentPanel'
import { PhonemeChip } from './PhonemeChip'
import { SoundIsolationPanel } from './SoundIsolationPanel'
import { VowelBlendingPanel } from './VowelBlendingPanel'
import { WordPositionPracticePanel } from './WordPositionPracticePanel'
import { TwoWordPhrasePanel } from './TwoWordPhrasePanel'
import { StructuredConversationPanel } from './StructuredConversationPanel'
import { VideoPanel } from './VideoPanel'
import { exerciseRequiresMic } from '../utils/exerciseMode'
import type { MicMode } from '../utils/micMode'

const useStyles = makeStyles({
  stage: {
    opacity: 1,
    transform: 'translateY(0) scale(1)',
    transition: 'opacity 360ms ease-out, transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'opacity, transform',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  stageLaunching: {
    opacity: 0.82,
    transform: 'translateY(18px) scale(0.985)',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.18fr) minmax(380px, 0.92fr)',
    gap: 'var(--space-xl)',
    alignItems: 'start',
    '@media (max-width: 1180px)': {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 0.86fr)',
    },
    '@media (max-width: 980px)': {
      gridTemplateColumns: '1fr',
      gap: 'var(--space-lg)',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  heroColumn: {
    display: 'grid',
    gap: 'var(--space-lg)',
    minWidth: 0,
    width: '100%',
    justifySelf: 'stretch',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  sideColumn: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
    '@media (max-width: 980px)': {
      width: '100%',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  // PR8 — more deliberate visual rhythm: teal rule on the leading edge anchors
  // the card to the brand palette without piling on shadows or radii.
  scenarioCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    borderLeft: '3px solid var(--color-primary)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.12), transparent 34%), var(--color-bg-card)',
    boxShadow: 'var(--shadow-sm)',
    display: 'grid',
    gap: 'var(--space-sm)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  scenarioTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.2rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  scenarioDescription: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.875rem',
    lineHeight: 1.6,
  },
  exerciseMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  exerciseChip: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '26px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
    fontFamily: 'var(--font-display)',
    fontSize: '0.75rem',
    fontWeight: '500',
  },
})

interface SessionScreenProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  messages: Message[]
  launching?: boolean
  recording: boolean
  connected: boolean
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  connectionMessage: string
  introComplete: boolean
  sessionFinished: boolean
  canAnalyze: boolean
  onToggleRecording: () => void | Promise<void>
  onClear: () => void
  onAnalyze: () => void
  scenario: Scenario | CustomScenario | null
  isChildMode: boolean
  selectedChild: ChildProfile | null
  selectedAvatar: string
  introPending: boolean
  onVideoLoaded: () => void
  utteranceFeedback: PronunciationAssessment | null
  scoringUtterance: boolean
  activeReferenceText: string
  onActiveBlendChange?: (blend: string) => void
  onSendExerciseMessage?: (text: string) => void
  onSpeakExerciseText?: (text: string) => Promise<void>
  onRecordExerciseSelection?: (text: string) => void
  onInterruptAvatar?: () => void
  onListeningPracticeComplete?: () => void
  onSilentSortingComplete?: () => void
  onAuditoryBombardmentComplete?: (opts?: { immediate?: boolean }) => void
  onWordPositionPracticeComplete?: () => void
  onTwoWordPhraseComplete?: () => void
  onStructuredConversationComplete?: () => void
  onSendRealtime?: (payload: Record<string, unknown>) => void
  targetTally?: TargetTally | null
  /** Stage 6+: realtime WS ready so shells can flush queued beats. */
  realtimeReady?: boolean
  /** PR12b.3b — mic-mode preference from App.tsx/useMicMode. Defaults to 'tap'. */
  micMode?: MicMode
  /** PR12b.3c.3 — open a scored-turn window (conversational mode only). */
  onScoredTurnBegin?: (payload: {
    turnId: string
    targetWord: string
    referenceText?: string
    windowMs?: number
  }) => void
  /** PR12b.3c.3 — client-side end of a scored-turn window. */
  onScoredTurnEnd?: (turnId: string) => void
}

function formatExerciseType(value?: string) {
  if (!value) return null

  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function isCustomScenario(
  scenario: Scenario | CustomScenario | null | undefined
): scenario is CustomScenario {
  return Boolean(scenario && 'scenarioData' in scenario)
}

function getScenarioExerciseMetadata(
  scenario: Scenario | CustomScenario | null
): Partial<ExerciseMetadata> | undefined {
  if (!scenario) return undefined

  if (isCustomScenario(scenario)) {
    return {
      type: scenario.scenarioData.exerciseType,
      targetSound: scenario.scenarioData.targetSound,
      targetWords: scenario.scenarioData.targetWords,
      difficulty: scenario.scenarioData.difficulty,
      requiresMic: exerciseRequiresMic(undefined, scenario.scenarioData.exerciseType),
    }
  }

  return scenario.exerciseMetadata
}

export function SessionScreen({
  videoRef,
  messages,
  launching = false,
  recording,
  connected,
  connectionState,
  connectionMessage,
  introComplete,
  sessionFinished,
  canAnalyze,
  onToggleRecording,
  onClear,
  onAnalyze,
  scenario,
  isChildMode,
  selectedChild,
  selectedAvatar,
  introPending,
  onVideoLoaded,
  utteranceFeedback,
  scoringUtterance,
  activeReferenceText,
  onActiveBlendChange,
  onSendExerciseMessage,
  onSpeakExerciseText,
  onRecordExerciseSelection,
  onInterruptAvatar,
  onListeningPracticeComplete,
  onSilentSortingComplete,
  onAuditoryBombardmentComplete,
  onWordPositionPracticeComplete,
  onTwoWordPhraseComplete,
  onStructuredConversationComplete,
  onSendRealtime,
  targetTally,
  realtimeReady,
  micMode = 'tap',
  onScoredTurnBegin,
  onScoredTurnEnd,
}: SessionScreenProps) {
  const styles = useStyles()
  const customScenario = isCustomScenario(scenario) ? scenario : null
  const exerciseMetadata = getScenarioExerciseMetadata(scenario)
  const micRequired = exerciseRequiresMic(exerciseMetadata)
  const canTalk = micRequired && connected && introComplete && !sessionFinished
  const exerciseType = formatExerciseType(
    customScenario?.scenarioData.exerciseType || scenario?.exerciseMetadata?.type
  )
  const showMicDock = micRequired
  const isListeningMinimalPairs = exerciseMetadata?.type === 'listening_minimal_pairs'
  const isSilentSorting = exerciseMetadata?.type === 'silent_sorting'
  const isAuditoryBombardment = exerciseMetadata?.type === 'auditory_bombardment'
  const isSoundIsolation = exerciseMetadata?.type === 'sound_isolation'
  const isVowelBlending = exerciseMetadata?.type === 'vowel_blending'
  const isWordPositionPractice = exerciseMetadata?.type === 'word_position_practice'
  const isTwoWordPhrase = exerciseMetadata?.type === 'two_word_phrase'
  const isStructuredConversation = exerciseMetadata?.type === 'structured_conversation'

  // Child mode must not block exercise interactivity on the realtime greeting
  // (`introComplete`). If the Voice Live WS never emits an assistant transcript
  // (capacity / bad agent_id / offline dev), a 4-year-old would otherwise see a
  // dead page. Therapist mode keeps the stricter gate because the summary/
  // coaching flow still depends on the greeting having landed.
  const panelReadyToStart = connected && (isChildMode || introComplete) && !sessionFinished

  const activityPanel = isStructuredConversation ? (
    <StructuredConversationPanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      audience={isChildMode ? 'child' : 'therapist'}
      readyToStart={panelReadyToStart}
      realtimeReady={realtimeReady}
      recording={recording}
      targetTally={targetTally ?? null}
      onToggleRecording={onToggleRecording}
      onSendRealtime={onSendRealtime}
      onSpeakExerciseText={onSpeakExerciseText}
      onExerciseComplete={onStructuredConversationComplete}
    />
  ) : isTwoWordPhrase ? (
    <TwoWordPhrasePanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      audience={isChildMode ? 'child' : 'therapist'}
      readyToStart={panelReadyToStart}
      realtimeReady={realtimeReady}
      recording={recording}
      utteranceFeedback={utteranceFeedback}
      scoringUtterance={scoringUtterance}
      onActiveTargetWordChange={onActiveBlendChange}
      onToggleRecording={onToggleRecording}
      onExerciseComplete={onTwoWordPhraseComplete}
      micMode={micMode}
      onScoredTurnBegin={onScoredTurnBegin}
      onScoredTurnEnd={onScoredTurnEnd}
    />
  ) : isWordPositionPractice ? (
    <WordPositionPracticePanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      audience={isChildMode ? 'child' : 'therapist'}
      readyToStart={panelReadyToStart}
      recording={recording}
      utteranceFeedback={utteranceFeedback}
      scoringUtterance={scoringUtterance}
      onActiveTargetWordChange={onActiveBlendChange}
      onToggleRecording={onToggleRecording}
      onExerciseComplete={onWordPositionPracticeComplete}
      micMode={micMode}
      onScoredTurnBegin={onScoredTurnBegin}
      onScoredTurnEnd={onScoredTurnEnd}
    />
  ) : isAuditoryBombardment ? (
    <AuditoryBombardmentPanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      audience={isChildMode ? 'child' : 'therapist'}
      readyToStart={panelReadyToStart}
      onExerciseComplete={onAuditoryBombardmentComplete}
      onSpeakExerciseText={onSpeakExerciseText}
    />
  ) : isListeningMinimalPairs ? (
    <ListeningMinimalPairsPanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      audience={isChildMode ? 'child' : 'therapist'}
      readyToStart={panelReadyToStart}
      onSendMessage={onSendExerciseMessage}
      onSpeakExerciseText={onSpeakExerciseText}
      onRecordExerciseSelection={onRecordExerciseSelection}
      onInterruptAvatar={onInterruptAvatar}
      onCompleteSession={onListeningPracticeComplete}
    />
  ) : isSilentSorting ? (
    <SilentSortingPanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      audience={isChildMode ? 'child' : 'therapist'}
      readyToStart={panelReadyToStart}
      onSendMessage={onSendExerciseMessage}
      onSpeakExerciseText={onSpeakExerciseText}
      onExerciseComplete={onSilentSortingComplete}
    />
  ) : isSoundIsolation ? (
    <SoundIsolationPanel
      key={`${scenario?.name || 'sound-isolation'}-${exerciseMetadata?.targetSound || 'sound'}`}
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      attempts={messages.filter(message => message.role === 'user').length}
      audience={isChildMode ? 'child' : 'therapist'}
      onSendMessage={onSendExerciseMessage}
      micMode={micMode}
    />
  ) : isVowelBlending ? (
    <VowelBlendingPanel
      scenarioName={scenario?.name}
      metadata={exerciseMetadata}
      attempts={messages.filter(message => message.role === 'user').length}
      onActiveBlendChange={onActiveBlendChange}
      onSendMessage={onSendExerciseMessage}
      micMode={micMode}
    />
  ) : null

  return (
    <div
      className={mergeClasses(
        styles.stage,
        launching && styles.stageLaunching
      )}
    >
      <div className={styles.layout}>
        <div className={styles.heroColumn}>
          {isChildMode && scenario ? (
            <Card className={styles.scenarioCard}>
              <Text className={styles.scenarioTitle} size={700} weight="semibold" block>
                {scenario.name}
              </Text>
              <Text size={300} block className={styles.scenarioDescription}>
                {scenario.description || "Let's practice together."}
              </Text>
              <div className={styles.exerciseMeta}>
                {exerciseType ? (
                  <span className={styles.exerciseChip}>{exerciseType}</span>
                ) : null}
                {scenario.exerciseMetadata?.targetSound ? (
                  <PhonemeChip label="Sound" phoneme={scenario.exerciseMetadata.targetSound} />
                ) : null}
                {customScenario?.scenarioData.targetSound ? (
                  <PhonemeChip label="Sound" phoneme={customScenario.scenarioData.targetSound} />
                ) : null}
                {scenario.exerciseMetadata?.difficulty ? (
                  <span className={styles.exerciseChip}>
                    {scenario.exerciseMetadata.difficulty}
                  </span>
                ) : null}
                {customScenario?.scenarioData.difficulty ? (
                  <span className={styles.exerciseChip}>
                    {customScenario.scenarioData.difficulty}
                  </span>
                ) : null}
              </div>
            </Card>
          ) : null}

          <VideoPanel
            videoRef={videoRef}
            childName={selectedChild?.name}
            avatarValue={selectedAvatar}
            scenarioName={scenario?.name}
            scenarioDescription={scenario?.description}
            connectionState={connectionState}
            introPending={introPending}
            introComplete={introComplete}
            sessionFinished={sessionFinished}
            onVideoLoaded={onVideoLoaded}
            connectionMessage={connectionMessage}
            recording={recording}
            processing={scoringUtterance}
            onToggleRecording={onToggleRecording}
            canTalk={canTalk && !scoringUtterance}
            audience={isChildMode ? 'child' : 'therapist'}
            micRequired={micRequired}
            showMicDock={showMicDock}
            micMode={micMode}
          />

          {activityPanel}

          {isChildMode && !isListeningMinimalPairs && !isSilentSorting && !isAuditoryBombardment && !isWordPositionPractice && !isTwoWordPhrase ? (
            <ExerciseFeedback
              referenceText={activeReferenceText}
              feedback={utteranceFeedback}
              loading={scoringUtterance}
            />
          ) : null}
        </div>

        <div className={styles.sideColumn}>
          <ChatPanel
            messages={messages}
            recording={recording}
            connected={connected}
            connectionState={connectionState}
            connectionMessage={connectionMessage}
            introComplete={introComplete}
            sessionFinished={sessionFinished}
            processing={scoringUtterance}
            canAnalyze={canAnalyze}
            onToggleRecording={onToggleRecording}
            onClear={onClear}
            onAnalyze={onAnalyze}
            scenario={scenario}
            audience={isChildMode ? 'child' : 'therapist'}
            showAnalyzeControl={!isChildMode}
          />
        </div>
      </div>
    </div>
  )
}