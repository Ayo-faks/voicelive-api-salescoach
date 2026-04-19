/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AuditoryBombardmentPanel — Stage 0 listening-only exposure.
 *
 * Plays a sequence of twelve curated target-sound words through TTS while
 * highlighting the matching ImageCard. Child does not speak; there is no
 * microphone. On the final exemplar we dispatch ADVANCE so the shell moves
 * EXPOSE → BRIDGE → REINFORCE (collapsePerform), and the REINFORCE beat
 * fires `onExerciseComplete`.
 */

import { Button, Card, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExerciseExemplar, ExerciseMetadata } from '../types'
import { api } from '../services/api'
import { ImageCard } from './ImageCard'
import {
  ExerciseShell,
  useShellAdvance,
  type ExerciseBeatCopy,
} from './ExerciseShell'
import { getPerceptLabel } from './PhonemeIcon'

const INTER_EXEMPLAR_GAP_MS = 450

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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 720px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
    '@media (max-width: 480px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  cardShell: {
    transition: 'transform 180ms ease, opacity 180ms ease',
    opacity: 0.55,
  },
  cardIdle: {
    opacity: 1,
  },
  cardActive: {
    transform: 'scale(1.04)',
    opacity: 1,
  },
  cardDone: {
    opacity: 0.85,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  startButton: {
    minHeight: '44px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
  progress: {
    fontSize: '0.82rem',
    color: 'var(--color-text-secondary)',
  },
})

type Phase = 'idle' | 'playing' | 'finished'

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  audience?: 'therapist' | 'child'
  readyToStart?: boolean
  onExerciseComplete?: () => void
}

function decodeAudio(b64: string): string {
  const blob = new Blob(
    [Uint8Array.from(atob(b64), c => c.charCodeAt(0))],
    { type: 'audio/mpeg' },
  )
  return URL.createObjectURL(blob)
}

export function AuditoryBombardmentPanel({
  scenarioName,
  metadata,
  audience = 'child',
  readyToStart = true,
  onExerciseComplete,
}: Props) {
  const styles = useStyles()
  const targetSound = metadata?.targetSound || 'target'
  const exemplars: ExerciseExemplar[] = useMemo(
    () => (metadata?.exemplars || []).slice(),
    [metadata?.exemplars],
  )
  const imageAssets = useMemo(
    () => metadata?.imageAssets || [],
    [metadata?.imageAssets],
  )

  const shellMetadata: ExerciseMetadata = {
    type: 'auditory_bombardment',
    targetSound,
    targetWords: exemplars.map(e => e.word),
    difficulty: metadata?.difficulty ?? 'easy',
    ...metadata,
  }

  const perceptLabel = getPerceptLabel(targetSound)
  const beats: ExerciseBeatCopy = {
    orient:
      audience === 'therapist'
        ? `Starting Stage 0 listening for ${perceptLabel}. No mic — watch and listen.`
        : `Let's listen to the ${perceptLabel} sound together.`,
    bridge: 'Keep listening.',
    reinforce: 'Lovely listening! See you next time.',
  }

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Listening'}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? `Stage 0 auditory bombardment for ${perceptLabel}. The app plays twelve pictures automatically.`
          : `Watch the pictures light up while you hear the ${perceptLabel} sound.`}
      </Text>
      <ExerciseShell
        metadata={shellMetadata}
        audience={audience}
        beats={beats}
        slots={{
          expose: (
            <PlaybackSlot
              exemplars={exemplars}
              imageAssets={imageAssets}
              readyToStart={readyToStart}
              voiceName={metadata?.speechLanguage === 'en-GB' ? undefined : undefined}
            />
          ),
          // PERFORM is collapsed for Stage 0; shell never renders it but the
          // type still requires the slot.
          perform: null,
        }}
        performComplete={true}
        collapsePerform={true}
        therapistCanSkipIntro={audience === 'therapist'}
        onBeatEnter={(phase) => {
          if (phase === 'reinforce' && onExerciseComplete) {
            onExerciseComplete()
          }
        }}
      />
    </Card>
  )
}

