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

import { Card, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
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
  progress: {
    fontSize: '0.82rem',
    color: 'var(--color-text-secondary)',
  },
  decision: {
    display: 'grid',
    gap: 'var(--space-sm)',
    justifyItems: 'center',
    padding: 'var(--space-md) 0',
    opacity: 0,
    transition: 'opacity 240ms ease',
    pointerEvents: 'none',
  },
  decisionVisible: {
    opacity: 1,
    pointerEvents: 'auto',
  },
  decisionPrompt: {
    fontSize: '0.95rem',
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
  },
  decisionButtons: {
    display: 'flex',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  decisionButton: {
    border: '1px solid var(--color-primary)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 22px',
    fontFamily: 'var(--font-display)',
    fontSize: '0.92rem',
    fontWeight: '600',
    letterSpacing: '0.01em',
    cursor: 'pointer',
    minWidth: '150px',
  },
  decisionPrimary: {
    backgroundColor: 'var(--color-primary)',
    color: '#ffffff',
  },
  decisionSecondary: {
    backgroundColor: 'transparent',
    color: 'var(--color-primary-dark)',
  },
})

type Phase = 'idle' | 'playing' | 'finished'

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  audience?: 'therapist' | 'child'
  readyToStart?: boolean
  // `immediate` asks the host to skip its usual SESSION_WRAP_UP_DELAY_MS and
  // wrap the session now. Fired by the therapist's explicit "End session"
  // button after a round. Child mode never sets it (today's warm delay is
  // preserved for the auto-end path).
  onExerciseComplete?: (opts?: { immediate?: boolean }) => void
  // Pipe beat copy (ORIENT / BRIDGE / REINFORCE) + the therapist decision
  // prompt through the host's TTS adapter so the child/therapist actually
  // hears "Lovely listening!" and "Shall we listen again, or wrap up?".
  // Matches the pattern used by SilentSortingPanel / ListeningMinimalPairsPanel.
  onSpeakExerciseText?: (text: string) => Promise<void>
}

