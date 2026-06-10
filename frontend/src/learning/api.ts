/**
 * Thin fetch wrapper for the `/api/learning/*` endpoints landed in F6.
 *
 * The wrapper deliberately stays dependency-free (no React Query, no Axios) to
 * keep the Phase 0 bundle small and Playwright-friendly. Credentials are
 * included so the existing Flask session cookie (or LOCAL_DEV_AUTH dev cookie)
 * flows through; the API itself does not require auth in the offline-first
 * pilot demo, but we keep parity with `src/services/api.ts`.
 */

export type DiagnosticItemPayload = {
  item_id: string
  skill_id: string
  prompt: string
  item_type: string
  difficulty: number
  lang: string
}

export type MasteryEstimatePayload = {
  kind: 'beta' | 'elo'
  probability: number
  uncertainty: number
  a?: number | null
  b?: number | null
  rating?: number | null
  deviation?: number | null
}

export type ClassMasteryCell = {
  student_id: string
  skill_id: string
  skill_label: string
  probability: number
  uncertainty: number
  status: 'secure' | 'developing' | 'needs_support'
}

export type ClassMasteryResponse = {
  tenant_id: string
  class_id: string
  diagnostic_id: string
  cells: ClassMasteryCell[]
  source: string
}

export type StudentProfileSkill = {
  skill_id: string
  skill_label: string
  probability: number
  uncertainty: number
  kind: string
  status: 'secure' | 'developing' | 'needs_support'
}

export type StudentProfileRecord = {
  id?: string
  item_id?: string
  skill_id?: string
  response_text?: string
  correct?: boolean
  estimate?: MasteryEstimatePayload
  created_at?: string
  [key: string]: unknown
}

export type StudentLearningEvidence = {
  source: string
  summary: string
  skill_id?: string | null
  item_id?: string | null
  correct?: boolean | null
  confidence: number
}

export type StudentLearningInsight = {
  skill_id: string
  skill_label: string
  probability: number
  uncertainty: number
  status: StudentProfileSkill['status']
  evidence: StudentLearningEvidence[]
}

export type VoiceFluencyResult = {
  status: 'available' | 'not_recorded'
  score?: number | null
  label: string
  evidence: string
  captured_at?: string | null
  lang: string
  provenance: Array<{
    source: string
    rule_id?: string | null
    confidence: number
    evidence_count: number
  }>
}

export type StudentProfileResponse = {
  tenant_id: string
  student_id: string
  skills: StudentProfileSkill[]
  strengths: StudentLearningInsight[]
  gaps: StudentLearningInsight[]
  voice_fluency: VoiceFluencyResult
  proposed_student_facts: StudentFactRecord[]
  approved_student_facts: StudentFactRecord[]
  recent_mastery_events: StudentProfileRecord[]
  recent_responses: StudentProfileRecord[]
  xapi_id: string
  audit: AuditEvent
}

export type CatalogueSkill = {
  skill_id: string
  tenant_id: string
  standard_id: string
  name: string
  description?: string | null
  subject?: string | null
  parent_skill_id?: string | null
  prerequisites: string[]
  kc_tags: string[]
  localisations: Record<string, string>
  year_group_min?: number | null
  year_group_max?: number | null
  status: 'active' | 'draft' | 'archived'
  lang: string
  provenance: Array<{
    source: string
    rule_id?: string | null
    confidence: number
    evidence_count: number
  }>
}

export type SkillSearchResponse = {
  tenant_id: string
  query: string
  skills: CatalogueSkill[]
  total: number
  limit: number
  offset: number
  lang: string
  provenance: CatalogueSkill['provenance']
}

export type StartDiagnosticResponse = {
  session_id: string
  diagnostic_id: string
  lang: string
  item: DiagnosticItemPayload | null
  items_remaining: number
  items_total: number
}

export type AnswerDiagnosticResponse = {
  session_id: string
  item_id: string
  correct: boolean
  expected_answer: string | null
  mastery_estimate: MasteryEstimatePayload
  next_item: DiagnosticItemPayload | null
  items_remaining: number
  completed: boolean
  pending_plan: PendingPlanRecord | null
  pending_facts: StudentFactRecord[]
  completion_xapi: Record<string, unknown> | null
}

export type LearnerDailyPlanItemPayload = {
  id: string
  title: string
  meta: string
  minutes: number
  type: 'check-in' | 'practice' | 'exit-ticket'
  skill_id?: string | null
  subject?: string | null
}

