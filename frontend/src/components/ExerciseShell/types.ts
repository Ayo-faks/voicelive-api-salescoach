/*---------------------------------------------------------------------------------------------
 *  ExerciseShell — frozen Session 0 contract types.
 *  See docs/exercise-shell-pr1-plan.md §B.2 and §B.3.
 *--------------------------------------------------------------------------------------------*/

import type { ReactNode } from 'react'
import type { ExerciseMetadata } from '../../types'

export type ExercisePhase =
  | 'orient'
  | 'expose'
  | 'bridge'
  | 'perform'
  | 'reinforce'

export interface ExerciseShellSlots {
  expose: ReactNode
  perform: ReactNode
  reinforce?: ReactNode
}

export interface ExerciseBeatCopy {
  orient: string
  bridge: string
  reinforce: string
}

export type TherapistOverrideKind = 'skip-intro' | 'skip-expose' | 'skip-bridge'

export interface TherapistOverrideEntry {
  kind: TherapistOverrideKind
  at: number
  reason?: string
}

export interface ExerciseShellProps {
  metadata: ExerciseMetadata
  audience: 'child' | 'therapist'
  beats: ExerciseBeatCopy
  slots: ExerciseShellSlots

  /**
   * Predicate for EXPOSE → BRIDGE transition. When omitted, the shell permits
   * advance once the user has interacted with the EXPOSE slot at least once
   * (EXPOSE_INTERACT dispatched) OR an explicit Start press is issued.
   */
  canAdvanceFromExpose?: () => boolean

  /** PERFORM completion is owned by the adapter (scoring state lives there). */
  performComplete: boolean

  /** Called at every phase transition. May return a Promise that resolves when audio is done. */
  onBeatEnter?: (phase: ExercisePhase, beatText: string | null) => void | Promise<void>
  onRequestInterrupt?: () => void

  therapistCanSkipIntro?: boolean
  onTherapistOverride?: (kind: TherapistOverrideKind, reason?: string) => void

  /** Stage 0 (bombardment): skip PERFORM entirely. */
  collapsePerform?: boolean
  /** Stage 8 (conversation): no BRIDGE beat. */
  suppressBridge?: boolean
  /** Stage 8: EXPOSE is avatar-side; hide child-facing EXPOSE UI. */
  covertExpose?: boolean
  /**
   * Stage 8: suppress the demoted "Hear the sounds" accordion rendered inside
   * PERFORM. Unlike `covertExpose`, this keeps the child-facing EXPOSE phase
   * UI (used for topic selection) while hiding the accordion that re-exposes
   * the avatar-side listening affordance during PERFORM. Default: false.
   */
  hideDemotedExpose?: boolean

  /** Signals that the realtime WS is ready so queued beats can flush. */
  realtimeReady?: boolean

  /** Dev-only drawer content (e.g. Save-take). Shell renders only when provided. */
  devSlot?: ReactNode
}

// ---------------------------------------------------------------------------
// Internal reducer shape — see §B.3.
// ---------------------------------------------------------------------------

export interface PhaseState {
  phase: ExercisePhase
  exposeTouched: boolean
  performStartedAt: number | null
  overrides: TherapistOverrideEntry[]
}

export type PhaseEvent =
  | { type: 'START' }
  | { type: 'ORIENT_DONE' }
  | { type: 'EXPOSE_INTERACT' }
  | { type: 'ADVANCE'; canAdvance?: boolean }
  | { type: 'BRIDGE_DONE' }
  | { type: 'PERFORM_DONE' }
  | { type: 'RESET' }
  | { type: 'THERAPIST_SKIP'; kind: TherapistOverrideKind; reason?: string; at?: number }
  | { type: 'SUPPRESS_BRIDGE' }
  | { type: 'COLLAPSE_PERFORM' }
