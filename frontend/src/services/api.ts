/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  Assessment,
  AppConfig,
  ChildProfile,
  ChildMemoryItem,
  ChildMemoryProposal,
  ChildInvitation,
  ChildIntakeProposal,
  FamilyIntakeInvitation,
  ParentalConsent,
  ProgressReport,
  ProgressReportCreateRequest,
  ProgressReportSummaryRewriteSuggestion,
  ReportExportFormat,
  ProgressReportUpdateRequest,
  RecommendationDetail,
  RecommendationLog,
  RecommendationRequest,
  ChildMemoryCreateResult,
  ChildMemoryEvidenceLink,
  ChildMemoryReviewResult,
  ChildMemorySummary,
  ChildUiState,
  CustomScenarioData,
  CustomScenario,
  ExerciseMetadata,
  Message,
  PilotState,
  PronunciationAssessment,
  PracticePlan,
  SessionDetail,
  SessionSummary,
  ChildMastery,
  Scenario,
  TherapistFeedbackRating,
  UiState,
  WorkspaceSummary,
  InsightsScope,
  InsightsAskResponse,
  InsightsConversation,
  InsightsConversationDetail,
  ChatAskResponse,
  ChatStreamEvent,
} from '../types'
import { AVATAR_OPTIONS } from '../types'

export interface AvatarConfig {
  character: string
  style: string
  is_photo_avatar: boolean
  voice_name?: string
}

export interface AuthSession {
  authenticated: boolean
  user_id: string
  name: string
  email: string
  provider: string
  role:
    | 'therapist'
    | 'parent'
    | 'admin'
    | 'pending_therapist'
    | 'learner'
    | 'kid'
    | 'student'
    | 'unassigned'
  current_workspace_id?: string | null
  user_workspaces?: WorkspaceSummary[]
  needs_onboarding?: boolean
  is_self_learner?: boolean
}

export type OnboardingIntent = 'learner' | 'parent' | 'teacher'

export type SafeguardingSeverity =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'

export type SafeguardingDirection = 'inbound' | 'outbound'

export interface SafeguardingEvent {
  id: string
  user_id: string | null
  child_id: string | null
  parent_user_id: string | null
  session_id: string | null
  direction: SafeguardingDirection
  severity: SafeguardingSeverity
  categories: string[]
  evidence_quote: string | null
  rationale: string | null
  layer_scores: Record<string, unknown>
  context_window: Array<{ role: string; text: string }>
  created_at: string
  acknowledged_at: string | null
  acknowledged_by: string | null
  action_taken: string | null
  action_notes: string | null
}

export interface LearnerProfile {
  display_name?: string
  exam?: string
  year_group?: string
  age_band?: string
  locale?: string
  country?: string
  subjects?: string[]
  interests?: string[]
  guardian_email?: string
  guardian_relationship?: string
  career_consent?: boolean
  analytics_consent?: boolean
  tour_seen_at?: string | null
  [key: string]: unknown
}

export interface ConsentRecord {
  kind: string
  version: string
  granted: boolean
  recorded_at?: string
}

export interface LearnerProfileResponse {
  profile: LearnerProfile
  consents: ConsentRecord[]
  needs_onboarding: boolean
}

export type LearnerProfilePatch = Partial<LearnerProfile>

export interface ConsentInput {
  kind: string
  version: string
  granted: boolean
}

export function getImageAssetUrl(imagePath: string): string {
  const normalizedPath = imagePath.replace(/^\/+/, '')
  return `/api/images/${normalizedPath}`
}

export function parseAvatarValue(value: string): AvatarConfig {
  const avatarOption = AVATAR_OPTIONS.find(opt => opt.value === value)
  const isPhotoAvatar = avatarOption?.isPhotoAvatar ?? false
  const voiceName = avatarOption?.voiceName

  if (isPhotoAvatar) {
    return {
      character: value.toLowerCase(),
      style: '',
      is_photo_avatar: true,
      voice_name: voiceName,
    }
  }

  const parts = value.split('-')
  const character = parts[0].toLowerCase()
  const style = parts.length >= 2 ? parts.slice(1).join('-') : 'casual'

  return { character, style, is_photo_avatar: false, voice_name: voiceName }
}

type AudioChunk = Record<string, unknown>
type ExerciseMetadataPayload = Partial<ExerciseMetadata> & {
  targetWords?: string[]
  targetSound?: string
  speechLanguage?: string
  childAge?: number
}

