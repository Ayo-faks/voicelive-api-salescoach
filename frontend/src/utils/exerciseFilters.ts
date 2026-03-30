import type { ExerciseType, Scenario } from '../types'

export type ActivityFilterId = 'recommended' | 'listening' | 'sound' | 'words' | 'all'
export type SoundFamilyId = 'all' | 's' | 'sh' | 'k' | 'th' | 'r' | 'pairs'

export type FilterOption<T extends string> = {
  id: T
  label: string
}

export type StepGroup = {
  id: string
  stepNumber?: number
  label: string
  scenarios: Scenario[]
}

export const ACTIVITY_FILTERS: FilterOption<ActivityFilterId>[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'listening', label: 'Listening' },
  { id: 'sound', label: 'Sound Practice' },
  { id: 'words', label: 'Word Practice' },
  { id: 'all', label: 'All' },
]

export const SOUND_FILTERS: FilterOption<SoundFamilyId>[] = [
  { id: 'all', label: 'All sounds' },
  { id: 's', label: '/s/' },
  { id: 'sh', label: '/sh/' },
  { id: 'k', label: '/k/' },
  { id: 'th', label: '/th/' },
  { id: 'r', label: '/r/' },
  { id: 'pairs', label: 'Pairs' },
]

const LISTENING_TYPES: ExerciseType[] = ['listening_minimal_pairs', 'silent_sorting']
const SOUND_PRACTICE_TYPES: ExerciseType[] = [
  'sound_isolation',
  'vowel_blending',
  'cluster_blending',
  'syllable_practice',
]
const WORD_PRACTICE_TYPES: ExerciseType[] = [
  'word_repetition',
  'minimal_pairs',
  'two_word_phrase',
  'sentence_repetition',
  'guided_prompt',
  'generalisation',
]

const STEP_LABELS: Record<number, string> = {
  1: 'Listening',
  2: 'Sorting',
  3: 'Sound Only',
  4: 'Blends',
  5: 'Words',
  7: 'Sentences',
  9: 'Stories',
}

function normalizeSound(value?: string): string {
  return (value || '').toLowerCase().replace(/\s+/g, '')
}

export function getScenarioSoundFamilyId(scenario: Scenario): SoundFamilyId {
  const type = scenario.exerciseMetadata?.type

  if (type === 'minimal_pairs' || type === 'listening_minimal_pairs') {
    return 'pairs'
  }

  const targetSound = normalizeSound(scenario.exerciseMetadata?.targetSound)

  if (targetSound.includes('/sh/') || targetSound.includes('sh')) {
    return 'sh'
  }

  if (targetSound.includes('/th/') || targetSound.includes('th')) {
    return 'th'
  }

  if (targetSound.includes('/s/') || targetSound === 's') {
    return 's'
  }

  if (targetSound.includes('/r/') || targetSound === 'r') {
    return 'r'
  }

  if (targetSound.includes('/k/') || targetSound === 'k') {
    return 'k'
  }

  return 'all'
}

export function getStepLabel(stepNumber?: number): string {
  if (!stepNumber) {
    return 'Practice'
  }

  return STEP_LABELS[stepNumber] || 'Practice'
}

export function getActivityFilterMatch(
  scenario: Scenario,
  activityFilter: ActivityFilterId
): boolean {
  const type = scenario.exerciseMetadata?.type
  const stepNumber = scenario.exerciseMetadata?.stepNumber

  if (activityFilter === 'all') {
    return true
  }

  if (activityFilter === 'recommended') {
    if (typeof stepNumber === 'number' && stepNumber <= 3) {
      return true
    }

    return Boolean(
      type &&
        (LISTENING_TYPES.includes(type) || SOUND_PRACTICE_TYPES.includes(type))
    )
  }

  if (!type) {
    return false
  }

  if (activityFilter === 'listening') {
    return LISTENING_TYPES.includes(type)
  }

  if (activityFilter === 'sound') {
    return SOUND_PRACTICE_TYPES.includes(type)
  }

  if (activityFilter === 'words') {
    return WORD_PRACTICE_TYPES.includes(type)
  }

  return true
}

export function filterScenarios(
  scenarios: Scenario[],
  activityFilter: ActivityFilterId,
  soundFilter: SoundFamilyId
): Scenario[] {
  return scenarios.filter(scenario => {
    if (!getActivityFilterMatch(scenario, activityFilter)) {
      return false
    }

    if (soundFilter === 'all') {
      return true
    }

    return getScenarioSoundFamilyId(scenario) === soundFilter
  })
}

export function groupByStep(scenarios: Scenario[]): StepGroup[] {
  const groups = new Map<string, StepGroup>()

  for (const scenario of scenarios) {
    const stepNumber = scenario.exerciseMetadata?.stepNumber
    const key = typeof stepNumber === 'number' ? `step-${stepNumber}` : 'step-extra'

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        stepNumber,
        label: getStepLabel(stepNumber),
        scenarios: [],
      })
    }

    groups.get(key)?.scenarios.push(scenario)
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftStep = left.stepNumber ?? Number.MAX_SAFE_INTEGER
    const rightStep = right.stepNumber ?? Number.MAX_SAFE_INTEGER

    return leftStep - rightStep
  })
}