export type LearnerWeakTopicPayload = {
  skill_id: string
  label: string
  mastery: number
  gap: string
  next_action: string
}

export type LearnerDailyPlanResponse = {
  student_id: string
  exam: string
  class_year: string
  subject: string
  source: 'mastery' | 'fallback'
  generated_at: string
  today: LearnerDailyPlanItemPayload[]
  weak_topics: LearnerWeakTopicPayload[]
}

export type LearnerCareerSkillPayload = {
  skill_id: string
  label: string
  weight: number
  mastery: number
  is_gap: boolean
}

export type LearnerCareerPathwayPayload = {
  id: string
  title: string
  fit: number
  wage_band: Record<string, unknown>
  wage_source: string
  demand_trend?: string | null
  demand_source: string
  rationale: string
  skills?: LearnerCareerSkillPayload[]
}

export type LearnerCareerPlanResponse = {
  student_id: string
  source: 'mastery' | 'demand'
  career_consent: boolean
  generated_at: string
  pathways: LearnerCareerPathwayPayload[]
}

export type LearnerWeeklyStatsResponse = {
  sessions: { completed: number; target: number }
  streak_days: number
  mastery_delta_pct: number
  mastery_focus_label: string
}

export type ExamPrepSkill = {
  skill_id: string
  label: string
}

export type ExamPrepTopic = {
  id: string
  title: string
  subject: string
  subject_label: string
  topic: string
  topic_label: string
  year: string
  exam: string
  skill_id: string
  diagnostic_id: string
  diagnostic_subject: string
  skill_count: number
  skills: ExamPrepSkill[]
  minutes: number
}

export type ExamPrepSubject = {
  subject: string
  label: string
  topic_count: number
  skill_count: number
  topics: ExamPrepTopic[]
}

export type ExamPrepTopicsResponse = {
  generated_at: string
  subject_count: number
  topic_count: number
  subjects: ExamPrepSubject[]
  topics: ExamPrepTopic[]
}

export type StudentFactPayload = {
  fact_id: string
  tenant_id: string
  class_id: string
  student_id: string
  student_name?: string | null
  key: string
  value: string
  evidence: string
  requires_approval: boolean
  lang: string
  provenance: Array<{
    source: string
    rule_id?: string | null
    confidence: number
    evidence_count: number
  }>
}

export type StudentFactRecord = {
  id: string
  tenant_id: string
  class_id: string
  student_id: string
  created_by_user_id: string
  status: 'draft' | 'pending' | 'approved' | 'edited_approved' | 'rejected'
  fact: StudentFactPayload
  lang: string
  provenance: Array<Record<string, unknown>>
  created_at?: string
  updated_at?: string
  approved_at?: string | null
  decided_by?: string
  decision_reason?: string | null
}

export type StudentFactsResponse = { facts: StudentFactRecord[]; count: number }

export type EditStudentFactEdits = {
  key?: string
  value?: string
  evidence?: string
  student_name?: string
}

export type PendingPlanRecord = {
  id: string
  tenant_id: string
  created_by_user_id: string
  status: string
  plan: {
    plan_id: string
    parent_plan_id?: string | null
    target_skill_ids: string[]
    target_student_ids: string[]
    item_types: string[]
    suggested_resources: string[]
    rationale: string
    requires_approval: boolean
    lang: string
    provenance: Array<{
      source: string
      rule_id?: string | null
      confidence: number
      evidence_count: number
    }>
  }
  lang: string
  provenance: Array<Record<string, unknown>>
  decided_by?: string
  created_at?: string
  updated_at?: string
}

export type ApprovalsResponse = { plans: PendingPlanRecord[]; count: number }

export type AuditEvent = {
  tenant_id: string
  actor_id: string
  label: string
  kind: string
}

export type AuditResponse = { events: AuditEvent[] }

export type PilotKpiCard = {
  label: string
  value: string
  detail: string
}

export type PilotKpiProvenance = {
  source: string
  rule_id?: string | null
  confidence: number
  evidence_count: number
}

export type PilotKpiResponse = {
  source: 'fixture' | 'live'
  tenant_id: string
  week_count: number
  meets_pilot_thresholds: boolean
  cards: PilotKpiCard[]
  lang: string
  provenance: PilotKpiProvenance[]
  report: {
    diagnostic_completion_rate: number
    approved_intervention_rate: number
    provenance_coverage: number
    safety_rate: number
    dsr_turnaround_rate: number
    cost_per_student_gbp: number
    meets_pilot_thresholds: boolean
  }
}

