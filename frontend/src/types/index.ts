/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Scenario {
  id: string
  name: string
  description: string
  exerciseMetadata?: ExerciseMetadata
  is_custom?: boolean
}

export type ExerciseType =
  | 'word_repetition'
  | 'minimal_pairs'
  | 'sentence_repetition'
  | 'guided_prompt'
  | 'listening_minimal_pairs'
  | 'silent_sorting'
  | 'sound_isolation'
  | 'vowel_blending'
  | 'two_word_phrase'
  | 'generalisation'
  | 'cluster_blending'
  | 'syllable_practice'

export type ExerciseDifficulty = 'easy' | 'medium' | 'hard'

export type WordPosition = 'initial' | 'medial' | 'final' | 'all'

export interface MinimalPairItem {
  word_a: string
  word_b: string
}

export interface ExerciseMetadata {
  type: ExerciseType
  targetSound: string
  targetWords: string[]
  difficulty: ExerciseDifficulty
  wordPosition?: WordPosition
  errorSound?: string
  repetitionTarget?: number
  masteryThreshold?: number
  stepNumber?: number
  requiresMic?: boolean
  imageAssets?: string[]
  modifiers?: string[]
  sentenceStarters?: string[]
  conversationPrompts?: string[]
  pairs?: MinimalPairItem[]
  childAge?: number
  ageRange?: string
  speechLanguage?: string
}

export interface Exercise extends Scenario {
  exerciseMetadata: ExerciseMetadata
}

export interface ChildProfile {
  id: string
  name: string
  created_at?: string
  session_count?: number
  last_session_at?: string | null
}

export interface SessionExercise {
  id: string
  name: string
  description: string
  exerciseMetadata?: Partial<ExerciseMetadata>
  is_custom?: boolean
}

export type TherapistFeedbackRating = 'up' | 'down'

export interface TherapistFeedback {
  rating: TherapistFeedbackRating
  note?: string | null
  submitted_at?: string | null
}

export interface PilotState {
  consent_timestamp?: string | null
  roles_enabled?: boolean
}

export interface SessionSummary {
  id: string
  timestamp: string
  overall_score?: number | null
  pronunciation_score?: number | null
  accuracy_score?: number | null
  therapist_notes?: string | null
  therapist_feedback?: TherapistFeedback | null
  exercise_metadata?: Partial<ExerciseMetadata>
  exercise: SessionExercise
}

export interface SessionDetail {
  id: string
  timestamp: string
  child: Pick<ChildProfile, 'id' | 'name'>
  exercise: SessionExercise
  exercise_metadata?: Partial<ExerciseMetadata>
  assessment: Assessment
  therapist_feedback?: TherapistFeedback | null
  transcript?: string | null
  reference_text?: string | null
}

export interface PlannerMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PracticePlanActivity {
  title: string
  exercise_id: string
  exercise_name: string
  reason: string
  target_duration_minutes: number
}

export interface PracticePlanDraft {
  objective: string
  focus_sound: string
  rationale: string
  estimated_duration_minutes: number
  activities: PracticePlanActivity[]
  therapist_cues: string[]
  success_criteria: string[]
  carryover: string[]
}

export interface PracticePlan {
  id: string
  child_id: string
  source_session_id?: string | null
  status: 'draft' | 'approved'
  title: string
  plan_type: string
  constraints: Record<string, unknown>
  draft: PracticePlanDraft
  conversation: PlannerMessage[]
  planner_session_id?: string | null
  created_by_user_id?: string | null
  created_at: string
  updated_at: string
  approved_at?: string | null
}

export interface PlannerReadinessCliStatus {
  configured_path?: string | null
  resolved_path?: string | null
  available: boolean
  version?: string | null
  auth_checked?: boolean
  authenticated: boolean
  auth_message?: string | null
}

export interface PlannerReadinessAuthStatus {
  github_token_configured: boolean
  azure_byok_configured: boolean
}

export interface PlannerReadiness {
  ready: boolean
  model: string
  sdk_installed: boolean
  cli: PlannerReadinessCliStatus
  auth: PlannerReadinessAuthStatus
  reasons: string[]
}

export interface AppConfig {
  status: string
  proxy_enabled: boolean
  ws_url?: string
  ws_endpoint: string
  storage_ready: boolean
  telemetry_enabled: boolean
  image_base_path: string
  planner?: PlannerReadiness
}

export interface AvatarOption {
  value: string
  label: string
  isPhotoAvatar: boolean
  /** Accent colour used for buddy-specific tinting */
  color: string
  /** Optional persona hint used when introducing the buddy */
  persona?: string
  /** Optional voice override sent to the backend for this buddy */
  voiceName?: string
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  {
    value: 'meg-casual',
    label: 'Meg',
    isPhotoAvatar: false,
    color: '#0d8a84',
    persona: 'an adult woman',
  },
  { value: 'riya', label: 'Riya (Photo)', isPhotoAvatar: true, color: '#a855f7' },
  { value: 'simone', label: 'Simone (Photo)', isPhotoAvatar: true, color: '#f97316' },
]

export const DEFAULT_AVATAR = 'meg-casual'

export interface CustomScenarioData {
  systemPrompt: string
  exerciseType: ExerciseType
  targetSound: string
  targetWords: string[]
  difficulty: ExerciseDifficulty
  promptText: string
  childAge?: number
}

export interface PronunciationWordResult {
  word: string
  accuracy: number
  error_type: string
  target_word?: string
  age_adjusted?: boolean
}

export interface PronunciationAssessment {
  accuracy_score: number
  fluency_score: number
  completeness_score: number
  prosody_score?: number
  pronunciation_score: number
  adjustments_applied?: number
  words?: PronunciationWordResult[]
}

export interface CustomScenario extends Scenario {
  is_custom: true
  scenarioData: CustomScenarioData
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  streaming?: boolean
}

export interface Assessment {
  session_id?: string
  ai_assessment?: {
    articulation_clarity: {
      target_sound_accuracy: number
      overall_clarity: number
      consistency: number
      total: number
    }
    engagement_and_effort: {
      task_completion: number
      willingness_to_retry: number
      self_correction_attempts: number
      total: number
    }
    overall_score: number
    celebration_points: string[]
    practice_suggestions: string[]
    therapist_notes?: string
  }
  pronunciation_assessment?: PronunciationAssessment
}
