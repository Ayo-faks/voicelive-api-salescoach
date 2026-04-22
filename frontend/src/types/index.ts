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
  | 'auditory_bombardment'
  | 'word_position_practice'
  | 'structured_conversation'

export type ExerciseDifficulty = 'easy' | 'medium' | 'hard'

export type WordPosition = 'initial' | 'medial' | 'final' | 'all'

export interface MinimalPairItem {
  word_a: string
  word_b: string
}

/**
 * Stage 0 auditory bombardment exemplar. Each entry represents one
 * clinician-approved target-word token that will be played back to the
 * child during the auditory flood beat. `imageAssetId` is a traceability
 * anchor back to `data/images/manifest.json`; the runtime image path is
 * taken from the parallel `ExerciseMetadata.imageAssets[]` array at the
 * same index, so authors MUST keep the two lists in the same order.
 */
export interface ExerciseExemplar {
  word: string
  imageAssetId: string
  audioSource: 'tts' | 'curated'
  position: WordPosition
  ssmlHint?: string
  rate?: string
}

/**
 * Stage 6 `two_word_phrase` exemplar. Each entry is one carrier+target
 * phrase (e.g. "my thumb", "red fish"). Scoring narrows to
 * `targetWord` only; `carrierWord` provides natural co-articulation
 * context. `imageAssetId` anchors to `data/images/manifest.json`
 * (category `phrase_card`). `ssmlTemplate` may contain a
 * `<phoneme>` tag for the target word for TTS modelling during
 * EXPOSE; `rate` controls modelling speed.
 */
export interface PhraseExemplar {
  phraseText: string
  targetWord: string
  carrierWord: string
  targetPosition: 'initial' | 'medial' | 'final'
  imageAssetId: string
  audioSource: 'tts' | 'curated'
  ssmlTemplate?: string
  rate?: string
}

export interface ExerciseMetadata {
  type: ExerciseType
  targetSound: string
  targetWords: string[]
  difficulty: ExerciseDifficulty
  wordPosition?: WordPosition
  errorSound?: string
  repetitionTarget?: number
  masteryThreshold?: number | null
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
  durationSeconds?: number
  exemplars?: ExerciseExemplar[]
  /**
   * Stage 5b `word_position_practice` only. When `'target_only'`, the
   * runtime scoring reference is narrowed to the currently active
   * target word instead of the joined `targetWords` list. Defaults to
   * undefined (existing behaviour — joined list).
   */
  scoreScope?: 'target_only' | 'all_words' | 'target_sound_in_utterance'
  /**
   * Stage 5b `word_position_practice` only. Ordered list of expected
   * substitution errors per target sound (e.g. `['f', 'd']` for TH).
   * Surfaced to the Voice Live personalization block so the avatar can
   * reflect the child's specific error pattern without coaching.
   */
  expectedSubstitutions?: string[]
  /**
   * Stage 5b `word_position_practice` only. Position sub-step marker
   * used by the panel header and intro copy. Mirrors `wordPosition`
   * but is explicit to avoid ambiguity when `wordPosition='all'`.
   */
  subStep?: 'medial' | 'final'
  /**
   * Stage 6 `two_word_phrase` only. Carrier+target frame used to
   * structure phrase exemplars. `adj_noun` (e.g. "red fish"),
   * `poss_noun` (e.g. "my thumb"). Informs intro copy and rendering.
   */
  phraseFrame?: 'adj_noun' | 'poss_noun'
  /**
   * Stage 6 `two_word_phrase` only. Ordered list of phrase exemplars.
   * Runtime advances through them sequentially; scoring narrows to
   * `phrases[i].targetWord` per attempt.
   */
  phrases?: PhraseExemplar[]
  /**
   * Stage 8 `structured_conversation` only. Ordered topic definitions
   * the child picks from during the covert EXPOSE phase. Parallel to
   * `imageAssets[]`: `topics[i].imageAssetId` anchors to the image
   * manifest for traceability, `imageAssets[i]` is the actual runtime
   * image path rendered in the UI.
   */
  topics?: StructuredConversationTopic[]
  /**
   * Stage 8 `structured_conversation` only. Gate for completion:
   * minimum number of target-sound-carrying tokens the child must
   * produce before PERFORM is allowed to complete (paired with
   * `durationFloorSeconds`). Default: 15.
   */
  targetCountGate?: number
  /**
   * Stage 8 `structured_conversation` only. Minimum elapsed seconds in
   * PERFORM before completion is permitted. Default: 120.
   */
  durationFloorSeconds?: number
  /**
   * Stage 8 `structured_conversation` only. Soft wrap-up hint; the
   * avatar should move toward a natural close once this duration has
   * elapsed. Not a hard cutoff.
   */
  durationCeilingSeconds?: number
  /**
   * Stage 8 `structured_conversation` only. Which repair/response
   * strategies the avatar is allowed to use when the child produces a
   * substitution error. `recast_only` is the most conservative;
   * `recast_and_query_and_expansion` matches the broader SLP brief.
   */
  repairPolicy?: 'recast_only' | 'recast_and_query_and_expansion'
  /**
   * Stage 8 `structured_conversation` only. Backend-owned scaffold
   * escalation policy. The frontend merely surfaces the escalation
   * state from `wulo.scaffold_escalate` events; it does not compute
   * the policy itself.
   */
  scaffoldEscalation?: {
    windowSeconds?: number
    minTokensInWindow?: number
    cooldownSeconds?: number
  }
}