export type DecisionResponse = {
  ok: boolean
  plan_id: string
  edited_plan_id?: string
  action: 'approved' | 'edited_approved' | 'rejected'
  plan?: PendingPlanRecord['plan']
  xapi_id: string
  xapi_statement: Record<string, unknown>
  audit: AuditEvent
}

export type EditLearningPlanEdits = {
  target_skill_ids?: string[]
  target_student_ids?: string[]
  item_types?: string[]
  suggested_resources?: string[]
  rationale?: string
}

export type IntentResponse = {
  plan: PendingPlanRecord['plan']
  queued: boolean
  offline_fallback: string | null
  validated: boolean
  personalization?: {
    approved_student_facts: StudentFactPayload[]
  }
}

export type StudentFactDecisionResponse = {
  ok: boolean
  fact_id: string
  action: 'approved' | 'edited_approved' | 'rejected'
  fact: StudentFactRecord
  decision: Record<string, unknown>
  xapi_id: string
  xapi_statement: Record<string, unknown>
  audit: AuditEvent
}

export type OverrideMasteryResponse = {
  ok: boolean
  student_id: string
  skill_id: string
  estimate: MasteryEstimatePayload
  status: StudentProfileSkill['status']
  xapi_id: string
  audit: AuditEvent
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: string
    try {
      body = await response.text()
    } catch {
      body = ''
    }
    throw new Error(
      `Learning API ${response.status}: ${body || response.statusText}`
    )
  }
  return (await response.json()) as T
}

function withDefaults(init?: RequestInit): RequestInit {
  return {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  }
}

function toSearchParams(query: Record<string, string | undefined>): string {
  const pairs = Object.entries(query).filter(
    ([, value]) => value !== undefined && value !== ''
  )
  return new URLSearchParams(pairs as [string, string][]).toString()
}

export async function startDiagnostic(
  payload: {
    tenant_id?: string
    class_id?: string
    student_id?: string
    teacher_id?: string
    skill_id?: string
    skill_ids?: string[]
    subject?: string
    diagnostic_id?: string
    item_count?: number
  } = {}
): Promise<StartDiagnosticResponse> {
  const response = await fetch(
    '/api/learning/diagnostic/start',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<StartDiagnosticResponse>(response)
}

export async function answerDiagnostic(payload: {
  session_id: string
  item_id: string
  response_text: string
}): Promise<AnswerDiagnosticResponse> {
  const response = await fetch(
    '/api/learning/diagnostic/answer',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<AnswerDiagnosticResponse>(response)
}

export async function getClassMastery(
  query: {
    tenant_id?: string
    class_id?: string
  } = {}
): Promise<ClassMasteryResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/class/mastery?${search}`
    : '/api/learning/class/mastery'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<ClassMasteryResponse>(response)
}

export async function getStudentProfile(
  studentId: string,
  query: { tenant_id?: string; actor_id?: string } = {}
): Promise<StudentProfileResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/students/${encodeURIComponent(studentId)}/profile?${search}`
    : `/api/learning/students/${encodeURIComponent(studentId)}/profile`
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<StudentProfileResponse>(response)
}

export async function fetchLearnerPlan(
  query: { student_id?: string } = {}
): Promise<LearnerDailyPlanResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/learner/plan?${search}`
    : '/api/learning/learner/plan'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<LearnerDailyPlanResponse>(response)
}

export async function fetchLearnerCareers(
  query: { student_id?: string } = {}
): Promise<LearnerCareerPlanResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/learner/careers?${search}`
    : '/api/learning/learner/careers'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<LearnerCareerPlanResponse>(response)
}

