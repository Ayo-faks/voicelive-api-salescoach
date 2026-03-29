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
import { useState } from 'react'
import type React from 'react'
import type {
  ChildProfile,
  CustomScenario,
  Message,
  PronunciationAssessment,
  Scenario,
} from '../types'
import { ChatPanel } from './ChatPanel'
import { ExerciseFeedback } from './ExerciseFeedback'
import { VideoPanel } from './VideoPanel'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 0fr',
    gap: 'var(--space-xl)',
    alignItems: 'start',
    transition: 'grid-template-columns 520ms cubic-bezier(0.22, 1, 0.36, 1), gap 520ms cubic-bezier(0.22, 1, 0.36, 1)',
    overflow: 'hidden',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  layoutRevealed: {
    gridTemplateColumns: 'minmax(0, 1.45fr) minmax(340px, 0.62fr)',
    '@media (max-width: 1240px)': {
      gridTemplateColumns: 'minmax(0, 1.18fr) minmax(320px, 0.82fr)',
    },
    '@media (max-width: 980px)': {
      gridTemplateColumns: '1fr',
      gap: 'var(--space-lg)',
    },
  },
  heroColumn: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
    maxWidth: '960px',
    width: '100%',
    justifySelf: 'center',
    transition: 'max-width 520ms cubic-bezier(0.22, 1, 0.36, 1), transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  heroColumnRevealed: {
    maxWidth: '100%',
    justifySelf: 'stretch',
  },
  sideColumn: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
    opacity: 0,
    transform: 'translateX(40px)',
    pointerEvents: 'none',
    maxWidth: 0,
    overflow: 'hidden',
    transition:
      'opacity 320ms ease-out 140ms, transform 420ms cubic-bezier(0.22, 1, 0.36, 1) 120ms, max-width 420ms cubic-bezier(0.22, 1, 0.36, 1) 120ms',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  sideColumnRevealed: {
    opacity: 1,
    transform: 'translateX(0)',
    pointerEvents: 'auto',
    maxWidth: '100%',
  },
  scenarioCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
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
  coachCard: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-md)',
  },
  coachTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    marginBottom: 'var(--space-xs)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  coachText: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.8125rem',
  },
})

interface SessionScreenProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  messages: Message[]
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

export function SessionScreen({
  videoRef,
  messages,
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
}: SessionScreenProps) {
  const styles = useStyles()
  const [transcriptRevealed, setTranscriptRevealed] = useState(false)
  const customScenario = isCustomScenario(scenario) ? scenario : null
  const canTalk = connected && introComplete && !sessionFinished
  const exerciseType = formatExerciseType(
    customScenario?.scenarioData.exerciseType || scenario?.exerciseMetadata?.type
  )
  const handleToggleRecording = () => {
    if (sessionFinished) {
      return
    }

    if (!transcriptRevealed) {
      setTranscriptRevealed(true)
    }

    onToggleRecording()
  }

  return (
    <div
      className={mergeClasses(
        styles.layout,
        transcriptRevealed && styles.layoutRevealed
      )}
    >
      <div
        className={mergeClasses(
          styles.heroColumn,
          transcriptRevealed && styles.heroColumnRevealed
        )}
      >
        {scenario ? (
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
                <span className={styles.exerciseChip}>
                  Sound: {scenario.exerciseMetadata.targetSound}
                </span>
              ) : null}
              {customScenario?.scenarioData.targetSound ? (
                <span className={styles.exerciseChip}>
                  Sound: {customScenario.scenarioData.targetSound}
                </span>
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
          onToggleRecording={handleToggleRecording}
          canTalk={canTalk && !scoringUtterance}
          audience={isChildMode ? 'child' : 'therapist'}
        />

        {isChildMode ? (
          <ExerciseFeedback
            referenceText={activeReferenceText}
            feedback={utteranceFeedback}
            loading={scoringUtterance}
          />
        ) : null}
      </div>

      <div
        className={mergeClasses(
          styles.sideColumn,
          transcriptRevealed && styles.sideColumnRevealed
        )}
        aria-hidden={!transcriptRevealed}
      >
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
          onToggleRecording={handleToggleRecording}
          onClear={onClear}
          onAnalyze={onAnalyze}
          scenario={scenario}
          audience={isChildMode ? 'child' : 'therapist'}
          showAnalyzeControl={!isChildMode}
          compact
        />

        {!isChildMode ? (
          <Card className={styles.coachCard}>
            <Text className={styles.coachTitle} size={500} weight="semibold">
              Therapist view
            </Text>
            <Text className={styles.coachText} size={300}>
              Stay nearby while the child practises. Practice feedback supports
              the session and does not replace clinical judgement for {selectedChild?.name || 'this child'}.
            </Text>
          </Card>
        ) : null}
      </div>
    </div>
  )
}