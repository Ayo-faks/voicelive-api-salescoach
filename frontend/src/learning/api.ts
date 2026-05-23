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
  completion_xapi: Record<string, unknown> | null
}

export type PendingPlanRecord = {
  id: string
  tenant_id: string
  created_by_user_id: string
  status: string
  plan: {
    plan_id: string
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
  action: 'approved' | 'edited_approved' | 'rejected'
  xapi_id: string
  xapi_statement: Record<string, unknown>
  audit: AuditEvent
}

export type IntentResponse = {
  plan: PendingPlanRecord['plan']
  queued: boolean
  offline_fallback: string | null
  validated: boolean
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: string
    try {
      body = await response.text()
    } catch {
      body = ''
    }
    throw new Error(`Learning API ${response.status}: ${body || response.statusText}`)
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

export async function startDiagnostic(payload: {
  tenant_id?: string
  class_id?: string
  student_id?: string
  teacher_id?: string
  skill_id?: string
  item_count?: number
} = {}): Promise<StartDiagnosticResponse> {
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

export async function getClassMastery(query: {
  tenant_id?: string
  class_id?: string
} = {}): Promise<ClassMasteryResponse> {
  const search = new URLSearchParams(query as Record<string, string>).toString()
  const url = search
    ? `/api/learning/class/mastery?${search}`
    : '/api/learning/class/mastery'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<ClassMasteryResponse>(response)
}

export async function listPendingApprovals(query: {
  tenant_id?: string
} = {}): Promise<ApprovalsResponse> {
  const search = new URLSearchParams(query as Record<string, string>).toString()
  const url = search
    ? `/api/learning/approvals/pending?${search}`
    : '/api/learning/approvals/pending'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<ApprovalsResponse>(response)
}

export async function approveLearningPlan(
  planId: string,
  payload: { actor_id?: string; reason?: string } = {}
): Promise<DecisionResponse> {
  const response = await fetch(
    `/api/learning/approvals/${encodeURIComponent(planId)}/approve`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<DecisionResponse>(response)
}

export async function rejectLearningPlan(
  planId: string,
  payload: { actor_id?: string; reason?: string } = {}
): Promise<DecisionResponse> {
  const response = await fetch(
    `/api/learning/approvals/${encodeURIComponent(planId)}/reject`,
    withDefaults({ method: 'POST', body: JSON.stringify(payload) })
  )
  return jsonOrThrow<DecisionResponse>(response)
}

export async function submitIntent(payload: {
  tenant_id?: string
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

export async function listAudit(query: {
  tenant_id?: string
} = {}): Promise<AuditResponse> {
  const search = new URLSearchParams(query as Record<string, string>).toString()
  const url = search ? `/api/learning/audit?${search}` : '/api/learning/audit'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<AuditResponse>(response)
}

export async function getPilotKpis(query: {
  tenant_id?: string
} = {}): Promise<PilotKpiResponse> {
  const search = new URLSearchParams(query as Record<string, string>).toString()
  const url = search ? `/api/learning/kpis?${search}` : '/api/learning/kpis'
  const response = await fetch(url, withDefaults({ method: 'GET' }))
  return jsonOrThrow<PilotKpiResponse>(response)
}