interface PlaybackSlotProps {
  exemplars: ExerciseExemplar[]
  imageAssets: string[]
  readyToStart: boolean
  voiceName?: string
}

function PlaybackSlot({ exemplars, imageAssets, readyToStart, voiceName }: PlaybackSlotProps) {
  const styles = useStyles()
  const { advance, notifyExposeInteract } = useShellAdvance()
  const [phase, setPhase] = useState<Phase>('idle')
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const abortRef = useRef<AbortController | null>(null)
  const advanceCalledRef = useRef(false)

  // Cancel any in-flight fetch/audio on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (phase !== 'idle' || exemplars.length === 0) return
    notifyExposeInteract()
    setPhase('playing')
    const controller = new AbortController()
    abortRef.current = controller

    const playOne = async (text: string): Promise<void> => {
      const b64 = await api.synthesizeSpeech(
        voiceName ? { text, voiceName } : { text },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      const url = decodeAudio(b64)
      await new Promise<void>((resolve) => {
        const audio = new Audio(url)
        const cleanup = () => {
          URL.revokeObjectURL(url)
          resolve()
        }
        audio.onended = cleanup
        audio.onerror = cleanup
        controller.signal.addEventListener('abort', () => {
          audio.pause()
          cleanup()
        }, { once: true })
        void audio.play().catch(cleanup)
      })
    }

    try {
      for (let i = 0; i < exemplars.length; i++) {
        if (controller.signal.aborted) return
        setActiveIndex(i)
        await playOne(exemplars[i].word)
        if (controller.signal.aborted) return
        if (i < exemplars.length - 1) {
          await new Promise<void>(r => {
            const t = setTimeout(r, INTER_EXEMPLAR_GAP_MS)
            controller.signal.addEventListener('abort', () => {
              clearTimeout(t)
              r()
            }, { once: true })
          })
        }
      }
    } catch {
      // Abort or network error — stop quietly; shell stays in EXPOSE until
      // the child or therapist taps Start again.
      return
    }

    if (controller.signal.aborted) return
    setPhase('finished')
    setActiveIndex(-1)
    if (!advanceCalledRef.current) {
      advanceCalledRef.current = true
      advance()
    }
  }, [advance, exemplars, notifyExposeInteract, phase, voiceName])

  const buttonLabel =
    phase === 'idle' ? 'Start listening' : phase === 'playing' ? 'Listening…' : 'All done'
  const progressText =
    phase === 'playing' && activeIndex >= 0
      ? `${activeIndex + 1} of ${exemplars.length}`
      : phase === 'finished'
        ? `${exemplars.length} of ${exemplars.length}`
        : `${exemplars.length} pictures`

  return (
    <>
      <div className={styles.controls}>
        <Text className={styles.progress}>{progressText}</Text>
        <Button
          appearance="primary"
          className={styles.startButton}
          disabled={!readyToStart || phase !== 'idle' || exemplars.length === 0}
          onClick={() => { void start() }}
        >
          {buttonLabel}
        </Button>
      </div>
      <div className={styles.grid}>
        {exemplars.map((ex, i) => {
          const done = phase === 'finished' || (phase === 'playing' && i < activeIndex)
          const active = phase === 'playing' && i === activeIndex
          const idle = phase === 'idle'
          return (
            <div
              key={`${ex.imageAssetId}-${i}`}
              data-testid={`bombardment-cell-${i}`}
              data-active={active ? 'true' : 'false'}
              data-done={done ? 'true' : 'false'}
              className={mergeClasses(
                styles.cardShell,
                idle && styles.cardIdle,
                active && styles.cardActive,
                done && !active && styles.cardDone,
              )}
            >
              <ImageCard word={ex.word} imagePath={imageAssets[i]} />
            </div>
          )
        })}
      </div>
    </>
  )
}