export async function fetchWeeklyStats(
  query: { student_id?: string } = {}
): Promise<LearnerWeeklyStatsResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/weekly-stats?${search}`
    : '/api/learning/weekly-stats'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<LearnerWeeklyStatsResponse>(response)
}

export async function fetchExamPrepTopics(): Promise<ExamPrepTopicsResponse> {
  const response = await fetch(
    '/api/learning/exam-prep/topics',
    withDefaults({ method: 'GET' })
  )
  return jsonOrThrow<ExamPrepTopicsResponse>(response)
}

export async function listSkills(
  query: {
    tenant_id?: string
    query?: string
    subject?: string
    status?: string
    limit?: number
    offset?: number
  } = {}
): Promise<SkillSearchResponse> {
  const search = toSearchParams(
    Object.fromEntries(
      Object.entries(query).map(([key, value]) => [
        key,
        value === undefined ? undefined : String(value),
      ])
    )
  )
  const url = search ? `/api/learning/skills?${search}` : '/api/learning/skills'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<SkillSearchResponse>(response)
}

export async function overrideStudentMastery(
  studentId: string,
  payload: {
    skill_id: string
    probability: number
    uncertainty?: number
    reason: string
    tenant_id?: string
    actor_id?: string
  }
): Promise<OverrideMasteryResponse> {
  const response = await fetch(
    `/api/learning/students/${encodeURIComponent(studentId)}/override`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<OverrideMasteryResponse>(response)
}

export async function listPendingApprovals(
  query: {
    tenant_id?: string
    class_id?: string
  } = {}
): Promise<ApprovalsResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/approvals/pending?${search}`
    : '/api/learning/approvals/pending'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<ApprovalsResponse>(response)
}

