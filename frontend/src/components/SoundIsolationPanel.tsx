/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, Text, makeStyles } from '@fluentui/react-components'
import type { ExerciseMetadata } from '../types'
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
    color: 'var(--color-text-primary)',
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
  soundMark: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.4rem',
    fontWeight: '800',
    color: 'var(--color-primary-dark)',
  },
})

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  attempts: number
}

export function SoundIsolationPanel({ scenarioName, metadata, attempts }: Props) {
  const styles = useStyles()
  const cueImage = metadata?.imageAssets?.[0]
  const targetSound = metadata?.targetSound || 'sound'
  const repetitionTarget = metadata?.repetitionTarget

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
            current={attempts}
            target={repetitionTarget}
            label="Brave sound tries"
          />
        </div>
      </div>
    </Card>
  )
}