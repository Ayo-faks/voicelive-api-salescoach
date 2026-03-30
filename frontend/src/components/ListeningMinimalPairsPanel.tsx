/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text, makeStyles } from '@fluentui/react-components'
import { SpeakerWaveIcon } from '@heroicons/react/24/outline'
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
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  feedback: {
    fontSize: '0.82rem',
    color: 'var(--color-text-secondary)',
  },
  speakButton: {
    minHeight: '40px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
})

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  audience?: 'therapist' | 'child'
}

export function ListeningMinimalPairsPanel({ scenarioName, metadata, audience = 'child' }: Props) {
  const styles = useStyles()
  const pairs = metadata?.pairs || []
  const [pairIndex, setPairIndex] = useState(0)
  const [promptWord, setPromptWord] = useState<string | null>(null)
  const [selectedWord, setSelectedWord] = useState<string | null>(null)

  const currentPair = pairs[pairIndex] || null
  const imageMap = useMemo(() => {
    const paths = metadata?.imageAssets || []
    const nextMap = new Map<string, string>()
    for (const path of paths) {
      const fileName = path.split('/').pop() || ''
      const stem = fileName.replace(/\.webp$/i, '')
      const word = stem.split('-').slice(2).join('-')
      if (word) {
        nextMap.set(word, path)
      }
    }
    return nextMap
  }, [metadata?.imageAssets])

  useEffect(() => {
    setSelectedWord(null)
    if (!currentPair) {
      setPromptWord(null)
      return
    }

    setPromptWord(Math.random() > 0.5 ? currentPair.word_a : currentPair.word_b)
  }, [currentPair])

  const speakPrompt = () => {
    if (!promptWord || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(promptWord)
    utterance.lang = metadata?.speechLanguage || 'en-US'
    utterance.rate = 0.85
    window.speechSynthesis.speak(utterance)
  }

  const handleSelect = (word: string) => setSelectedWord(word)
  const isCorrect = selectedWord && promptWord ? selectedWord === promptWord : null

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Listening practice'}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? 'Use the speaker button to model the target word, then have the child tap the matching picture.'
          : 'Tap the picture that matches the word you hear.'}
      </Text>
      <div className={styles.controls}>
        <Button
          appearance="primary"
          icon={<SpeakerWaveIcon className="w-5 h-5" />}
          className={styles.speakButton}
          onClick={speakPrompt}
          disabled={!promptWord}
        >
          Hear it
        </Button>
        <RepetitionCounter
          current={pairIndex + (selectedWord ? 1 : 0)}
          target={metadata?.repetitionTarget}
          label="Listening turns"
        />
      </div>
      {currentPair ? (
        <div className={styles.grid}>
          <ImageCard
            word={currentPair.word_a}
            imagePath={imageMap.get(currentPair.word_a)}
            selected={selectedWord === currentPair.word_a}
            onClick={() => handleSelect(currentPair.word_a)}
          />
          <ImageCard
            word={currentPair.word_b}
            imagePath={imageMap.get(currentPair.word_b)}
            selected={selectedWord === currentPair.word_b}
            onClick={() => handleSelect(currentPair.word_b)}
          />
        </div>
      ) : null}
      <Text className={styles.feedback}>
        {isCorrect === null
          ? audience === 'therapist' && promptWord
            ? `Prompt word: ${promptWord}`
            : 'Listen carefully, then tap one picture.'
          : isCorrect
            ? 'Nice listening. Move to the next pair when ready.'
            : `Try again and listen for ${audience === 'therapist' && promptWord ? promptWord : 'the target word'}.`}
      </Text>
      {currentPair && selectedWord ? (
        <Button
          appearance="secondary"
          onClick={() => setPairIndex(index => (index + 1) % pairs.length)}
        >
          Next pair
        </Button>
      ) : null}
    </Card>
  )
}