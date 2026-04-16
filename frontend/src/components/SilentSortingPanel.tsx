/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Button,
  Card,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ExerciseMetadata } from '../types'
import { getDrillModelToken } from '../utils/drillTokens'
import { ImageCard } from './ImageCard'
import { RepetitionCounter } from './RepetitionCounter'

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
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.84rem',
  },
  previewRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
  },
  previewButton: {
    minHeight: '38px',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
  statePanel: {
    display: 'grid',
    gap: 'var(--space-xs)',
    padding: 'var(--space-sm)',
    borderRadius: '0px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(242, 233, 216, 0.56)',
  },
  stateLabel: {
    fontSize: '0.78rem',
    color: 'var(--color-text-secondary)',
    fontWeight: '600',
  },
  stateValue: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontWeight: '700',
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
    borderRadius: '0px',
    border: '1px solid rgba(15, 42, 58, 0.16)',
    backgroundColor: 'rgba(250, 246, 239, 0.92)',
    display: 'grid',
    gap: 'var(--space-sm)',
    minHeight: '220px',
    alignContent: 'start',
    '@media (max-width: 640px)': {
      minHeight: '180px',
    },
  },
  targetHome: {
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
    border: '1px solid rgba(13, 138, 132, 0.28)',
  },
  errorHome: {
    backgroundColor: 'rgba(242, 233, 216, 0.92)',
    border: '1px solid rgba(90, 106, 111, 0.28)',
  },
  poolHome: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    border: '1px dashed rgba(15, 42, 58, 0.16)',
  },
  activeHome: {
    outline: '2px solid var(--color-primary)',
    outlineOffset: '4px',
  },
  overHome: {
    border: '1px solid var(--color-primary)',
    backgroundColor: 'rgba(13, 138, 132, 0.14)',
  },
  homeHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  homeToggle: {
    borderRadius: '0px',
    minHeight: '36px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
  homeMeta: {
    fontSize: '0.76rem',
    color: 'var(--color-text-secondary)',
    fontWeight: '600',
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
  cardShell: {
    touchAction: 'none',
  },
  draggingCard: {
    opacity: 0.72,
  },
  pool: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  feedback: {
    padding: 'var(--space-sm)',
    borderRadius: '0px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    fontSize: '0.82rem',
    lineHeight: 1.55,
    color: 'var(--color-text-secondary)',
  },
  feedbackSuccess: {
    border: '1px solid rgba(13, 138, 132, 0.34)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
    color: 'var(--color-primary-dark)',
  },
  feedbackWarning: {
    border: '1px solid rgba(212, 168, 67, 0.4)',
    backgroundColor: 'rgba(242, 233, 216, 0.92)',
    color: '#7a5a12',
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  resetButton: {
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
})

type Bucket = 'target' | 'error' | 'pool'

type MoveOutcome = 'correct' | 'incorrect' | 'returned'

interface LastMove {
  word: string
  expectedBucket: Bucket
  attemptedBucket: Bucket
  outcome: MoveOutcome
}

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  audience?: 'therapist' | 'child'
  readyToStart?: boolean
  onSendMessage?: (text: string) => void
  onSpeakExerciseText?: (text: string) => Promise<void>
}

function getIsMobileSortingMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 640px)').matches
}

