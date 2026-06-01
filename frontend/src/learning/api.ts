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