/**
 * Stage 8 `structured_conversation` topic card. Authors supply an
 * open-prompt set (used while the child is producing target tokens at
 * a healthy rate) and a target-biased prompt set (used when the
 * backend tally triggers scaffold escalation).
 */
export interface StructuredConversationTopic {
  topicId: string
  title: string
  imageAssetId: string
  openPrompts: string[]
  targetBiasedPrompts: string[]
  suggestedTargetWords: string[]
}

/**
 * Stage 8 `structured_conversation` live tally, pushed from the
 * backend via `wulo.target_tally` events. The frontend treats this
 * purely as read-only state; all mutation flows through
 * `wulo.therapist_override`.
 */
export interface TargetTally {
  correctCount: number
  incorrectCount: number
  totalCount: number
  accuracy: number
  elapsedSeconds: number
  scaffoldEscalated: boolean
  standouts?: string[]
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

export type FamilyIntakeInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'

export interface FamilyIntakeInvitation {
  id: string
  workspace_id: string
  workspace_name?: string | null
  invited_email: string
  invited_by_user_id: string
  invited_by_name?: string | null
  accepted_by_user_id?: string | null
  status: FamilyIntakeInvitationStatus
  created_at: string
  updated_at: string
  responded_at?: string | null
  expires_at?: string | null
  direction: 'incoming' | 'sent'
  email_delivery?: InvitationEmailDelivery | null
}

export type ChildIntakeProposalStatus = 'submitted' | 'approved' | 'rejected'

export interface ChildIntakeProposal {
  id: string
  family_intake_invitation_id: string
  workspace_id: string
  workspace_name?: string | null
  created_by_user_id: string
  created_by_name?: string | null
  reviewed_by_user_id?: string | null
  reviewed_by_name?: string | null
  final_child_id?: string | null
  child_name: string
  date_of_birth?: string | null
  notes?: string | null
  status: ChildIntakeProposalStatus
  submitted_at?: string | null
  reviewed_at?: string | null
  review_note?: string | null
  created_at: string
  updated_at: string
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

export type ProgressReportAudience = 'therapist' | 'parent' | 'school'

export type ProgressReportStatus = 'draft' | 'approved' | 'signed' | 'archived'

export type ProgressReportSource = 'pipeline' | 'ai_insight' | 'manual'

// --- Insights visualization contract (shared with backend visualization_service.py) ---

export type VisualizationKind = 'line' | 'bar' | 'table'

export interface VisualizationChartPoint {
  x: string | number
  y: number
}

export interface VisualizationChartSeries {
  name: string
  points: VisualizationChartPoint[]
}

export interface VisualizationChartSpec {
  kind: 'line' | 'bar'
  title: string
  caption?: string
  x_label?: string
  y_label?: string
  series: VisualizationChartSeries[]
}

export interface VisualizationTableColumn {
  key: string
  label: string
}

export type VisualizationTableCell = string | number | boolean | null

export interface VisualizationTableSpec {
  kind: 'table'
  title: string
  caption?: string
  columns: VisualizationTableColumn[]
  rows: Array<Record<string, VisualizationTableCell>>
}

export type VisualizationSpec = VisualizationChartSpec | VisualizationTableSpec

// --- Insights voice-state contract (mirrors backend insights_voice_state.py) ---

export type InsightsVoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error'

export const INSIGHTS_VOICE_STATES: readonly InsightsVoiceState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'interrupted',
  'error',
] as const

export function isInsightsVoiceState(value: unknown): value is InsightsVoiceState {
  return typeof value === 'string' && (INSIGHTS_VOICE_STATES as readonly string[]).includes(value)
}

export type InsightsVoiceMode = 'off' | 'push_to_talk' | 'full_duplex'

export interface TurnStarted {
  type: 'turn.started'
  turn_id: string
  conversation_id?: string
}

export interface TurnPartialTranscript {
  type: 'turn.partial_transcript'
  text: string
}

export interface TurnFinalTranscript {
  type: 'turn.final_transcript'
  text: string
}

export interface TurnReasoningSummary {
  type: 'turn.reasoning_summary'
  text: string
}

export interface TurnToolStarted {
  type: 'turn.tool_started'
  tool: string
  args?: Record<string, unknown>
}

export interface TurnToolCompleted {
  type: 'turn.tool_completed'
  tool: string
  result?: unknown
}

export interface TurnConfirmationRequired {
  type: 'turn.confirmation_required'
  tool: string
  summary: string
}

export interface TurnDelta {
  type: 'turn.delta'
  text: string
}

export interface TurnCitation {
  type: 'turn.citation'
  item: InsightsCitation
}

export interface TurnAudioChunk {
  type: 'turn.audio_chunk'
  data_b64: string
  format: string
}

export interface TurnCompleted {
  type: 'turn.completed'
  conversation_id: string
  answer_text: string
  citations?: InsightsCitation[]
  visualizations?: VisualizationSpec[]
}

export interface TurnError {
  type: 'turn.error'
  code: string
  message: string
}

export interface TurnInterrupt {
  type: 'turn.interrupt'
}

export interface TurnInterrupted {
  type: 'turn.interrupted'
}

export type InsightsVoiceEnvelope =
  | TurnStarted
  | TurnPartialTranscript
  | TurnFinalTranscript
  | TurnReasoningSummary
  | TurnToolStarted
  | TurnToolCompleted
  | TurnConfirmationRequired
  | TurnDelta
  | TurnCitation
  | TurnAudioChunk
  | TurnCompleted
  | TurnError
  | TurnInterrupt
  | TurnInterrupted

export interface ProgressReportMetric {
  label: string
  value: string
}

export interface ProgressReportSection {
  key: string
  title: string
  narrative?: string | null
  bullets?: string[]
  metrics?: ProgressReportMetric[]
}

export type ReportExportFormat = 'html' | 'pdf'

export interface ProgressReportRedactionOverrides {
  hide_summary_text?: boolean
  hide_overview_metrics?: boolean
  hide_session_list?: boolean
  hide_internal_metadata?: boolean
  hidden_section_keys?: string[]
}

export interface ProgressReportSnapshot {
  child_name?: string | null
  generated_at?: string | null
  session_count?: number
  latest_session_at?: string | null
  average_overall_score?: number | null
  average_accuracy_score?: number | null
  average_pronunciation_score?: number | null
  focus_targets?: string[]
  memory_summary_text?: string | null
  memory_source_item_count?: number | null
  plan_title?: string | null
  plan_status?: string | null
  plan_objective?: string | null
  top_recommendation_name?: string | null
  top_recommendation_rationale?: string | null
}

export interface ProgressReport {
  id: string
  child_id: string
  workspace_id?: string | null
  created_by_user_id: string
  signed_by_user_id?: string | null
  audience: ProgressReportAudience
  report_type: string
  title: string
  status: ProgressReportStatus
  period_start: string
  period_end: string
  included_session_ids: string[]
  snapshot: ProgressReportSnapshot
  sections: ProgressReportSection[]
  redaction_overrides: ProgressReportRedactionOverrides
  summary_text?: string | null
  source?: ProgressReportSource
  created_at: string
  updated_at: string
  approved_at?: string | null
  signed_at?: string | null
  archived_at?: string | null
}

export interface ProgressReportCreateRequest {
  audience: ProgressReportAudience
  title?: string
  report_type?: string
  period_start?: string
  period_end?: string
  included_session_ids?: string[]
  summary_text?: string
  redaction_overrides?: ProgressReportRedactionOverrides
}

export interface ProgressReportUpdateRequest {
  audience?: ProgressReportAudience
  title?: string
  period_start?: string
  period_end?: string
  included_session_ids?: string[]
  summary_text?: string
  sections?: ProgressReportSection[]
  redaction_overrides?: ProgressReportRedactionOverrides
}

export interface ProgressReportSummaryRewriteSuggestion {
  report_id: string
  source_summary_text: string
  suggested_summary_text: string
  review_required: boolean
  draft_only: boolean
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
  insights_rail_enabled?: boolean
  insights_voice_mode?: InsightsVoiceMode
}

// --- Phase 4 Insights Agent ----------------------------------------------

export type InsightsScopeType = 'caseload' | 'child' | 'session' | 'report'

export interface InsightsScope {
  type: InsightsScopeType
  child_id?: string
  session_id?: string
  report_id?: string
}

export interface InsightsCitation {
  kind: string
  child_id?: string
  session_id?: string
  report_id?: string
  plan_id?: string
  memory_item_id?: string
  label?: string
}

export interface InsightsToolTraceEntry {
  name: string
  arguments?: Record<string, unknown>
  result_summary?: string
  error?: string
  duration_ms?: number
}

export interface InsightsMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content_text: string
  citations: InsightsCitation[]
  visualizations: VisualizationSpec[]
  tool_trace: InsightsToolTraceEntry[]
  latency_ms: number | null
  tool_calls_count: number | null
  prompt_version: string | null
  error_text: string | null
  created_at: string
}

export interface InsightsConversation {
  id: string
  user_id: string
  workspace_id: string | null
  scope_type: InsightsScopeType
  scope_child_id: string | null
  scope_session_id: string | null
  scope_report_id: string | null
  title: string | null
  prompt_version: string
  created_at: string
  updated_at: string
}

export interface InsightsAskResponse {
  conversation: InsightsConversation
  user_message: InsightsMessage
  assistant_message: InsightsMessage
  tool_calls_count: number
  latency_ms: number
}

export interface InsightsConversationDetail {
  conversation: InsightsConversation
  messages: InsightsMessage[]
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
