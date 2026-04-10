/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text, makeStyles } from '@fluentui/react-components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExerciseMetadata } from '../types'
import { api } from '../services/api'
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
  onSendMessage?: (text: string) => void
  onInterruptAvatar?: () => void
}

export function ListeningMinimalPairsPanel({
  scenarioName,
  metadata,
  audience = 'child',
  onSendMessage,
  onInterruptAvatar,
}: Props) {
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

  const speakWord = useCallback(async (word: string) => {
    try {
      const audioB64 = await api.synthesizeSpeech(word)
      const bytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener('ended', () => URL.revokeObjectURL(url))
      await audio.play()
    } catch {
      // Fallback to browser TTS if Azure fails
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(word)
        utterance.lang = metadata?.speechLanguage || 'en-US'
        utterance.rate = 0.85
        window.speechSynthesis.speak(utterance)
      }
    }
  }, [metadata?.speechLanguage])

  const audioCache = useRef<Map<string, string>>(new Map())

  // Pre-fetch audio for current pair words
  useEffect(() => {
    if (!currentPair) return
    for (const w of [currentPair.word_a, currentPair.word_b]) {
      if (!audioCache.current.has(w)) {
        api.synthesizeSpeech(w).then(b64 => audioCache.current.set(w, b64)).catch(() => {})
      }
    }
  }, [currentPair])

  const playWord = useCallback(async (word: string) => {
    const cached = audioCache.current.get(word)
    if (cached) {
      const bytes = Uint8Array.from(atob(cached), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener('ended', () => URL.revokeObjectURL(url))
      await audio.play()
    } else {
      await speakWord(word)
    }
  }, [speakWord])

  const handleSelect = (word: string) => {
    const isCorrectSelection = promptWord ? word === promptWord : null
    onInterruptAvatar?.()
    setSelectedWord(word)
    void playWord(word)
    if (isCorrectSelection === null) {
      onSendMessage?.(`I picked ${word}.`)
      return
    }

    onSendMessage?.(
      isCorrectSelection
        ? `I picked ${word}. That's the right answer!`
        : `I picked ${word}. The correct answer was ${promptWord}.`
    )
  }
  const isCorrect = selectedWord && promptWord ? selectedWord === promptWord : null

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Listening practice'}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? 'Have the child tap a picture to hear the word, then tap the one that matches the target sound.'
          : 'Tap a picture to hear the word.'}
      </Text>
      <div className={styles.controls}>
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