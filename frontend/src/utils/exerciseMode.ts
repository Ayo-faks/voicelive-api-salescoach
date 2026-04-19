import type { CustomScenario, ExerciseMetadata, ExerciseType, Scenario } from '../types'

type ExerciseTypeLike = ExerciseType | string | null | undefined

export function isTapOnlyExerciseType(type: ExerciseTypeLike): boolean {
  return (
    type === 'listening_minimal_pairs' ||
    type === 'silent_sorting' ||
    type === 'auditory_bombardment'
  )
}

export function exerciseRequiresMic(
  metadata?: Partial<ExerciseMetadata> | null,
  type?: ExerciseTypeLike,
): boolean {
  const resolvedType = type ?? metadata?.type

  if (isTapOnlyExerciseType(resolvedType)) {
    return false
  }

  return metadata?.requiresMic !== false
}

export function getScenarioExerciseType(
  scenario: Scenario | CustomScenario | null | undefined,
): ExerciseTypeLike {
  if (!scenario) {
    return undefined
  }

  return 'scenarioData' in scenario
    ? scenario.scenarioData.exerciseType
    : scenario.exerciseMetadata?.type
}