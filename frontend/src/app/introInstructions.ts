import { buildBeatInstructions } from './beatInstructions'

export interface IntroInstructionOptions {
  childName?: string | null
  avatarName: string
  avatarPersona: string
  scenarioName?: string | null
  scenarioDescription?: string | null
  exerciseType?: string | null
  targetSound?: string | null
}

/**
 * Legacy whole-session intro for the child audience.
 *
 * PR1 Session B narrowing: the scripted TH silent_sorting ORIENT branch is now
 * sourced from `buildBeatInstructions({ beat: 'orient', audience: 'child' })`
 * so beat copy has a single source of truth. The generic branch is kept
 * verbatim to avoid regressing the App.tsx call-site behind the legacy
 * (non-beat-orchestration) code path. See docs/exercise-shell-pr1-plan.md §E.2.
 */
export function buildChildIntroInstructions({
  childName,
  avatarName,
  avatarPersona,
  scenarioName,
  scenarioDescription,
  exerciseType,
  targetSound,
}: IntroInstructionOptions): string {
  if (exerciseType === 'silent_sorting' && targetSound === 'th') {
    return buildBeatInstructions({
      childName,
      avatarName,
      avatarPersona,
      scenarioName,
      scenarioDescription,
      exerciseType,
      targetSound,
      beat: 'orient',
      audience: 'child',
    })
  }
  if (exerciseType === 'two_word_phrase') {
    return buildBeatInstructions({
      childName,
      avatarName,
      avatarPersona,
      scenarioName,
      scenarioDescription,
      exerciseType,
      targetSound,
      beat: 'orient',
      audience: 'child',
    })
  }
  if (exerciseType === 'structured_conversation') {
    return buildBeatInstructions({
      childName,
      avatarName,
      avatarPersona,
      scenarioName,
      scenarioDescription,
      exerciseType,
      targetSound,
      beat: 'orient',
      audience: 'child',
    })
  }
  const childLabel = childName || 'my friend'
  const exerciseLabel = scenarioName || "today's practice"
  const exerciseContext = scenarioDescription
    ? `Briefly mention this practice focus: ${scenarioDescription}.`
    : 'Briefly mention that you will practice together.'

  return [
    `You are ${avatarName}, ${avatarPersona}, and a warm speech-practice buddy for a child named ${childLabel}.`,
    'Speak first to begin the session.',
    `In two short, friendly sentences, greet ${childLabel}, say you are starting ${exerciseLabel}, and tell them to tap the microphone when they are ready to talk.`,
    exerciseContext,
    'Never use the word "test". Always say "practice" or "exercise".',
    'Keep the tone calm, encouraging, and child-friendly. Keep it under 35 words.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Legacy whole-session intro for the therapist audience. Narrowed identically
 * to `buildChildIntroInstructions` — see that doc comment.
 */
export function buildTherapistIntroInstructions({
  childName,
  avatarName,
  avatarPersona,
  scenarioName,
  scenarioDescription,
  exerciseType,
  targetSound,
}: IntroInstructionOptions): string {
  if (exerciseType === 'silent_sorting' && targetSound === 'th') {
    return buildBeatInstructions({
      childName,
      avatarName,
      avatarPersona,
      scenarioName,
      scenarioDescription,
      exerciseType,
      targetSound,
      beat: 'orient',
      audience: 'therapist',
    })
  }
  if (exerciseType === 'two_word_phrase') {
    return buildBeatInstructions({
      childName,
      avatarName,
      avatarPersona,
      scenarioName,
      scenarioDescription,
      exerciseType,
      targetSound,
      beat: 'orient',
      audience: 'therapist',
    })
  }
  if (exerciseType === 'structured_conversation') {
    return buildBeatInstructions({
      childName,
      avatarName,
      avatarPersona,
      scenarioName,
      scenarioDescription,
      exerciseType,
      targetSound,
      beat: 'orient',
      audience: 'therapist',
    })
  }
  const childLabel = childName || 'the child'
  const exerciseLabel = scenarioName || "today's practice"
  const exerciseContext = scenarioDescription
    ? `Briefly mention this practice focus: ${scenarioDescription}.`
    : 'Briefly mention that you will guide the practice together.'

  return [
    `You are ${avatarName}, ${avatarPersona}, and a warm speech-practice buddy supporting a therapist and ${childLabel}.`,
    'Speak first to begin the session.',
    `In two short sentences, welcome the therapist, say you are starting ${exerciseLabel} with ${childLabel}, and ask them to tap the microphone when they are ready to begin.`,
    exerciseContext,
    'Keep the tone calm, observational, and supportive. Keep it under 35 words.',
  ]
    .filter(Boolean)
    .join(' ')
}