export function SilentSortingPanel({
  scenarioName,
  metadata,
  audience = 'child',
  readyToStart = true,
  onSendMessage,
  onSpeakExerciseText,
}: Props) {
  const styles = useStyles()
  const targetSound = metadata?.targetSound || 'target'
  const errorSound = metadata?.errorSound || 'other'
  const words = metadata?.targetWords || []
  const [mobileFallback, setMobileFallback] = useState(() => getIsMobileSortingMode())
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  )
  const wordAssetMap = useMemo(() => {
    const map = new Map<string, { imagePath?: string; sound: string }>()
    for (const path of metadata?.imageAssets || []) {
      const fileName = path.split('/').pop() || ''
      const stem = fileName.replace(/\.webp$/i, '')
      const word = stem.split('-').slice(2).join('-')
      const sound = path.split('/')[1] || ''
      if (word) map.set(word, { imagePath: path, sound: sound.toLowerCase() })
    }

    for (const word of words) {
      if (!map.has(word)) {
        map.set(word, { sound: '' })
      }
    }

    return map
  }, [metadata?.imageAssets, words])

  const initialAssignments = useMemo(() => {
    return Object.fromEntries(words.map(word => [word, 'pool' as Bucket]))
  }, [words])
  const [assignments, setAssignments] = useState<Record<string, Bucket>>(initialAssignments)
  const [armedBucket, setArmedBucket] = useState<Bucket | null>(null)
  const [lastMove, setLastMove] = useState<LastMove | null>(null)

  const getExpectedBucket = useCallback((word: string): Bucket => {
    const sound = wordAssetMap.get(word)?.sound || ''

    if (sound === targetSound.toLowerCase()) {
      return 'target'
    }

    if (sound === errorSound.toLowerCase()) {
      return 'error'
    }

    return 'pool'
  }, [errorSound, targetSound, wordAssetMap])

  const getPreviewWordForBucket = useCallback((bucket: 'target' | 'error'): string | null => {
    const preferredWord = bucket === 'target'
      ? targetSound.toLowerCase() === 'th' && words.includes('thumb')
        ? 'thumb'
        : null
      : errorSound.toLowerCase() === 'f' && words.includes('fin')
        ? 'fin'
        : null

    if (preferredWord) {
      return preferredWord
    }

    return words.find(word => getExpectedBucket(word) === bucket) || null
  }, [errorSound, getExpectedBucket, targetSound, words])

  const targetPreviewWord = getPreviewWordForBucket('target')
  const errorPreviewWord = getPreviewWordForBucket('error')

  const getBucketLabel = useCallback((bucket: Bucket): string => {
    if (bucket === 'target') {
      return `${targetSound.toUpperCase()} home`
    }

    if (bucket === 'error') {
      return `${errorSound.toUpperCase()} home`
    }

    return 'Cards to sort'
  }, [errorSound, targetSound])

  const getNarratedBucketLabel = useCallback((bucket: Bucket): string => {
    if (bucket === 'target') {
      return `${targetPreviewWord || targetSound} sound home`
    }

    if (bucket === 'error') {
      return `${errorPreviewWord || errorSound} sound home`
    }

    return 'cards to sort'
  }, [errorPreviewWord, errorSound, targetPreviewWord, targetSound])

  const dragEnabled = readyToStart && !mobileFallback

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const coarseQuery = window.matchMedia('(pointer: coarse)')
    const compactWidthQuery = window.matchMedia('(max-width: 640px)')
    const updateMode = () => setMobileFallback(coarseQuery.matches || compactWidthQuery.matches)

    updateMode()
    coarseQuery.addEventListener?.('change', updateMode)
    compactWidthQuery.addEventListener?.('change', updateMode)

    return () => {
      coarseQuery.removeEventListener?.('change', updateMode)
      compactWidthQuery.removeEventListener?.('change', updateMode)
    }
  }, [])

  useEffect(() => {
    setAssignments(initialAssignments)
    setArmedBucket(null)
    setLastMove(null)
  }, [initialAssignments])

  const attemptMoveWord = useCallback((word: string, nextBucket: Bucket) => {
    if (!readyToStart) {
      return
    }

    const currentBucket = assignments[word] || 'pool'
    if (currentBucket === nextBucket) {
      return
    }

    const expectedBucket = getExpectedBucket(word)

    if (nextBucket === 'pool') {
      setAssignments(current => ({ ...current, [word]: 'pool' }))
      setLastMove({ word, expectedBucket, attemptedBucket: nextBucket, outcome: 'returned' })
      return
    }

    if (expectedBucket === nextBucket) {
      setAssignments(current => ({ ...current, [word]: nextBucket }))
      setLastMove({ word, expectedBucket, attemptedBucket: nextBucket, outcome: 'correct' })
      onSendMessage?.(`I sorted ${word} into the ${getNarratedBucketLabel(nextBucket)}.`)
      return
    }

    setLastMove({ word, expectedBucket, attemptedBucket: nextBucket, outcome: 'incorrect' })
    onSendMessage?.(`I tried to sort ${word} into the ${getNarratedBucketLabel(nextBucket)}.`)
  }, [assignments, getExpectedBucket, getNarratedBucketLabel, onSendMessage, readyToStart])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const word = event.active.data.current?.word as string | undefined
    const overId = typeof event.over?.id === 'string' ? event.over.id : undefined

    if (!word || !overId?.startsWith('bucket:')) {
      return
    }

    const nextBucket = overId.replace('bucket:', '') as Bucket
    attemptMoveWord(word, nextBucket)
  }, [attemptMoveWord])

  const handlePreviewSound = useCallback(async (bucket: 'target' | 'error') => {
    if (!readyToStart || !onSpeakExerciseText) {
      return
    }

    const previewWord = bucket === 'target' ? targetPreviewWord : errorPreviewWord
    if (!previewWord) {
      return
    }

    await onSpeakExerciseText(`${getDrillModelToken(previewWord)}.`)
  }, [errorPreviewWord, onSpeakExerciseText, readyToStart, targetPreviewWord])

  const handleCardTap = useCallback((word: string) => {
    if (!readyToStart) {
      return
    }

    if (!mobileFallback) {
      return
    }

    if (!armedBucket) {
      setLastMove({
        word,
        expectedBucket: getExpectedBucket(word),
        attemptedBucket: 'pool',
        outcome: 'incorrect',
      })
      return
    }

    attemptMoveWord(word, armedBucket)
  }, [armedBucket, attemptMoveWord, getExpectedBucket, mobileFallback, readyToStart])

  const poolWords = words.filter(word => assignments[word] === 'pool')
  const targetWords = words.filter((_, index) => assignments[words[index]] === 'target')
  const errorWords = words.filter((_, index) => assignments[words[index]] === 'error')

  const sortingModeText = !readyToStart
    ? 'Your buddy will start the sorting turn first.'
    : mobileFallback
      ? 'Tap a sound home, then tap a card.'
      : 'Drag each card into the right sound home.'

  const feedbackText = lastMove
    ? lastMove.outcome === 'correct'
      ? audience === 'therapist'
        ? `${lastMove.word} -> ${getBucketLabel(lastMove.attemptedBucket)} (correct).`
        : `${lastMove.word} goes in the ${getBucketLabel(lastMove.attemptedBucket)}.`
      : lastMove.outcome === 'returned'
        ? audience === 'therapist'
          ? `${lastMove.word} moved back to cards to sort.`
          : `${lastMove.word} is back in the cards to sort.`
        : audience === 'therapist'
          ? `${lastMove.word} -> ${getBucketLabel(lastMove.attemptedBucket)} (retry). Expected ${getBucketLabel(lastMove.expectedBucket)}.`
          : lastMove.attemptedBucket === 'pool'
            ? 'Choose a sound home first, then tap the card.'
            : `Try again. ${lastMove.word} does not go in the ${getBucketLabel(lastMove.attemptedBucket)}.`
    : sortingModeText

  const feedbackTone = lastMove?.outcome === 'correct'
    ? 'success'
    : lastMove?.outcome === 'incorrect'
      ? 'warning'
      : 'neutral'

  const renderWordCard = (word: string) => (
    <SortingWordCard
      key={`${assignments[word]}-${word}`}
      word={word}
      imagePath={wordAssetMap.get(word)?.imagePath}
      dragEnabled={dragEnabled}
      onClick={mobileFallback ? () => handleCardTap(word) : undefined}
    />
  )

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Silent sorting'}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? 'Guide the child to place each picture into the TH or F home without saying the word first.'
          : 'Listen first, then sort each picture into the right sound home.'}
      </Text>
      <div className={styles.previewRow}>
        <Button
          appearance="secondary"
          className={styles.previewButton}
          disabled={!readyToStart || !onSpeakExerciseText || !targetPreviewWord}
          onClick={() => void handlePreviewSound('target')}
        >
          Hear {targetSound.toUpperCase()}
        </Button>
        <Button
          appearance="secondary"
          className={styles.previewButton}
          disabled={!readyToStart || !onSpeakExerciseText || !errorPreviewWord}
          onClick={() => void handlePreviewSound('error')}
        >
          Hear {errorSound.toUpperCase()}
        </Button>
      </div>
      <div className={styles.statePanel}>
        <Text className={styles.stateLabel}>Sorting mode</Text>
        <Text className={styles.stateValue}>{sortingModeText}</Text>
        <Text className={styles.stateLabel}>Active sound home</Text>
        <Text className={styles.stateValue}>{armedBucket ? getBucketLabel(armedBucket) : 'None selected'}</Text>
      </div>
      <RepetitionCounter
        current={targetWords.length + errorWords.length}
        target={words.length}
        label="Cards sorted"
      />
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className={styles.homes}>
          <SortingDropZone
            bucket="target"
            title={`${targetSound.toUpperCase()} home`}
            hint={targetPreviewWord ? `Try cards like ${targetPreviewWord}.` : 'Target sound'}
            badgeLabel="Target sound"
            active={armedBucket === 'target'}
            dropEnabled={dragEnabled}
            variant="target"
            onArmBucket={() => setArmedBucket('target')}
          >
            {targetWords.map(word => renderWordCard(word))}
          </SortingDropZone>
          <SortingDropZone
            bucket="error"
            title={`${errorSound.toUpperCase()} home`}
            hint={errorPreviewWord ? `Try cards like ${errorPreviewWord}.` : 'Comparison sound'}
            badgeLabel="Comparison sound"
            active={armedBucket === 'error'}
            dropEnabled={dragEnabled}
            variant="error"
            onArmBucket={() => setArmedBucket('error')}
          >
            {errorWords.map(word => renderWordCard(word))}
          </SortingDropZone>
        </div>
        <div className={styles.pool}>
          <SortingDropZone
            bucket="pool"
            title="Cards to sort"
            hint="Move a card back here to try again later."
            badgeLabel="Unsorted"
            active={armedBucket === 'pool'}
            dropEnabled={dragEnabled}
            variant="pool"
            onArmBucket={() => setArmedBucket('pool')}
          >
            {poolWords.map(word => renderWordCard(word))}
          </SortingDropZone>
        </div>
      </DndContext>
      <Text
        className={mergeClasses(
          styles.feedback,
          feedbackTone === 'success' && styles.feedbackSuccess,
          feedbackTone === 'warning' && styles.feedbackWarning,
        )}
      >
        {feedbackText}
      </Text>
      <div className={styles.actions}>
        <Button className={styles.resetButton} appearance="secondary" onClick={() => {
          setAssignments(initialAssignments)
          setArmedBucket(null)
          setLastMove(null)
        }}>
          Reset sorting
        </Button>
      </div>
    </Card>
  )
}

