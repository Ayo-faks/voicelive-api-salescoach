/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Text, makeStyles } from '@fluentui/react-components'
import { useEffect, useMemo, useState } from 'react'
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
  homes: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  home: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px dashed rgba(13, 138, 132, 0.28)',
    backgroundColor: 'var(--color-primary-softer)',
    display: 'grid',
    gap: 'var(--space-sm)',
    minHeight: '220px',
    alignContent: 'start',
    '@media (max-width: 640px)': {
      minHeight: '180px',
    },
  },
  homeTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-primary-dark)',
    fontWeight: '700',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
    gap: 'var(--space-sm)',
    '@media (max-width: 640px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  pool: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
})

type Bucket = 'target' | 'error' | 'pool'

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  audience?: 'therapist' | 'child'
  onSendMessage?: (text: string) => void
}

export function SilentSortingPanel({ scenarioName, metadata, audience = 'child', onSendMessage }: Props) {
  const styles = useStyles()
  const targetSound = metadata?.targetSound || 'target'
  const errorSound = metadata?.errorSound || 'other'
  const words = metadata?.targetWords || []
  const imageMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const path of metadata?.imageAssets || []) {
      const fileName = path.split('/').pop() || ''
      const stem = fileName.replace(/\.webp$/i, '')
      const word = stem.split('-').slice(2).join('-')
      if (word) map.set(word, path)
    }
    return map
  }, [metadata?.imageAssets])

  const initialAssignments = useMemo(() => {
    return Object.fromEntries(words.map(word => [word, 'pool' as Bucket]))
  }, [words])
  const [assignments, setAssignments] = useState<Record<string, Bucket>>(initialAssignments)

  useEffect(() => {
    setAssignments(initialAssignments)
  }, [initialAssignments])

  const moveWord = (word: string, nextBucket: Bucket) => {
    setAssignments(current => ({ ...current, [word]: nextBucket }))
    const bucketLabel = nextBucket === 'target'
      ? `${targetSound.toUpperCase()} home`
      : nextBucket === 'error'
        ? `${errorSound.toUpperCase()} home`
        : 'cards to sort'
    onSendMessage?.(`I sorted ${word} into the ${bucketLabel}.`)
  }

  const poolWords = words.filter(word => assignments[word] === 'pool')
  const targetWords = words.filter((_, index) => assignments[words[index]] === 'target')
  const errorWords = words.filter((_, index) => assignments[words[index]] === 'error')

  const renderWordCard = (word: string, bucket: Bucket) => (
    <ImageCard
      key={`${bucket}-${word}`}
      word={word}
      imagePath={imageMap.get(word)}
      onClick={() => moveWord(word, bucket === 'pool' ? 'target' : bucket === 'target' ? 'error' : 'pool')}
    />
  )

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Silent sorting'}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? 'Help the child sort each picture into the right sound home without saying the word first.'
          : 'Tap the cards to sort them into the right sound home. Try to think about the first sound quietly.'}
      </Text>
      <RepetitionCounter
        current={targetWords.length + errorWords.length}
        target={words.length}
        label="Cards sorted"
      />
      <div className={styles.homes}>
        <div className={styles.home}>
          <Text className={styles.homeTitle}>/{targetSound}/ home</Text>
          <Badge appearance="filled">Target sound</Badge>
          <div className={styles.cards}>{targetWords.map(word => renderWordCard(word, 'target'))}</div>
        </div>
        <div className={styles.home}>
          <Text className={styles.homeTitle}>/{errorSound}/ home</Text>
          <Badge appearance="filled">Comparison sound</Badge>
          <div className={styles.cards}>{errorWords.map(word => renderWordCard(word, 'error'))}</div>
        </div>
      </div>
      <div className={styles.pool}>
        <Text className={styles.homeTitle}>Cards to sort</Text>
        <div className={styles.cards}>{poolWords.map(word => renderWordCard(word, 'pool'))}</div>
      </div>
      <div className={styles.actions}>
        <Button appearance="secondary" onClick={() => setAssignments(initialAssignments)}>
          Reset sorting
        </Button>
      </div>
    </Card>
  )
}