type ConversationTurn = Pick<Message, 'role' | 'content'>

function withCredentials(init?: RequestInit): RequestInit {
  return {
    ...init,
    credentials: init?.credentials ?? 'include',
  }
}

async function fetchWithAuth(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, withCredentials(init))

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'))
  }

  return response
}

function buildExerciseContext(
  exercise: Scenario | CustomScenario | null | undefined
) {
  if (!exercise) return undefined

  if ('scenarioData' in exercise) {
    return {
      id: exercise.id,
      name: exercise.name,
      description: exercise.description,
      is_custom: true,
      exerciseMetadata: {
        type: exercise.scenarioData.exerciseType,
        targetSound: exercise.scenarioData.targetSound,
        targetWords: exercise.scenarioData.targetWords,
        difficulty: exercise.scenarioData.difficulty,
        childAge: exercise.scenarioData.childAge,
      },
    }
  }

  return {
    id: exercise.id,
    name: exercise.name,
    description: exercise.description,
    is_custom: Boolean(exercise.is_custom),
    exerciseMetadata: exercise.exerciseMetadata,
  }
}

function extractUserText(conversationMessages: ConversationTurn[]): string {
  return conversationMessages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ')
    .trim()
}

let cachedConfig: AppConfig | null = null
let configPromise: Promise<AppConfig> | null = null

/**
 * Thrown when the SSE chat endpoint is missing (404) or disabled (501). The
 * UI catches this once per turn and falls back to the legacy one-shot
 * `/api/chat/ask` so users still get an answer.
 */
export class StreamUnsupportedError extends Error {
  readonly status: number
  constructor(status: number, message = 'Chat stream not available') {
    super(message)
    this.name = 'StreamUnsupportedError'
    this.status = status
  }
}

const STREAM_EVENT_TYPES = new Set([
  'meta',
  'token',
  'artifacts',
  'done',
  'error',
])

async function* chatStreamIterable(params: {
  message: string
  scope: InsightsScope
  conversationId?: string | null
  signal?: AbortSignal
}): AsyncIterable<ChatStreamEvent> {
  const body: Record<string, unknown> = {
    message: params.message,
    scope: params.scope,
  }
  if (params.conversationId) body.conversation_id = params.conversationId

  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: params.signal,
  })

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw new Error('UNAUTHORIZED')
  }
  if (res.status === 404 || res.status === 501) {
    throw new StreamUnsupportedError(res.status)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(
      data?.error || data?.error_text || `Chat stream failed (${res.status})`
    )
  }
  if (!res.body) {
    throw new StreamUnsupportedError(res.status, 'Stream body missing')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        if (buffer.trim()) {
          const ev = parseSseFrame(buffer)
          if (ev) yield ev
        }
        return
      }
      buffer += decoder.decode(value, { stream: true })
      // SSE frames are separated by a blank line (\n\n or \r\n\r\n).
      let boundary = findFrameBoundary(buffer)
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary)
        // Advance past the boundary's two newlines (length is encoded in the
        // return value via the second element).
        buffer = buffer.slice(boundary + frameBoundaryLength(buffer, boundary))
        const ev = parseSseFrame(rawFrame)
        if (ev) yield ev
        boundary = findFrameBoundary(buffer)
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* noop */
    }
  }
}

function findFrameBoundary(buf: string): number {
  const a = buf.indexOf('\n\n')
  const b = buf.indexOf('\r\n\r\n')
  if (a === -1) return b
  if (b === -1) return a
  return Math.min(a, b)
}

function frameBoundaryLength(buf: string, idx: number): number {
  return buf.startsWith('\r\n\r\n', idx) ? 4 : 2
}