interface SortingWordCardProps {
  word: string
  imagePath?: string
  dragEnabled: boolean
  onClick?: () => void
}

function SortingWordCard({ word, imagePath, dragEnabled, onClick }: SortingWordCardProps) {
  const styles = useStyles()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${word}`,
    data: { word },
    disabled: !dragEnabled,
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={mergeClasses(styles.cardShell, isDragging && styles.draggingCard)}
      {...attributes}
      {...listeners}
    >
      <ImageCard word={word} imagePath={imagePath} selected={isDragging} onClick={onClick} />
    </div>
  )
}

interface SortingDropZoneProps {
  bucket: Bucket
  title: string
  hint: string
  badgeLabel: string
  active: boolean
  dropEnabled: boolean
  variant: 'target' | 'error' | 'pool'
  onArmBucket: () => void
  children: React.ReactNode
}

function SortingDropZone({
  bucket,
  title,
  hint,
  badgeLabel,
  active,
  dropEnabled,
  variant,
  onArmBucket,
  children,
}: SortingDropZoneProps) {
  const styles = useStyles()
  const { isOver, setNodeRef } = useDroppable({
    id: `bucket:${bucket}`,
    disabled: !dropEnabled,
  })

  return (
    <div
      ref={setNodeRef}
      className={mergeClasses(
        styles.home,
        variant === 'target' && styles.targetHome,
        variant === 'error' && styles.errorHome,
        variant === 'pool' && styles.poolHome,
        active && styles.activeHome,
        isOver && styles.overHome,
      )}
    >
      <div className={styles.homeHeader}>
        <Text className={styles.homeTitle}>{title}</Text>
        <Button appearance={active ? 'primary' : 'secondary'} className={styles.homeToggle} onClick={onArmBucket}>
          {title}
        </Button>
      </div>
      <div className={styles.homeHeader}>
        <Badge appearance="filled">{badgeLabel}</Badge>
        <Text className={styles.homeMeta}>{hint}</Text>
      </div>
      <div className={styles.cards}>{children}</div>
    </div>
  )
}