// Delay before the Play again / End session buttons fade in after REINFORCE
// enters. Gives the REINFORCE TTS ("Lovely listening!") room to drain so we
// don't steal focus mid-speech. 2500ms covers the 5-word line comfortably.
const REINFORCE_DECISION_DELAY_MS = 2500
// Fallback auto-end if therapist doesn't choose within this window. Matches
// today's warm auto-wrap behaviour so sessions never hang open.
const REINFORCE_DECISION_TIMEOUT_MS = 20_000

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
  onSpeakExerciseText,
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
  // Therapist orient is intentionally empty: the realtime avatar already
  // delivers the "press Start" intro, so a second shell-level orient line
  // used to overlap it and then cut into the bombardment TTS. Child mode
  // keeps its warm cue because there is no avatar greeting to duplicate.
  const beats: ExerciseBeatCopy = {
    orient:
      audience === 'therapist'
        ? ''
        : `Let's listen to the ${perceptLabel} sound together.`,
    bridge: 'Keep listening.',
    reinforce: 'Lovely listening! See you next time.',
  }

  // Audience-aware title. Therapist sees the clinical framing (stage + IPA-ish
  // target); child sees a warm, percept-led cue. Falls back to the YAML
  // `scenarioName` only if a target sound is not yet resolved.
  const title =
    audience === 'therapist'
      ? `/${targetSound}/ — Auditory Bombardment`
      : scenarioName || `Listen to the "${perceptLabel}" sound`

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{title}</Text>
      <Text className={styles.body}>
        {audience === 'therapist'
          ? `Auditory bombardment for ${perceptLabel}. Twelve pictures play automatically.`
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
          // Therapist mode gets an explicit "Play again / End session"
          // decision beat after REINFORCE speaks. Child mode keeps the warm
          // auto-wrap (no buttons, no decision — the session just ends).
          reinforce:
            audience === 'therapist' ? (
              <ReinforceDecision
                onEndSession={() => onExerciseComplete?.({ immediate: true })}
                onAutoEnd={() => onExerciseComplete?.()}
                onSpeakExerciseText={onSpeakExerciseText}
              />
            ) : null,
        }}
        performComplete={true}
        collapsePerform={true}
        therapistCanSkipIntro={audience === 'therapist'}
        onBeatEnter={(phase, beatText) => {
          // Speak every beat (orient / bridge / reinforce) through the host's
          // TTS adapter. Without this the REINFORCE copy "Lovely listening!
          // See you next time." would render silently on both audiences.
          // Empty/whitespace beat text (e.g. therapist orient) is a no-op so
          // we don't duplicate the avatar's realtime intro.
          //
          // Therapist-only suppression: BRIDGE ("Keep listening.") and
          // REINFORCE ("Lovely listening! See you next time.") are muted so
          // the therapist hears a single end-of-session line — the
          // ReinforceDecision prompt "Shall we listen again, or wrap up?".
          // Child mode keeps the warm bridge + reinforce beats (it never
          // renders the decision prompt).
          const suppressBeatTTS =
            audience === 'therapist' && (phase === 'bridge' || phase === 'reinforce')
          if (!suppressBeatTTS && beatText?.trim() && onSpeakExerciseText) {
            void onSpeakExerciseText(beatText)
          }
          // Child mode: reinforce beat fires complete immediately, matching
          // today's behaviour (warm "Lovely listening!" + auto-wrap with
          // SESSION_WRAP_UP_DELAY_MS). Therapist mode defers until the
          // decision buttons resolve (Play again / End session / timeout),
          // so do NOT call onExerciseComplete here.
          if (phase === 'reinforce' && audience === 'child' && onExerciseComplete) {
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
  // PR3 — single-gate start. The shell's ORIENT already acts as the start
  // gate (child: beat TTS auto-advances; therapist: "Start session" button).
  // Once we mount in EXPOSE, playback runs automatically — no second tap.
  const autoStartedRef = useRef(false)

  // Cancel any in-flight fetch/audio on unmount. Also reset the one-shot
  // auto-start guard so that if this unmount is actually a StrictMode
  // double-invoke (dev-mode simulated unmount + remount), the subsequent
  // mount can re-run `start()`. Without this, the first fetch is aborted
  // by the cleanup (visible in DevTools as a 0-byte/canceled /api/tts row)
  // and the remount short-circuits on `autoStartedRef.current === true`,
  // leaving the panel stuck at "1 of 12" with no audio. Harmless on a real
  // unmount — the component is going away anyway.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      autoStartedRef.current = false
      advanceCalledRef.current = false
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
      // `force: true` bypasses the shell's expose-gate. We bypass because:
      //   (a) PlaybackSlot is the sole EXPOSE interaction in Stage 0 — if we
      //       reach here, the 12 exemplars played to completion and the round
      //       is authoritatively done.
      //   (b) The shell's effectiveDispatch reads `state.exposeTouched` via a
      //       useCallback closure. `start()` runs across multiple renders
      //       (await synth + audio + 450 ms gap × 12), so by the time we call
      //       `advance()` the captured closure may still see
      //       exposeTouched=false — even though `notifyExposeInteract()`
      //       updated reducer state at the top of this run. Forcing avoids
      //       that stale-gate false-negative.
      advance({ force: true })
    }
  }, [advance, exemplars, notifyExposeInteract, phase, voiceName])

  // Auto-start playback as soon as the EXPOSE slot mounts. The shell's ORIENT
  // phase is the real start gate (child: beat auto-advances after gesture;
  // therapist: "Start session" button dispatches THERAPIST_SKIP). Mounting
  // here means that gate has already passed, so we do NOT re-check
  // `readyToStart` — which depends on the realtime greeting transcript
  // arriving, and can stall indefinitely if the avatar websocket is degraded
  // (capacity / agent-id errors). TTS uses a plain /api/tts POST and does
  // not need the realtime session to be healthy. One-shot guard survives
  // StrictMode double-invocation of the mount effect.
  useEffect(() => {
    if (autoStartedRef.current) return
    if (exemplars.length === 0) return
    autoStartedRef.current = true
    void start()
  }, [exemplars.length, start])

  const progressText =
    phase === 'playing' && activeIndex >= 0
      ? `${activeIndex + 1} of ${exemplars.length}`
      : phase === 'finished'
        ? `${exemplars.length} of ${exemplars.length}`
        : `${exemplars.length} pictures`

  return (
    <>
      <div className={styles.controls} data-testid="bombardment-progress">
        <Text className={styles.progress}>{progressText}</Text>
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

// ---------------------------------------------------------------------------
// ReinforceDecision — therapist-only "Play again / End session" beat.
//
// Rendered as the shell's REINFORCE slot when audience === 'therapist'. The
// buttons fade in after REINFORCE_DECISION_DELAY_MS so they don't step on the
// REINFORCE TTS ("Lovely listening! See you next time."). If the therapist
// does nothing within REINFORCE_DECISION_TIMEOUT_MS we call onAutoEnd, which
// mirrors today's auto-wrap. "Play again" dispatches REPLAY on the shell,
// sending it reinforce → expose without re-firing ORIENT/BRIDGE greetings.
// ---------------------------------------------------------------------------

interface ReinforceDecisionProps {
  onEndSession: () => void
  onAutoEnd: () => void
  onSpeakExerciseText?: (text: string) => Promise<void>
}

const REINFORCE_DECISION_PROMPT = 'Shall we listen again, or wrap up?'

function ReinforceDecision({ onEndSession, onAutoEnd, onSpeakExerciseText }: ReinforceDecisionProps) {
  const styles = useStyles()
  const { replay } = useShellAdvance()
  const [visible, setVisible] = useState(false)
  const [resolved, setResolved] = useState(false)
  const playAgainRef = useRef<HTMLButtonElement | null>(null)
  const resolvedRef = useRef(false)
  // Guard: REINFORCE can re-render (parent state churn, slot remount) which
  // previously re-fired the showTimer and caused "Shall we listen again, or
  // wrap up?" to loop. Speak + auto-end are both one-shot per mount.
  const spokePromptRef = useRef(false)
  const autoEndedRef = useRef(false)
  const onAutoEndRef = useRef(onAutoEnd)
  const onSpeakRef = useRef(onSpeakExerciseText)
  useEffect(() => {
    onAutoEndRef.current = onAutoEnd
    onSpeakRef.current = onSpeakExerciseText
  })

  useEffect(() => {
    const showTimer = window.setTimeout(() => {
      setVisible(true)
      // Speak the prompt as the buttons fade in, so the therapist hears the
      // choice instead of just reading it silently. One-shot across renders.
      if (spokePromptRef.current) return
      spokePromptRef.current = true
      const speak = onSpeakRef.current
      if (speak) {
        void speak(REINFORCE_DECISION_PROMPT)
      }
    }, REINFORCE_DECISION_DELAY_MS)
    const endTimer = window.setTimeout(() => {
      if (resolvedRef.current || autoEndedRef.current) return
      autoEndedRef.current = true
      resolvedRef.current = true
      setResolved(true)
      onAutoEndRef.current()
    }, REINFORCE_DECISION_TIMEOUT_MS)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(endTimer)
    }
    // Intentionally empty deps: both timers are one-shot per mount. Latest
    // callbacks are read via refs so prop-identity churn can't restart them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Focus the primary affordance once visible, so Enter replays and
  // Esc (via the onKeyDown handler below) ends the session.
  useEffect(() => {
    if (visible && !resolved) {
      playAgainRef.current?.focus()
    }
  }, [visible, resolved])

  const handlePlayAgain = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setResolved(true)
    replay()
  }

  const handleEnd = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setResolved(true)
    onEndSession()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleEnd()
    }
  }

  return (
    <div
      aria-label="Round complete. Play again or end session."
      className={mergeClasses(styles.decision, visible && styles.decisionVisible)}
      data-testid="reinforce-decision"
      data-visible={visible ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.decisionButtons}>
        <button
          ref={playAgainRef}
          type="button"
          className={mergeClasses(styles.decisionButton, styles.decisionPrimary)}
          data-testid="reinforce-play-again"
          data-primary-affordance="true"
          data-for-phase="reinforce"
          aria-label="Play the round again"
          onClick={handlePlayAgain}
          disabled={resolved}
        >
          Play again
        </button>
        <button
          type="button"
          className={mergeClasses(styles.decisionButton, styles.decisionSecondary)}
          data-testid="reinforce-end-session"
          aria-label="End session"
          onClick={handleEnd}
          disabled={resolved}
        >
          End session
        </button>
      </div>
    </div>
  )
}