function parseSseFrame(raw: string): ChatStreamEvent | null {
  let eventType = 'message'
  const dataLines: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (!STREAM_EVENT_TYPES.has(eventType) || dataLines.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
  return { type: eventType, data: parsed } as ChatStreamEvent
}

export const api = {
  async getAuthSession(): Promise<AuthSession> {
    const res = await fetchWithAuth('/api/auth/session')
    if (res.status === 401) throw new Error('UNAUTHORIZED')
    if (!res.ok) throw new Error('Failed to load auth session')
    return res.json()
  },

  async claimInviteCode(code: string): Promise<AuthSession> {
    const res = await fetchWithAuth('/api/auth/claim-invite-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Invalid invite code')
    }
    return res.json()
  },

  async chooseRole(intent: OnboardingIntent): Promise<AuthSession> {
    const res = await fetchWithAuth('/api/auth/choose-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Could not save role choice')
    }
    return res.json()
  },

  async createSelfLearner(): Promise<ChildProfile> {
    const res = await fetchWithAuth('/api/learners/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Could not create learner profile')
    }
    return res.json()
  },

  async getLearnerProfile(): Promise<LearnerProfileResponse | null> {
    const res = await fetchWithAuth('/api/learners/me/profile')
    if (res.status === 404) return null
    if (res.status === 401) throw new Error('UNAUTHORIZED')
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to load learner profile')
    }
    return res.json()
  },

  async patchLearnerProfile(
    patch: LearnerProfilePatch
  ): Promise<LearnerProfileResponse> {
    const res = await fetchWithAuth('/api/learners/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Could not update learner profile')
    }
    return res.json()
  },

  async recordConsent(input: ConsentInput): Promise<LearnerProfileResponse> {
    const res = await fetchWithAuth('/api/learners/me/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Could not record consent')
    }
    return res.json()
  },

  async getConfig(): Promise<AppConfig> {
    if (cachedConfig) return cachedConfig
    if (configPromise) return configPromise
    configPromise = fetchWithAuth('/api/config')
      .then(r => r.json() as Promise<AppConfig>)
      .then(cfg => {
        cachedConfig = cfg
        return cfg
      })
      .finally(() => {
        configPromise = null
      })
    return configPromise
  },

  // --- UI state (onboarding-plan-v2 Phase 1) ---
  async getUiState(): Promise<UiState> {
    const res = await fetchWithAuth('/api/me/ui-state')
    if (res.status === 401) throw new Error('UNAUTHORIZED')
    if (!res.ok) throw new Error('Failed to load ui_state')
    const data = (await res.json()) as { ui_state?: UiState }
    return data.ui_state ?? {}
  },

  async patchUiState(patch: UiState): Promise<UiState> {
    const res = await fetchWithAuth('/api/me/ui-state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      const error = new Error(
        data?.error || 'Failed to save ui_state'
      ) as Error & {
        status?: number
        details?: unknown
      }
      error.status = res.status
      error.details = data?.details
      throw error
    }
    const data = (await res.json()) as { ui_state?: UiState }
    return data.ui_state ?? {}
  },

  async resetUiState(): Promise<UiState> {
    const res = await fetchWithAuth('/api/me/ui-state', { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to reset ui_state')
    const data = (await res.json()) as { ui_state?: UiState }
    return data.ui_state ?? {}
  },

  async getChildUiState(childId: string): Promise<ChildUiState> {
    const res = await fetchWithAuth(
      `/api/children/${encodeURIComponent(childId)}/ui-state`
    )
    if (!res.ok) throw new Error('Failed to load child ui_state')
    return res.json()
  },

  async putChildUiState(
    childId: string,
    payload: { exercise_type: string; first_run: boolean }
  ): Promise<void> {
    const res = await fetchWithAuth(
      `/api/children/${encodeURIComponent(childId)}/ui-state`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) throw new Error('Failed to save child ui_state')
  },

  async getScenarios(): Promise<Scenario[]> {
    const res = await fetchWithAuth('/api/scenarios')
    if (res.status === 401) return []
    if (!res.ok) throw new Error('Failed to load scenarios')
    return res.json()
  },

  async getChildren(workspaceId?: string | null): Promise<ChildProfile[]> {
    const params = workspaceId
      ? `?workspace_id=${encodeURIComponent(workspaceId)}`
      : ''
    const res = await fetchWithAuth(`/api/children${params}`)
    if (!res.ok) throw new Error('Failed to load child profiles')
    return res.json()
  },

  async getWorkspaces(): Promise<WorkspaceSummary[]> {
    const res = await fetchWithAuth('/api/workspaces')
    if (!res.ok) throw new Error('Failed to load workspaces')
    return res.json()
  },

  async createWorkspace(payload: { name?: string }): Promise<WorkspaceSummary> {
    const res = await fetchWithAuth('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to create workspace')
    }
    return res.json()
  },

  async createChild(payload: {
    name: string
    date_of_birth?: string
    notes?: string
    workspace_id?: string
  }): Promise<ChildProfile> {
    const res = await fetchWithAuth('/api/children', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to create child profile')
    }
    return res.json()
  },

  async deleteChild(childId: string): Promise<ChildProfile> {
    const res = await fetchWithAuth(`/api/children/${childId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to remove child profile')
    }
    return res.json()
  },

  async getChildInvitations(): Promise<ChildInvitation[]> {
    const res = await fetchWithAuth('/api/invitations')
    if (!res.ok) throw new Error('Failed to load invitations')
    return res.json()
  },

  async createChildInvitation(payload: {
    child_id: string
    invited_email: string
    relationship?: 'parent' | 'therapist'
  }): Promise<ChildInvitation> {
    const res = await fetchWithAuth('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to create invitation')
    }
    return res.json()
  },

  async acceptChildInvitation(invitationId: string): Promise<ChildInvitation> {
    const res = await fetchWithAuth(`/api/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to accept invitation')
    }
    return res.json()
  },

  async declineChildInvitation(invitationId: string): Promise<ChildInvitation> {
    const res = await fetchWithAuth(
      `/api/invitations/${invitationId}/decline`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to decline invitation')
    }
    return res.json()
  },

  async getFamilyIntakeInvitations(): Promise<FamilyIntakeInvitation[]> {
    const res = await fetchWithAuth('/api/family-intake/invitations')
    if (!res.ok) throw new Error('Failed to load family intake invitations')
    return res.json()
  },

  async createFamilyIntakeInvitation(payload: {
    invited_email: string
    workspace_id?: string
  }): Promise<FamilyIntakeInvitation> {
    const res = await fetchWithAuth('/api/family-intake/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(
        data?.error || 'Failed to create family intake invitation'
      )
    }
    return res.json()
  },

  async acceptFamilyIntakeInvitation(
    invitationId: string
  ): Promise<FamilyIntakeInvitation> {
    const res = await fetchWithAuth(
      `/api/family-intake/invitations/${invitationId}/accept`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(
        data?.error || 'Failed to accept family intake invitation'
      )
    }
    return res.json()
  },

  async declineFamilyIntakeInvitation(
    invitationId: string
  ): Promise<FamilyIntakeInvitation> {
    const res = await fetchWithAuth(
      `/api/family-intake/invitations/${invitationId}/decline`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(
        data?.error || 'Failed to decline family intake invitation'
      )
    }
    return res.json()
  },

  async getChildIntakeProposals(): Promise<ChildIntakeProposal[]> {
    const res = await fetchWithAuth('/api/family-intake/proposals')
    if (!res.ok) throw new Error('Failed to load child intake proposals')
    return res.json()
  },

  async createChildIntakeProposals(payload: {
    family_intake_invitation_id: string
    children: Array<{
      child_name: string
      date_of_birth?: string
      notes?: string
    }>
  }): Promise<ChildIntakeProposal[]> {
    const res = await fetchWithAuth('/api/family-intake/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to submit child intake proposals')
    }
    return res.json()
  },

  async getPendingChildIntakeProposals(
    workspaceId?: string
  ): Promise<ChildIntakeProposal[]> {
    const query = workspaceId
      ? `?workspace_id=${encodeURIComponent(workspaceId)}`
      : ''
    const res = await fetchWithAuth(
      `/api/family-intake/proposals/pending${query}`
    )
    if (!res.ok)
      throw new Error('Failed to load pending child intake proposals')
    return res.json()
  },

  async approveChildIntakeProposal(
    proposalId: string,
    review_note?: string
  ): Promise<ChildIntakeProposal> {
    const res = await fetchWithAuth(
      `/api/family-intake/proposals/${proposalId}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_note }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to approve child intake proposal')
    }
    return res.json()
  },

  async rejectChildIntakeProposal(
    proposalId: string,
    review_note?: string
  ): Promise<ChildIntakeProposal> {
    const res = await fetchWithAuth(
      `/api/family-intake/proposals/${proposalId}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_note }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to reject child intake proposal')
    }
    return res.json()
  },

  async resubmitChildIntakeProposal(payload: {
    proposalId: string
    child_name: string
    date_of_birth?: string
    notes?: string
  }): Promise<ChildIntakeProposal> {
    const res = await fetchWithAuth(
      `/api/family-intake/proposals/${payload.proposalId}/resubmit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_name: payload.child_name,
          date_of_birth: payload.date_of_birth,
          notes: payload.notes,
        }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to resubmit child intake proposal')
    }
    return res.json()
  },

  async revokeChildInvitation(invitationId: string): Promise<ChildInvitation> {
    const res = await fetchWithAuth(`/api/invitations/${invitationId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to revoke invitation')
    }
    return res.json()
  },

  async resendChildInvitation(invitationId: string): Promise<ChildInvitation> {
    const res = await fetchWithAuth(`/api/invitations/${invitationId}/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to resend invitation')
    }
    return res.json()
  },

  async getPilotState(): Promise<PilotState> {
    const res = await fetchWithAuth('/api/pilot/state')
    if (!res.ok) throw new Error('Failed to load pilot state')
    return res.json()
  },

  async acknowledgeConsent(): Promise<Partial<PilotState>> {
    const res = await fetchWithAuth('/api/pilot/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error('Failed to save consent acknowledgement')
    return res.json()
  },

  async createAgent(
    scenarioId: string,
    avatarConfig?: AvatarConfig,
    childId?: string
  ) {
    const res = await fetchWithAuth('/api/agents/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario_id: scenarioId,
        avatar: avatarConfig,
        child_id: childId,
      }),
    })
    if (!res.ok) throw new Error('Failed to create agent')
    return res.json()
  },

  /**
   * Create an agent with a custom scenario
   * Transforms the simplified scenario data into the backend format
   */
  async createAgentWithCustomScenario(
    scenarioId: string,
    name: string,
    description: string,
    scenarioData: CustomScenarioData,
    avatarConfig?: AvatarConfig,
    childId?: string
  ) {
    const res = await fetchWithAuth('/api/agents/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        custom_scenario: {
          id: scenarioId,
          name,
          description,
          messages: [{ role: 'system', content: scenarioData.systemPrompt }],
          exercise_metadata: {
            exercise_type: scenarioData.exerciseType,
            target_sound: scenarioData.targetSound,
            target_words: scenarioData.targetWords,
            difficulty: scenarioData.difficulty,
            prompt_text: scenarioData.promptText,
          },
        },
        avatar: avatarConfig,
        child_id: childId,
      }),
    })
    if (!res.ok) throw new Error('Failed to create agent with custom scenario')
    return res.json()
  },

  async deleteAgent(agentId: string) {
    const res = await fetchWithAuth(`/api/agents/${agentId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete agent')
    return res.json()
  },

  async analyzeConversation(
    scenarioId: string,
    transcript: string,
    audioData: AudioChunk[],
    conversationMessages: ConversationTurn[],
    exerciseMetadata?: ExerciseMetadataPayload,
    childId?: string,
    childName?: string,
    exercise?: Scenario | CustomScenario | null,
    sessionStartedAt?: string | null
  ): Promise<Assessment> {
    const referenceText = extractUserText(conversationMessages)

    const res = await fetchWithAuth('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario_id: scenarioId,
        transcript,
        audio_data: audioData,
        reference_text: referenceText,
        exercise_metadata: exerciseMetadata,
        child_id: childId,
        child_name: childName,
        exercise_context: buildExerciseContext(exercise),
        session_started_at: sessionStartedAt,
      }),
    })
    if (!res.ok) throw new Error('Analysis failed')
    return res.json()
  },

  async assessUtterance(
    utterance: AudioChunk[],
    referenceText: string,
    exerciseMetadata?: ExerciseMetadataPayload,
    scenarioId?: string
  ): Promise<PronunciationAssessment | null> {
    const res = await fetchWithAuth('/api/assess-utterance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utterance,
        scenario_id: scenarioId,
        reference_text: referenceText,
        exercise_metadata: exerciseMetadata,
      }),
    })
    if (!res.ok) throw new Error('Utterance scoring failed')
    const data = await res.json()
    return data.pronunciation_assessment
  },
  async getChildSessions(childId: string): Promise<SessionSummary[]> {
    const res = await fetchWithAuth(`/api/children/${childId}/sessions`)
    if (!res.ok) throw new Error('Failed to load session history')
    return res.json()
  },

  async getChildMastery(childId: string): Promise<ChildMastery> {
    const res = await fetchWithAuth(`/api/children/${childId}/mastery`)
    if (!res.ok) throw new Error('Failed to load mastery profile')
    return res.json()
  },

  async getSession(sessionId: string): Promise<SessionDetail> {
    const res = await fetchWithAuth(`/api/sessions/${sessionId}`)
    if (!res.ok) throw new Error('Failed to load session detail')
    return res.json()
  },

  async getChildPlans(childId: string): Promise<PracticePlan[]> {
    const res = await fetchWithAuth(`/api/children/${childId}/plans`)
    if (!res.ok) throw new Error('Failed to load practice plans')
    return res.json()
  },

  async getChildReports(
    childId: string,
    options?: { status?: string; audience?: string; limit?: number }
  ): Promise<ProgressReport[]> {
    const params = new URLSearchParams()
    if (options?.status) params.set('status', options.status)
    if (options?.audience) params.set('audience', options.audience)
    if (options?.limit != null) params.set('limit', String(options.limit))
    const query = params.toString()
    const res = await fetchWithAuth(
      `/api/children/${childId}/reports${query ? `?${query}` : ''}`
    )
    if (!res.ok) throw new Error('Failed to load progress reports')
    return res.json()
  },

  async createChildReport(
    childId: string,
    payload: ProgressReportCreateRequest
  ): Promise<ProgressReport> {
    const res = await fetchWithAuth(`/api/children/${childId}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to create progress report')
    }
    return res.json()
  },

  async getReport(reportId: string): Promise<ProgressReport> {
    const res = await fetchWithAuth(`/api/reports/${reportId}`)
    if (!res.ok) throw new Error('Failed to load progress report')
    return res.json()
  },

  async updateReport(
    reportId: string,
    payload: ProgressReportUpdateRequest
  ): Promise<ProgressReport> {
    const res = await fetchWithAuth(`/api/reports/${reportId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to update progress report')
    }
    return res.json()
  },

  async suggestReportSummaryRewrite(
    reportId: string
  ): Promise<ProgressReportSummaryRewriteSuggestion> {
    const res = await fetchWithAuth(
      `/api/reports/${reportId}/summary-rewrite`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(
        data?.error || 'Failed to generate report summary suggestion'
      )
    }
    return res.json()
  },

  async approveReport(reportId: string): Promise<ProgressReport> {
    const res = await fetchWithAuth(`/api/reports/${reportId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to approve progress report')
    }
    return res.json()
  },

  async signReport(reportId: string): Promise<ProgressReport> {
    const res = await fetchWithAuth(`/api/reports/${reportId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to sign progress report')
    }
    return res.json()
  },

  async archiveReport(reportId: string): Promise<ProgressReport> {
    const res = await fetchWithAuth(`/api/reports/${reportId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to archive progress report')
    }
    return res.json()
  },

  getReportExportUrl(
    reportId: string,
    options?: { download?: boolean; format?: ReportExportFormat }
  ) {
    const params = new URLSearchParams()
    params.set('format', options?.format || 'html')
    if (options?.download) {
      params.set('download', '1')
    }
    return `/api/reports/${reportId}/export?${params.toString()}`
  },

  async getChildMemorySummary(childId: string): Promise<ChildMemorySummary> {
    const res = await fetchWithAuth(`/api/children/${childId}/memory/summary`)
    if (!res.ok) throw new Error('Failed to load child memory summary')
    return res.json()
  },

  async getChildMemoryItems(
    childId: string,
    options?: { status?: string; category?: string; includeEvidence?: boolean }
  ): Promise<ChildMemoryItem[]> {
    const params = new URLSearchParams()
    if (options?.status) params.set('status', options.status)
    if (options?.category) params.set('category', options.category)
    if (options?.includeEvidence) params.set('include_evidence', 'true')
    const query = params.toString()
    const res = await fetchWithAuth(
      `/api/children/${childId}/memory/items${query ? `?${query}` : ''}`
    )
    if (!res.ok) throw new Error('Failed to load child memory items')
    return res.json()
  },

  async getChildMemoryProposals(
    childId: string,
    options?: { status?: string; category?: string; includeEvidence?: boolean }
  ): Promise<ChildMemoryProposal[]> {
    const params = new URLSearchParams()
    if (options?.status) params.set('status', options.status)
    if (options?.category) params.set('category', options.category)
    if (options?.includeEvidence) params.set('include_evidence', 'true')
    const query = params.toString()
    const res = await fetchWithAuth(
      `/api/children/${childId}/memory/proposals${query ? `?${query}` : ''}`
    )
    if (!res.ok) throw new Error('Failed to load child memory proposals')
    return res.json()
  },

  async getChildRecommendations(
    childId: string,
    limit = 10
  ): Promise<RecommendationLog[]> {
    const params = new URLSearchParams()
    params.set('limit', String(limit))
    const res = await fetchWithAuth(
      `/api/children/${childId}/recommendations?${params.toString()}`
    )
    if (!res.ok) throw new Error('Failed to load recommendation history')
    return res.json()
  },

  async generateChildRecommendations(
    childId: string,
    payload: RecommendationRequest
  ): Promise<RecommendationDetail> {
    const res = await fetchWithAuth(
      `/api/children/${childId}/recommendations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to generate recommendations')
    }
    return res.json()
  },

  async getRecommendationDetail(
    recommendationId: string
  ): Promise<RecommendationDetail> {
    const res = await fetchWithAuth(`/api/recommendations/${recommendationId}`)
    if (!res.ok) throw new Error('Failed to load recommendation detail')
    return res.json()
  },

  async getChildMemoryEvidence(
    subjectType: 'item' | 'proposal',
    subjectId: string
  ): Promise<ChildMemoryEvidenceLink[]> {
    const res = await fetchWithAuth(
      `/api/memory/${subjectType}/${subjectId}/evidence`
    )
    if (!res.ok) throw new Error('Failed to load child memory evidence')
    return res.json()
  },

  async createChildMemoryItem(
    childId: string,
    payload: {
      category: string
      statement: string
      memory_type?: string
      detail?: Record<string, unknown>
      confidence?: number
    }
  ): Promise<ChildMemoryCreateResult> {
    const res = await fetchWithAuth(`/api/children/${childId}/memory/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('Failed to create child memory item')
    return res.json()
  },

  async approveChildMemoryProposal(
    proposalId: string,
    note?: string
  ): Promise<ChildMemoryReviewResult> {
    const res = await fetchWithAuth(
      `/api/memory/proposals/${proposalId}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note ? { note } : {}),
      }
    )
    if (!res.ok) throw new Error('Failed to approve child memory proposal')
    return res.json()
  },

  async rejectChildMemoryProposal(
    proposalId: string,
    note?: string
  ): Promise<ChildMemoryReviewResult> {
    const res = await fetchWithAuth(
      `/api/memory/proposals/${proposalId}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note ? { note } : {}),
      }
    )
    if (!res.ok) throw new Error('Failed to reject child memory proposal')
    return res.json()
  },

  async createPracticePlan(payload: {
    child_id: string
    source_session_id: string
    message?: string
  }): Promise<PracticePlan> {
    const res = await fetchWithAuth('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('Failed to create practice plan')
    return res.json()
  },

  async refinePracticePlan(
    planId: string,
    message: string
  ): Promise<PracticePlan> {
    const res = await fetchWithAuth(`/api/plans/${planId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!res.ok) throw new Error('Failed to refine practice plan')
    return res.json()
  },

  async approvePracticePlan(planId: string): Promise<PracticePlan> {
    const res = await fetchWithAuth(`/api/plans/${planId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error('Failed to approve practice plan')
    return res.json()
  },

  async submitSessionFeedback(
    sessionId: string,
    rating: TherapistFeedbackRating,
    note?: string
  ): Promise<SessionDetail> {
    const res = await fetchWithAuth(`/api/sessions/${sessionId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, note }),
    })
    if (!res.ok) throw new Error('Failed to save therapist feedback')
    return res.json()
  },

  async synthesizeSpeech(
    input:
      | string
      | {
          text?: string
          ssml?: string
          phoneme?: string
          alphabet?: string
          fallback_text?: string
          voiceName?: string
        },
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    let body: Record<string, unknown>
    if (typeof input === 'string') {
      body = { text: input }
    } else {
      const payload: Record<string, unknown> = {}
      if (typeof input.text === 'string' && input.text.length > 0) {
        payload.text = input.text
      }
      if (typeof input.ssml === 'string' && input.ssml.length > 0) {
        payload.ssml = input.ssml
      }
      if (typeof input.phoneme === 'string' && input.phoneme.length > 0) {
        payload.phoneme = input.phoneme
        payload.alphabet = input.alphabet ?? 'ipa'
        payload.fallback_text = input.fallback_text ?? 'sound'
      }
      if (typeof input.voiceName === 'string' && input.voiceName.length > 0) {
        payload.voice_name = input.voiceName
      }
      body = payload
    }
    const res = await fetchWithAuth('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    })
    if (!res.ok) throw new Error('TTS request failed')
    const data = await res.json()
    return data.audio as string
  },

  async getParentalConsent(
    childId: string
  ): Promise<{ consent: ParentalConsent | null }> {
    const res = await fetchWithAuth(`/api/children/${childId}/consent`)
    if (!res.ok) throw new Error('Failed to load parental consent')
    return res.json()
  },

  async saveParentalConsent(
    childId: string,
    payload: {
      guardian_name: string
      guardian_email: string
      privacy_accepted: boolean
      terms_accepted: boolean
      ai_notice_accepted: boolean
      personal_data_consent_accepted: boolean
      special_category_consent_accepted: boolean
      parental_responsibility_confirmed: boolean
    }
  ): Promise<ParentalConsent> {
    const res = await fetchWithAuth(`/api/children/${childId}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to save parental consent')
    }
    return res.json()
  },

  async withdrawParentalConsent(
    childId: string
  ): Promise<{ withdrawn: boolean }> {
    const res = await fetchWithAuth(`/api/children/${childId}/consent`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to withdraw consent')
    return res.json()
  },

  async exportChildData(childId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithAuth(`/api/children/${childId}/data-export`)
    if (!res.ok) throw new Error('Failed to export child data')
    return res.json()
  },

  async deleteChildData(childId: string): Promise<{ deleted: boolean }> {
    const res = await fetchWithAuth(`/api/children/${childId}/data`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to delete child data')
    }
    return res.json()
  },

  async askInsights(params: {
    message: string
    scope: InsightsScope
    conversationId?: string | null
  }): Promise<InsightsAskResponse> {
    const body: Record<string, unknown> = {
      message: params.message,
      scope: params.scope,
    }
    if (params.conversationId) body.conversation_id = params.conversationId
    const res = await fetchWithAuth('/api/insights/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to ask insights')
    }
    return res.json()
  },

  async askChat(params: {
    message: string
    scope: InsightsScope
    conversationId?: string | null
  }): Promise<ChatAskResponse> {
    const body: Record<string, unknown> = {
      message: params.message,
      scope: params.scope,
    }
    if (params.conversationId) body.conversation_id = params.conversationId
    const res = await fetchWithAuth('/api/chat/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || data?.error_text || 'Failed to ask chat')
    }
    return res.json()
  },

  chatStream(params: {
    message: string
    scope: InsightsScope
    conversationId?: string | null
    signal?: AbortSignal
  }): AsyncIterable<ChatStreamEvent> {
    return chatStreamIterable(params)
  },

  async listInsightsConversations(
    limit = 50
  ): Promise<{ conversations: InsightsConversation[] }> {
    const res = await fetchWithAuth(
      `/api/insights/conversations?limit=${encodeURIComponent(String(limit))}`
    )
    if (!res.ok) throw new Error('Failed to load insights conversations')
    return res.json()
  },

  async getInsightsConversation(
    conversationId: string
  ): Promise<InsightsConversationDetail> {
    const res = await fetchWithAuth(
      `/api/insights/conversations/${encodeURIComponent(conversationId)}`
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to load conversation')
    }
    return res.json()
  },

  async listSafeguardingEvents(
    status: 'open' | 'acknowledged' | 'all' = 'open',
    limit = 50
  ): Promise<{ events: SafeguardingEvent[] }> {
    const params = new URLSearchParams({
      status,
      limit: String(limit),
    })
    const res = await fetchWithAuth(
      `/api/admin/safeguarding/events?${params.toString()}`
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to load safeguarding events')
    }
    return res.json()
  },

  async acknowledgeSafeguardingEvent(
    eventId: string,
    body: { action_taken: string; action_notes?: string }
  ): Promise<SafeguardingEvent> {
    const res = await fetchWithAuth(
      `/api/admin/safeguarding/events/${encodeURIComponent(eventId)}/acknowledge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to acknowledge event')
    }
    return res.json()
  },
}