export async function approveLearningPlan(
  planId: string,
  payload: { actor_id?: string; class_id?: string; reason?: string } = {}
): Promise<DecisionResponse> {
  const response = await fetch(
    `/api/learning/approvals/${encodeURIComponent(planId)}/approve`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<DecisionResponse>(response)
}

export async function rejectLearningPlan(
  planId: string,
  payload: { actor_id?: string; class_id?: string; reason?: string } = {}
): Promise<DecisionResponse> {
  const response = await fetch(
    `/api/learning/approvals/${encodeURIComponent(planId)}/reject`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<DecisionResponse>(response)
}

export async function editAndApproveLearningPlan(
  planId: string,
  payload: {
    actor_id?: string
    class_id?: string
    reason?: string
    edits: EditLearningPlanEdits
  }
): Promise<DecisionResponse> {
  const response = await fetch(
    `/api/learning/approvals/${encodeURIComponent(planId)}/edit-approve`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<DecisionResponse>(response)
}

export async function listPendingStudentFacts(
  query: {
    tenant_id?: string
    class_id?: string
    student_id?: string
  } = {}
): Promise<StudentFactsResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/student-facts/pending?${search}`
    : '/api/learning/student-facts/pending'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<StudentFactsResponse>(response)
}

export async function approveStudentFact(
  factId: string,
  payload: { actor_id?: string; class_id?: string; reason?: string } = {}
): Promise<StudentFactDecisionResponse> {
  const response = await fetch(
    `/api/learning/student-facts/${encodeURIComponent(factId)}/approve`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<StudentFactDecisionResponse>(response)
}

export async function rejectStudentFact(
  factId: string,
  payload: { actor_id?: string; class_id?: string; reason?: string } = {}
): Promise<StudentFactDecisionResponse> {
  const response = await fetch(
    `/api/learning/student-facts/${encodeURIComponent(factId)}/reject`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<StudentFactDecisionResponse>(response)
}

export async function editAndApproveStudentFact(
  factId: string,
  payload: {
    actor_id?: string
    class_id?: string
    reason?: string
    edits: EditStudentFactEdits
  }
): Promise<StudentFactDecisionResponse> {
  const response = await fetch(
    `/api/learning/student-facts/${encodeURIComponent(factId)}/edit-approve`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<StudentFactDecisionResponse>(response)
}

export async function submitIntent(payload: {
  tenant_id?: string
  class_id?: string
  actor_id?: string
  role?: string
  prompt: string
}): Promise<IntentResponse> {
  const response = await fetch(
    '/api/learning/intent',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<IntentResponse>(response)
}

export async function listAudit(
  query: {
    tenant_id?: string
  } = {}
): Promise<AuditResponse> {
  const search = toSearchParams(query)
  const url = search ? `/api/learning/audit?${search}` : '/api/learning/audit'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<AuditResponse>(response)
}

export async function getPilotKpis(
  query: {
    tenant_id?: string
  } = {}
): Promise<PilotKpiResponse> {
  const search = toSearchParams(query)
  const url = search ? `/api/learning/kpis?${search}` : '/api/learning/kpis'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<PilotKpiResponse>(response)
}

export type ObservabilityTileStatus = 'ok' | 'warn' | 'crit' | 'nodata'
export type ObservabilityTileSource = 'live' | 'kql' | 'snapshot' | 'fixture' | 'nodata'

export type ObservabilityTile = {
  id: string
  label: string
  value: string
  detail: string
  status: ObservabilityTileStatus
  source: ObservabilityTileSource
}

export type ObservabilitySection = {
  id: string
  title: string
  tiles: ObservabilityTile[]
}

export type ObservabilityDashboardResponse = {
  generated_at: string
  tenant_id: string
  overall_status: ObservabilityTileStatus
  sections: ObservabilitySection[]
  raw: Record<string, unknown>
}

export async function getObservabilityDashboard(
  query: {
    tenant_id?: string
  } = {}
): Promise<ObservabilityDashboardResponse> {
  const search = toSearchParams(query)
  const url = search
    ? `/api/learning/observability/dashboard?${search}`
    : '/api/learning/observability/dashboard'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<ObservabilityDashboardResponse>(response)
}

// ---------------------------------------------------------------------------
// W3-B — explanation surface
// ---------------------------------------------------------------------------

export type ExplainHit = {
  node_id: string
  version: string
  title: string
  subject: 'maths' | 'english'
  year_group: 'JSS3' | 'SS3' | null
  topic: string
  anchor: string
  score: number
  snippet: string
  status: 'draft' | 'review' | 'approved' | 'frozen' | 'archived'
}

export type ExplainRefusal = {
  lang: string
  provenance: Array<Record<string, unknown>>
  reason: 'no_grounding' | 'safety_block' | 'out_of_scope' | 'rate_limited'
  learner_message: string
  detail?: string | null
  suggested_action?: string | null
}

export type ExplainResponse = {
  lang: string
  query: string
  subject: 'maths' | 'english' | null
  year_group: 'JSS3' | 'SS3' | null
  hits: ExplainHit[]
  refusal: ExplainRefusal | null
  explanation: null // populated in W4 (generator)
  similarity_threshold: number
}

export async function postExplain(payload: {
  query: string
  subject?: 'maths' | 'english'
  year_group?: 'JSS3' | 'SS3'
  question_id?: string
  skill_id?: string
  student_id?: string
  tenant_id?: string
  lang?: string
}): Promise<ExplainResponse> {
  const response = await fetch(
    '/api/learning/explain',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<ExplainResponse>(response)
}

export type VoiceConfigResponse = {
  enabled: boolean
  transport: string
  offline_fallback: string
}

export type VoiceFrameResponse = {
  result_id: string
  accepted: boolean
  queued: boolean
  transport: string
  transcript: string | null
  offline_fallback: string | null
  queue_id: string | null
  lang: string
  provenance: PilotKpiProvenance[]
}

export async function getVoiceConfig(): Promise<VoiceConfigResponse> {
  const response = await fetch(
    '/api/learning/voice/config',
    withDefaults({ method: 'GET' })
  )
  return jsonOrThrow<VoiceConfigResponse>(response)
}

export async function submitVoiceFrame(payload: {
  tenant_id?: string
  actor_id?: string
  mode?: 'text' | 'audio'
  payload: string
  lang?: string
}): Promise<VoiceFrameResponse> {
  const response = await fetch(
    '/api/learning/voice/frame',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<VoiceFrameResponse>(response)
}

// --- Learner voice + gen-UI fullscreen surface -----------------------------

export type LearnerVoiceCardKind =
  | 'greeting'
  | 'mcq-tap'
  | 'explanation'
  | 'progress'
  | 'mark-known'

export interface LearnerVoiceCardBase {
  card_id: string
  kind: LearnerVoiceCardKind
  speak: string
}

export interface LearnerVoiceMcqOption {
  id: string
  label: string
  text: string
}

export interface LearnerVoiceGreetingCard extends LearnerVoiceCardBase {
  kind: 'greeting'
  headline: string
  sub: string
}

export interface LearnerVoiceMcqCard extends LearnerVoiceCardBase {
  kind: 'mcq-tap'
  stem: string
  options: LearnerVoiceMcqOption[]
  skill_id?: string | null
}

export interface LearnerVoiceExplanationCard extends LearnerVoiceCardBase {
  kind: 'explanation'
  title: string
  steps: string[]
  next_action_label: string
}

export interface LearnerVoiceProgressCard extends LearnerVoiceCardBase {
  kind: 'progress'
  completed: number
  total: number
}

export interface LearnerVoiceMarkKnownCard extends LearnerVoiceCardBase {
  kind: 'mark-known'
  prompt: string
  confirm_label: string
}

export type LearnerVoiceCard =
  | LearnerVoiceGreetingCard
  | LearnerVoiceMcqCard
  | LearnerVoiceExplanationCard
  | LearnerVoiceProgressCard
  | LearnerVoiceMarkKnownCard

export interface LearnerVoiceTurnRequest {
  child_id: string
  lang?: string
  last_card_id?: string | null
  last_kind?: LearnerVoiceCardKind | null
  answer_option_id?: string | null
  advance?: boolean
  exam?: string | null
  class_year?: string | null
  subject?: string | null
  /** Optional forced lead skill — the planner leads with it when available. */
  skill_id?: string | null
}

export interface LearnerVoiceTurnResponse {
  card: LearnerVoiceCard
  session_complete: boolean
}

export async function runLearnerVoiceTurn(
  payload: LearnerVoiceTurnRequest
): Promise<LearnerVoiceTurnResponse> {
  const response = await fetch(
    '/api/learning/voice/turn',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<LearnerVoiceTurnResponse>(response)
}

// --- Unified assistant blocks (one brain, any modality) --------------------
//
// The merged voice+chat surface speaks a single output vocabulary: a list of
// `AssistantBlock`s. The learner-voice cards above are members of this union,
// so a practice card and a prose answer render through the same pipeline. The
// only modality difference is the `speak` field — voice TTS reads it, text
// ignores it. Mirrors `backend/src/learning/assistant_blocks.py`.

export interface AssistantCitation {
  label?: string
  url?: string | null
  topic_id?: string | null
}

export interface AssistantProseBlock {
  kind: 'prose'
  speak: string
  text: string
  citations: AssistantCitation[]
  grounded?: boolean | null
  smalltalk?: boolean
}

export interface AssistantProfileChip {
  label: string
  value: string
  tone: 'neutral' | 'good' | 'warn'
}

export interface AssistantProfileBlock {
  kind: 'profile'
  speak?: string
  headline: string
  chips: AssistantProfileChip[]
  weak_topics: string[]
}

export interface AssistantPlanStep {
  title: string
  skill_id?: string | null
  done?: boolean
}

export interface AssistantPlanBlock {
  kind: 'plan'
  speak?: string
  headline: string
  steps: AssistantPlanStep[]
}

export interface AssistantConfirmationBlock {
  kind: 'confirmation'
  speak?: string
  prompt: string
  confirm_label?: string
  dismiss_label?: string
  action?: string | null
  params?: Record<string, unknown>
}

/** Every block the unified assistant can emit, in any modality. */
export type AssistantBlock =
  | LearnerVoiceCard
  | AssistantProseBlock
  | AssistantProfileBlock
  | AssistantPlanBlock
  | AssistantConfirmationBlock

export interface AssistantTurnResult {
  blocks: AssistantBlock[]
  session_complete: boolean
  /** The thread this turn was saved to; echo it back to extend the same thread. */
  conversation_id?: string
}

export interface AssistantThreadTurn {
  role: string
  text: string
}

/** A saved Ask Wulo conversation thread (list view). */
export interface AskConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

/** One persisted message within a saved Ask Wulo thread. */
export interface AskConversationMessage {
  id: string
  role: 'user' | 'assistant'
  text?: string | null
  blocks?: AssistantBlock[]
  session_complete?: boolean
  created_at: string
}

/** The full payload `POST /api/learning/assistant/turn` understands. */
export interface AssistantTurnRequest {
  user_id?: string | null
  child_id?: string | null
  question?: string
  intent?: string | null
  // Practice-walk signals — present means "continue / start an exercise".
  last_card_id?: string | null
  last_kind?: string | null
  answer_option_id?: string | null
  advance?: boolean
  exam?: string | null
  class_year?: string | null
  subject?: string | null
  // Personalisation context (the learner's own data only).
  weak_topics?: Array<{ skill_id?: string; label?: string }>
  daily_plan?: Array<{ id?: string; title?: string }>
  career_fits?: unknown
  last_wrong_answer?: { skill_id?: string; label?: string } | null
  learner_setup?: { subject?: string; year_group?: string } | null
  focus_item?: unknown
  attempt_history?: unknown
  thread?: AssistantThreadTurn[]
  lang?: string
  /** Extend an existing saved thread; omit to start a new one. */
  conversation_id?: string | null
}

/** Text transport: one HTTP turn returning the shared block contract. */

/**
 * Client-side guard so the floating assistant can never spin forever: well
 * over the normal 4–6s grounded answer, but far below the old worst case
 * (60–120s of server-side embedding retries, now also fixed server-side).
 */
export const ASSISTANT_TURN_TIMEOUT_MS = 25_000

/** Thrown when the turn exceeds {@link ASSISTANT_TURN_TIMEOUT_MS}. */
export class AssistantTurnTimeoutError extends Error {
  constructor() {
    super('assistant turn timed out')
    this.name = 'AssistantTurnTimeoutError'
  }
}

export async function runAssistantTurn(
  payload: AssistantTurnRequest,
  opts?: { timeoutMs?: number }
): Promise<AssistantTurnResult> {
  const timeoutMs = opts?.timeoutMs ?? ASSISTANT_TURN_TIMEOUT_MS
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(
      '/api/learning/assistant/turn',
      withDefaults({
        method: 'POST',
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    )
    return await jsonOrThrow<AssistantTurnResult>(response)
  } catch (err) {
    if (controller.signal.aborted) throw new AssistantTurnTimeoutError()
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

/** List a learner's saved Ask Wulo threads, newest first. */
export async function listAskConversations(
  userId: string
): Promise<AskConversationSummary[]> {
  const url = `/api/learning/assistant/conversations?user_id=${encodeURIComponent(userId)}`
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  const result = await jsonOrThrow<{ conversations?: AskConversationSummary[] }>(
    response
  )
  return result.conversations ?? []
}

/** Load one saved Ask Wulo thread with its full message history. */
export async function getAskConversation(
  conversationId: string,
  userId: string
): Promise<{
  conversation: AskConversationSummary
  messages: AskConversationMessage[]
}> {
  const url = `/api/learning/assistant/conversations/${encodeURIComponent(
    conversationId
  )}?user_id=${encodeURIComponent(userId)}`
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow(response)
}

/** Soft-delete a saved Ask Wulo thread. */
export async function deleteAskConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  const url = `/api/learning/assistant/conversations/${encodeURIComponent(
    conversationId
  )}?user_id=${encodeURIComponent(userId)}`
  const response = await fetch(url, withDefaults({ method: 'DELETE' }))
  await jsonOrThrow(response)
}

/** Coarse pacing buckets a learner goal can carry. */
export type GoalTimeframe = 'this_term' | 'this_year' | 'no_deadline'

/** The guided-then-freeform goal a learner states after onboarding. */
export interface GoalRecommendRequest {
  student_id?: string
  subject?: string | null
  exam?: string | null
  target_date?: GoalTimeframe | null
  note?: string | null
}

/**
 * Capture a stated goal and get instant "start here" recommendations. The goal
 * is persisted as an Option A soft bias on the daily plan, and the same shared
 * block contract is returned so voice and text render identically.
 */
export async function recommendFromGoal(
  payload: GoalRecommendRequest
): Promise<AssistantTurnResult> {
  const response = await fetch(
    '/api/learning/goals/recommend',
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<AssistantTurnResult>(response)
}

export interface LearnerVoiceSocketHandlers {
  onConnected?: () => void
  onResult?: (result: AssistantTurnResult) => void
  onError?: (message: string) => void
  onClose?: () => void
}

export interface LearnerVoiceSocket {
  /** Send one turn frame (a `type: 'turn'` envelope is added automatically). */
  send: (frame: Record<string, unknown>) => void
  /** Whether the underlying socket is OPEN and able to deliver a frame. */
  isOpen: () => boolean
  /** Politely say goodbye and close the socket. */
  close: () => void
}

/**
 * Voice transport: open the realtime `/ws/learning-voice` socket. It speaks the
 * exact same brain as {@link runAssistantTurn}; STT (speech→text) and TTS
 * (block.speak→audio) happen at the client edge. Returns a thin sender/closer.
 */
export function openLearnerVoiceSocket(
  handlers: LearnerVoiceSocketHandlers,
  params?: { userId?: string | null }
): LearnerVoiceSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const query = params?.userId
    ? `?user_id=${encodeURIComponent(params.userId)}`
    : ''
  const socket = new WebSocket(
    `${proto}://${window.location.host}/ws/learning-voice${query}`
  )
  // The dev/prod WebSocket server (simple_websocket on Werkzeug) does not always
  // complete the closing handshake — when either side closes, the connection can
  // drop with a 1006 "abnormal closure" that fires `onerror` *before* `onclose`.
  // That is not a failure the learner should ever see, so we only surface a
  // transport error while the socket is genuinely live and not being torn down.
  // Once we (or a clean server `bye`) initiate the close, all subsequent
  // error/close noise is swallowed — this is what kept the "Voice connection
  // hiccup — retrying as you speak" banner stuck on the learner surface.
  let closing = false
  socket.onmessage = event => {
    let message: { type?: string; blocks?: AssistantBlock[]; session_complete?: boolean; message?: string }
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (message.type === 'connected') {
      handlers.onConnected?.()
    } else if (message.type === 'turn.result') {
      handlers.onResult?.({
        blocks: message.blocks ?? [],
        session_complete: Boolean(message.session_complete),
      })
    } else if (message.type === 'bye') {
      // Server acknowledged our goodbye and will now send the WebSocket close
      // frame itself (route calls ws.close(1000)). We must NOT close from our
      // side too — racing close frames on the Werkzeug dev server reset the TCP
      // connection and surface a 1006 "Invalid frame header" console error plus
      // the spurious "connection hiccup" banner. Just mark intent and wait for
      // the server's clean close frame, which the browser auto-acknowledges.
      closing = true
    } else if (message.type === 'error') {
      handlers.onError?.(String(message.message ?? 'error'))
    }
  }
  socket.onclose = () => handlers.onClose?.()
  socket.onerror = () => {
    // Suppress the benign close-race error; only report a real mid-session drop.
    if (closing || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      return
    }
    handlers.onError?.('socket_error')
  }
  return {
    send: frame => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'turn', ...frame }))
      }
    },
    isOpen: () => socket.readyState === WebSocket.OPEN,
    close: () => {
      closing = true
      try {
        if (socket.readyState === WebSocket.OPEN) {
          // Ask the server to say goodbye and close the socket. The server is
          // the sole closer (see the `bye` branch above); we only fall back to
          // a local close if it never acks within a short grace period.
          socket.send(JSON.stringify({ type: 'bye' }))
          window.setTimeout(() => {
            if (
              socket.readyState !== WebSocket.CLOSED &&
              socket.readyState !== WebSocket.CLOSING
            ) {
              socket.close()
            }
          }, 1000)
        } else {
          socket.close()
        }
      } catch {
        socket.close()
      }
    },
  }
}


