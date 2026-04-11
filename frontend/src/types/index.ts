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
  date_of_birth?: string | null
  notes?: string | null
  deleted_at?: string | null
  created_at?: string
  session_count?: number
  last_session_at?: string | null
  workspace_id?: string | null
}

export interface WorkspaceSummary {
  id: string
  name: string
  owner_user_id: string
  role: 'owner' | 'admin' | 'therapist' | 'parent'
  is_personal: boolean
  created_at: string
  updated_at: string
}

export interface ParentalConsent {
  id: string
  child_id: string
  guardian_name: string
  guardian_email: string
  consent_type: string
  privacy_accepted: boolean
  terms_accepted: boolean
  ai_notice_accepted: boolean
  personal_data_consent_accepted: boolean
  special_category_consent_accepted: boolean
  parental_responsibility_confirmed: boolean
  consented_at: string
  withdrawn_at: string | null
}

export type ChildInvitationRelationship = 'parent' | 'therapist'

export type ChildInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'

export interface InvitationEmailDelivery {
  status: string
  attempted: boolean
  delivered: boolean
  provider_message_id?: string | null
  error?: string | null
}

export interface ChildInvitation {
  id: string
  child_id: string
  child_name: string
  invited_email: string
  relationship: ChildInvitationRelationship
  status: ChildInvitationStatus
  invited_by_user_id: string
  invited_by_name?: string | null
  accepted_by_user_id?: string | null
  created_at: string
  updated_at: string
  responded_at?: string | null
  expires_at?: string | null
  direction: 'incoming' | 'sent'
  email_delivery?: InvitationEmailDelivery | null
  workspace_id?: string | null
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

export interface PracticePlanMemorySnapshotItem {
  id: string
  category: ChildMemoryCategory
  memory_type: string
  statement: string
  confidence?: number | null
  updated_at?: string | null
  detail: Record<string, unknown>
  source_proposal_id?: string | null
}

export interface PracticePlanChildMemorySnapshot {
  used_item_ids: string[]
  used_items?: PracticePlanMemorySnapshotItem[]
  summary_text?: string | null
  summary_last_compiled_at?: string | null
  source_item_count?: number
}

export interface PracticePlanConstraints {
  therapist_message?: string
  last_therapist_message?: string
  source_session_timestamp?: string | null
  child_memory_snapshot?: PracticePlanChildMemorySnapshot
  copilot_sdk?: Record<string, unknown>
  [key: string]: unknown
}

export interface PracticePlan {
  id: string
  child_id: string
  source_session_id?: string | null
  status: 'draft' | 'approved'
  title: string
  plan_type: string
  constraints: PracticePlanConstraints
  draft: PracticePlanDraft
  conversation: PlannerMessage[]
  planner_session_id?: string | null
  created_by_user_id?: string | null
  created_at: string
  updated_at: string
  approved_at?: string | null
}

export type ChildMemoryCategory =
  | 'targets'
  | 'effective_cues'
  | 'ineffective_cues'
  | 'preferences'
  | 'constraints'
  | 'blockers'
  | 'general'

export type ChildMemoryStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'expired'
  | 'superseded'
  | 'disputed'

export interface ChildMemorySummaryEntry {
  id?: string | null
  statement: string
  memory_type?: string | null
  confidence?: number | null
  updated_at?: string | null
  detail?: Record<string, unknown>
  source_proposal_id?: string | null
}

export type ChildMemorySummarySections = Partial<Record<ChildMemoryCategory, ChildMemorySummaryEntry[]>>

export interface ChildMemorySummary {
  child_id: string
  summary: ChildMemorySummarySections
  summary_text?: string | null
  source_item_count: number
  last_compiled_at?: string | null
  updated_at?: string | null
}

export interface ChildMemoryEvidenceLink {
  id: string
  child_id: string
  subject_type: 'item' | 'proposal'
  subject_id: string
  session_id?: string | null
  practice_plan_id?: string | null
  evidence_kind: string
  snippet?: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ChildMemoryItem {
  id: string
  child_id: string
  category: ChildMemoryCategory
  memory_type: string
  status: ChildMemoryStatus
  statement: string
  detail: Record<string, unknown>
  confidence?: number | null
  provenance: Record<string, unknown>
  author_type: string
  author_user_id?: string | null
  source_proposal_id?: string | null
  superseded_by_item_id?: string | null
  created_at: string
  updated_at: string
  reviewed_at?: string | null
  expires_at?: string | null
  evidence_links?: ChildMemoryEvidenceLink[]
}

export interface ChildMemoryProposal {
  id: string
  child_id: string
  category: ChildMemoryCategory
  memory_type: string
  status: ChildMemoryStatus
  statement: string
  detail: Record<string, unknown>
  confidence?: number | null
  provenance: Record<string, unknown>
  author_type: string
  author_user_id?: string | null
  reviewer_user_id?: string | null
  review_note?: string | null
  approved_item_id?: string | null
  created_at: string
  updated_at: string
  reviewed_at?: string | null
  evidence_links?: ChildMemoryEvidenceLink[]
}

export interface ChildMemoryReviewResult {
  proposal: ChildMemoryProposal
  approved_item?: ChildMemoryItem
  summary: ChildMemorySummary
}

export interface ChildMemoryCreateResult {
  item: ChildMemoryItem
  summary: ChildMemorySummary
}

export interface InstitutionalMemoryInsight {
  id: string
  insight_type: 'strategy_insight' | 'reviewed_pattern' | 'recommendation_tuning'
  status: string
  target_sound?: string | null
  title: string
  summary: string
  detail: Record<string, unknown>
  provenance: {
    evidence_basis?: string
    deidentified_child_count?: number
    reviewed_session_count?: number
    approved_memory_item_count?: number
    [key: string]: unknown
  }
  source_child_count: number
  source_session_count: number
  source_memory_item_count: number
  created_at: string
  updated_at: string
}

export interface InstitutionalMemorySnapshot {
  generated_at?: string | null
  summary_text?: string | null
  insights: InstitutionalMemoryInsight[]
  reviewed_child_count?: number
}

export interface RecommendationFactor {
  score: number
  reason: string
  supporting_memory_item_ids?: string[]
  supporting_session_ids?: string[]
}

export interface RecommendationExplanation {
  why_recommended: string
  comparison_to_approved_memory: string
  evidence_that_could_change_recommendation: string
  supporting_memory_items: ChildMemoryItem[]
  supporting_sessions: SessionSummary[]
  institutional_insights?: InstitutionalMemoryInsight[]
  score_summary: string
}

export interface RecommendationCandidate {
  id: string
  recommendation_log_id?: string
  child_id?: string | null
  rank: number
  exercise_id: string
  exercise_name: string
  exercise_description?: string | null
  exercise_metadata: Record<string, unknown>
  score: number
  ranking_factors: Record<string, RecommendationFactor>
  rationale: string
  explanation: RecommendationExplanation
  supporting_memory_item_ids: string[]
  supporting_session_ids: string[]
  created_at?: string
}

export interface RecommendationSummary {
  rank: number
  exercise_id: string
  exercise_name: string
  score: number
  rationale: string
  supporting_memory_item_ids: string[]
  supporting_session_ids: string[]
}

export interface RecommendationLog {
  id: string
  child_id: string
  source_session_id?: string | null
  target_sound: string
  therapist_constraints: {
    note?: string
    parsed?: Record<string, unknown>
  }
  ranking_context: {
    current_target_sound?: string
    approved_effective_cues?: ChildMemorySummaryEntry[]
    recent_engagement_trends?: {
      average_willingness_to_retry?: number | null
      trend?: string | null
      supporting_session_ids?: string[]
    }
    recent_exercise_outcomes?: Array<Record<string, unknown>>
    difficulty_progression?: {
      current_difficulty?: string | null
      desired_difficulty?: string | null
      reason?: string | null
      supporting_session_ids?: string[]
    }
    therapist_constraints?: {
      note?: string
      parsed?: Record<string, unknown>
    }
    institutional_memory?: InstitutionalMemorySnapshot
    approved_memory_item_ids?: string[]
    [key: string]: unknown
  }
  rationale: string
  created_by_user_id?: string | null
  candidate_count: number
  top_recommendation_score?: number | null
  created_at: string
  top_recommendation?: RecommendationSummary | null
}

export interface RecommendationDetail extends RecommendationLog {
  candidates: RecommendationCandidate[]
}

export interface RecommendationRequest {
  source_session_id?: string
  target_sound?: string
  therapist_constraints?: string
  limit?: number
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
