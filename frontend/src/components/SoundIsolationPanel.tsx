/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text, makeStyles } from '@fluentui/react-components'
import { useState } from 'react'
import type { ExerciseMetadata } from '../types'
import type { MicMode } from '../utils/micMode'
import { ImageCard } from './ImageCard'
import { RepetitionCounter } from './RepetitionCounter'

const useStyles = makeStyles({
  card: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-sm)',
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
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.84rem',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)',
    gap: 'var(--space-md)',
    alignItems: 'center',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  cueText: {
    display: 'grid',
    gap: '8px',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
    marginTop: 'var(--space-xs)',
  },
  soundMark: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.4rem',
    fontWeight: '800',
    color: 'var(--color-primary-dark)',
  },
  actionButton: {
    minHeight: '40px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
})

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  attempts: number
  audience?: 'therapist' | 'child'
  onSendMessage?: (text: string) => void
  /** PR12b.3c — mic-mode preference. Accepted for future conversational-turn wiring; today prop-only. */
  micMode?: MicMode
}

export function SoundIsolationPanel({
  scenarioName,
  metadata,
  attempts,
  audience = 'child',
  onSendMessage,
  micMode: _micMode = 'tap',
}: Props) {
  const styles = useStyles()
  const [manualAttempts, setManualAttempts] = useState(0)
  const cueImage = metadata?.imageAssets?.[0]
  const targetSound = metadata?.targetSound || 'sound'
  const repetitionTarget = metadata?.repetitionTarget
  const cueWord = metadata?.targetWords?.[1] || metadata?.targetWords?.[0] || targetSound

  const handleSoundConfirmed = () => {
    setManualAttempts(current => current + 1)
    onSendMessage?.(`I said the ${cueWord} sound.`)
  }

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Sound practice'}</Text>
      <div className={styles.layout}>
        <ImageCard word={metadata?.targetWords?.[0] || targetSound} imagePath={cueImage} />
        <div className={styles.cueText}>
          <Text className={styles.soundMark}>/{targetSound}/</Text>
          <Text className={styles.body}>
            Watch the cue, listen to your buddy, and make the sound on its own.
            This step is about smooth, brave tries before moving into words.
          </Text>
          <RepetitionCounter
            current={attempts + manualAttempts}
            target={repetitionTarget}
            label="Brave sound tries"
          />
          {audience === 'child' ? (
            <div className={styles.actions}>
              <Button
                appearance="secondary"
                className={styles.actionButton}
                onClick={handleSoundConfirmed}
              >
                I made the sound
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}