// --- Voice-agent action API -------------------------------------------------

export interface VoiceAgentActionRecord {
  suggestion_id: string
  action_id: string
  action_type: string
  label: string
  risk_level: 'low' | 'medium' | 'high'
  requires_confirmation: boolean
  parameters: Record<string, unknown>
  rationale: string
  status: string
}

export interface VoiceAgentActionExecutionResult {
  suggestion_id: string
  action_id: string
  action_type: string
  status: 'success' | 'denied' | 'failed' | string
  message: string
  output: Record<string, unknown>
  risk_level: 'low' | 'medium' | 'high'
}

export async function suggestVoiceAction(
  suggestion: Record<string, unknown>
): Promise<VoiceAgentActionRecord> {
  const response = await fetch(
    '/api/insights/voice-actions/suggest',
    withDefaults({ method: 'POST', body: JSON.stringify({ suggestion }) })
  )
  return jsonOrThrow<VoiceAgentActionRecord>(response)
}

export async function confirmVoiceAction(
  suggestionId: string,
  method: 'click' | 'voice' = 'click'
): Promise<VoiceAgentActionRecord> {
  const response = await fetch(
    `/api/insights/voice-actions/${encodeURIComponent(suggestionId)}/confirm`,
    withDefaults({ method: 'POST', body: JSON.stringify({ method }) })
  )
  return jsonOrThrow<VoiceAgentActionRecord>(response)
}

export async function executeVoiceAction(
  suggestionId: string,
  options: { idempotencyKey?: string } = {}
): Promise<VoiceAgentActionExecutionResult> {
  const headers: Record<string, string> = {}
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey
  }
  const response = await fetch(
    `/api/insights/voice-actions/${encodeURIComponent(suggestionId)}/execute`,
    withDefaults({ method: 'POST', body: JSON.stringify({}), headers })
  )
  return jsonOrThrow<VoiceAgentActionExecutionResult>(response)
}
