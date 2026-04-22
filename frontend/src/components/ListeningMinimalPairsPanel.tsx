/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text, makeStyles } from '@fluentui/react-components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExerciseMetadata } from '../types'
import { api } from '../services/api'
import { getDrillWordIpa } from '../utils/drillTokens'
import { ImageCard } from './ImageCard'
import { RepetitionCounter } from './RepetitionCounter'

type TurnPhase = 'waiting' | 'instructing' | 'awaiting' | 'evaluating' | 'completed'

// After this many consecutive wrong taps on the same pair, the avatar reveals
// the target, counts the turn as attempted, and advances to the next pair.
// Without this cap, a child who keeps tapping the distractor triggers an
// endless retry loop (the bug that motivated this fix).
const MAX_RETRIES_PER_PAIR = 2

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
  actionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--space-sm)',
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
  readyToStart?: boolean
  onSendMessage?: (text: string) => void
  onSpeakExerciseText?: (text: string) => Promise<void>
  onRecordExerciseSelection?: (text: string) => void
  onInterruptAvatar?: () => void
  onCompleteSession?: () => void
}

export function ListeningMinimalPairsPanel({
  scenarioName,
  metadata,
  audience = 'child',
  readyToStart = false,
  onSendMessage,
  onSpeakExerciseText,
  onRecordExerciseSelection,
  onInterruptAvatar,
  onCompleteSession,
}: Props) {
  const styles = useStyles()
  const pairs = metadata?.pairs || []
  const repetitionTarget = metadata?.repetitionTarget ?? pairs.length
  const targetSound = metadata?.targetSound || 'target'
  const errorSound = metadata?.errorSound || 'other'
  const [pairIndex, setPairIndex] = useState(0)
  const [completedTurns, setCompletedTurns] = useState(0)
  const [promptWord, setPromptWord] = useState<string | null>(null)
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [phase, setPhase] = useState<TurnPhase>(pairs.length > 0 ? 'waiting' : 'completed')
  const [statusText, setStatusText] = useState('Your buddy will give the clue first.')
  const turnSequenceRef = useRef(0)
  const completionNotifiedRef = useRef(false)
  // Tracks wrong-tap count within the current pair's current prompt word.
  // Reset when the pair advances or when a new prompt word is chosen.
  const retryCountRef = useRef(0)

  const currentPair = pairs[pairIndex] || null
  const canSkipPair = audience === 'therapist' && Boolean(currentPair) && phase === 'awaiting'
  const pairSignature = useMemo(
    () => pairs.map(pair => `${pair.word_a}:${pair.word_b}`).join('|'),
    [pairs]
  )
  const resetKey = useMemo(
    () => `${pairSignature}|${repetitionTarget}|${targetSound}|${errorSound}`,
    [errorSound, pairSignature, repetitionTarget, targetSound]
  )
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
    void resetKey
    turnSequenceRef.current += 1
    completionNotifiedRef.current = false
    retryCountRef.current = 0
    setPairIndex(0)
    setCompletedTurns(0)
    setPromptWord(null)
    setSelectedWord(null)
    setPhase(pairs.length > 0 ? 'waiting' : 'completed')
    setStatusText(pairs.length > 0 ? 'Your buddy will give the clue first.' : 'No listening pairs are available yet.')
  }, [pairs.length, resetKey])

  const notifySessionCompletion = useCallback(() => {
    if (completionNotifiedRef.current) {
      return
    }

    completionNotifiedRef.current = true
    onCompleteSession?.()
  }, [onCompleteSession])

  // Synthesize `word` through the REST /api/tts endpoint. When we have a
  // verified IPA pronunciation (see DRILL_WORD_IPA), send phoneme mode so
  // Azure Speech's SSML + custom-lexicon pipeline clamps the pronunciation
  // (/fɪn/ instead of /faɪn/). Falls back to plain text otherwise. Returns
  // the base64-encoded MP3 payload.
  const synthesizeWord = useCallback(async (word: string): Promise<string> => {
    const ipa = getDrillWordIpa(word)
    if (ipa) {
      return api.synthesizeSpeech({
        phoneme: ipa,
        alphabet: 'ipa',
        fallback_text: word,
      })
    }
    return api.synthesizeSpeech(word)
  }, [])

  const speakWord = useCallback(async (word: string) => {
    try {
      const audioB64 = await synthesizeWord(word)
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
  }, [metadata?.speechLanguage, synthesizeWord])

  const audioCache = useRef<Map<string, string>>(new Map())

  // Pre-fetch audio for current pair words
  useEffect(() => {
    if (!currentPair) return
    for (const w of [currentPair.word_a, currentPair.word_b]) {
      if (!audioCache.current.has(w)) {
        synthesizeWord(w).then(b64 => audioCache.current.set(w, b64)).catch(() => {})
      }
    }
  }, [currentPair, synthesizeWord])

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

  const speakExerciseText = useCallback(async (text: string) => {
    if (onSpeakExerciseText) {
      await onSpeakExerciseText(text)
    }
  }, [onSpeakExerciseText])

  const buildInstruction = useCallback((word: string, pair = currentPair) => {
    void pair
    return `Listen carefully. The word is ${word}. Tap the matching picture.`
  }, [currentPair])

  const buildPraiseText = useCallback((word: string) => {
    void word
    return 'Good listening.'
  }, [])

  const buildRetryText = useCallback((word: string, pair = currentPair) => {
    if (!pair) {
      return `Let's listen again. The word is ${word}.`
    }

    const comparisonWord = word === pair.word_a ? pair.word_b : pair.word_a
    return `Let's listen again. The word is ${word}. Was it ${word} or ${comparisonWord}?`
  }, [currentPair])

  const buildRevealText = useCallback((word: string) => {
    return `The word is ${word}. Let's try a new one.`
  }, [])

  const beginInstructionTurn = useCallback(async (nextPromptWord?: string) => {
    if (!currentPair || !readyToStart) {
      return
    }

    const turnSequence = ++turnSequenceRef.current
    const resolvedPromptWord = nextPromptWord ?? (Math.random() > 0.5 ? currentPair.word_a : currentPair.word_b)

    setPromptWord(resolvedPromptWord)
    setSelectedWord(null)
    setPhase('instructing')
    setStatusText(`Listen for ${resolvedPromptWord}.`)

    await speakExerciseText(buildInstruction(resolvedPromptWord, currentPair))

    if (turnSequenceRef.current !== turnSequence) {
      return
    }

    setPhase('awaiting')
    setStatusText('Tap the picture that matches the word.')
  }, [buildInstruction, currentPair, readyToStart, speakExerciseText])

  useEffect(() => {
    if (!readyToStart) {
      turnSequenceRef.current += 1
      if (phase !== 'completed') {
        setPhase('waiting')
        setStatusText('Your buddy will give the clue first.')
      }
      return
    }

    if (!currentPair) {
      setPhase('completed')
      setStatusText('No listening pairs are available yet.')
      return
    }

    if (repetitionTarget > 0 && completedTurns >= repetitionTarget) {
      setPhase('completed')
      setStatusText('Practice set complete.')
      notifySessionCompletion()
      return
    }

    if (phase === 'waiting') {
      void beginInstructionTurn(promptWord ?? undefined)
    }
  }, [beginInstructionTurn, completedTurns, currentPair, notifySessionCompletion, phase, promptWord, readyToStart, repetitionTarget])

  const handleSelect = useCallback((word: string) => {
    if (!currentPair || !promptWord || phase !== 'awaiting') {
      return
    }

    const turnSequence = ++turnSequenceRef.current
    const isCorrectSelection = word === promptWord

    setSelectedWord(word)
    setPhase('evaluating')

    void (async () => {
      await playWord(word)
      onRecordExerciseSelection?.(`I picked ${word}.`)

      if (turnSequenceRef.current !== turnSequence) {
        return
      }

      if (isCorrectSelection) {
        const praiseText = buildPraiseText(promptWord)
        // UI shows the plain English word; the spoken channel still gets the
        // drill-token sentinel so the TTS / lexicon path can pronounce it.
        setStatusText(`Great listening — you picked “${promptWord}”!`)
        await speakExerciseText(praiseText)

        if (turnSequenceRef.current !== turnSequence) {
          return
        }

        const nextCompletedTurns = completedTurns + 1
        setCompletedTurns(nextCompletedTurns)
        retryCountRef.current = 0

        if (repetitionTarget > 0 && nextCompletedTurns >= repetitionTarget) {
          setPhase('completed')
          setStatusText('Practice set complete.')
          notifySessionCompletion()
          return
        }

        setPromptWord(null)
        setSelectedWord(null)
        setPhase('waiting')
        setStatusText('Your buddy will give the clue first.')
        setPairIndex(index => (index + 1) % pairs.length)
        return
      }

      // Wrong answer: cap retries so the avatar doesn't loop forever when a
      // child keeps tapping the distractor. After MAX_RETRIES_PER_PAIR wrong
      // taps on the same prompt, reveal the target and advance to the next
      // pair (counting the turn as attempted so the repetition target still
      // progresses).
      retryCountRef.current += 1

      if (retryCountRef.current > MAX_RETRIES_PER_PAIR) {
        const revealText = buildRevealText(promptWord)
        setStatusText(`The word was “${promptWord}”. Let's try a new one.`)
        await speakExerciseText(revealText)

        if (turnSequenceRef.current !== turnSequence) {
          return
        }

        const nextCompletedTurns = completedTurns + 1
        setCompletedTurns(nextCompletedTurns)
        retryCountRef.current = 0

        if (repetitionTarget > 0 && nextCompletedTurns >= repetitionTarget) {
          setPhase('completed')
          setStatusText('Practice set complete.')
          notifySessionCompletion()
          return
        }

        setPromptWord(null)
        setSelectedWord(null)
        setPhase('waiting')
        setStatusText('Your buddy will give the clue first.')
        setPairIndex(index => (index + 1) % pairs.length)
        return
      }

      const retryText = buildRetryText(promptWord, currentPair)
      // UI keeps the status line short and sentinel-free; the avatar still
      // speaks the full retry prompt (with emphasised target + contrast).
      setStatusText('Not quite — let\'s listen again.')
      await speakExerciseText(retryText)

      if (turnSequenceRef.current !== turnSequence) {
        return
      }

      await beginInstructionTurn(promptWord)
    })()
  }, [beginInstructionTurn, buildPraiseText, buildRetryText, buildRevealText, completedTurns, currentPair, notifySessionCompletion, pairs.length, phase, playWord, promptWord, repetitionTarget, speakExerciseText, onRecordExerciseSelection])

  const handleSkipPair = useCallback(() => {
    if (!pairs.length || phase !== 'awaiting') {
      return
    }

    turnSequenceRef.current += 1
    retryCountRef.current = 0
    onInterruptAvatar?.()
    setPromptWord(null)
    setSelectedWord(null)
    setPhase('waiting')
    setStatusText('Your buddy will give the clue first.')
    setPairIndex(index => (index + 1) % pairs.length)
  }, [onInterruptAvatar, pairs.length, phase])

  const tapsDisabled = !readyToStart || phase !== 'awaiting'

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Listening practice'}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? 'The buddy gives the full clue first. The child answers with one tap and retries on wrong answers.'
          : 'Listen to your buddy, then tap one picture.'}
      </Text>
      <div className={styles.controls}>
        <RepetitionCounter
          current={completedTurns}
          target={repetitionTarget}
          label="Listening turns"
        />
      </div>
      {currentPair ? (
        <div className={styles.grid}>
          <ImageCard
            word={currentPair.word_a}
            imagePath={imageMap.get(currentPair.word_a)}
            selected={selectedWord === currentPair.word_a}
            disabled={tapsDisabled}
            onClick={() => handleSelect(currentPair.word_a)}
          />
          <ImageCard
            word={currentPair.word_b}
            imagePath={imageMap.get(currentPair.word_b)}
            selected={selectedWord === currentPair.word_b}
            disabled={tapsDisabled}
            onClick={() => handleSelect(currentPair.word_b)}
          />
        </div>
      ) : null}
      <Text className={styles.feedback}>{statusText}</Text>
      {canSkipPair ? (
        <div className={styles.actionRow}>
          <Button
            appearance="secondary"
            className={styles.speakButton}
            onClick={handleSkipPair}
          >
            Skip pair
          </Button>
        </div>
      ) : null}
    </Card>
  )
}