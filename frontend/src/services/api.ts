/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  Assessment,
  ChildProfile,
  CustomScenarioData,
  CustomScenario,
  ExerciseMetadata,
  Message,
  PilotState,
  PronunciationAssessment,
  SessionDetail,
  SessionSummary,
  Scenario,
  TherapistFeedbackRating,
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
  role: 'therapist' | 'user'
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
  const style = parts.length >= 2 ? parts.slice(1).join('-') : 'casual-sitting'

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

async function fetchWithAuth(input: string, init?: RequestInit): Promise<Response> {
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

let cachedConfig: Record<string, unknown> | null = null
let configPromise: Promise<Record<string, unknown>> | null = null

export const api = {
  async getAuthSession(): Promise<AuthSession> {
    const res = await fetchWithAuth('/api/auth/session')
    if (res.status === 401) throw new Error('UNAUTHORIZED')
    if (!res.ok) throw new Error('Failed to load auth session')
    return res.json()
  },

  async getConfig() {
    if (cachedConfig) return cachedConfig
    if (configPromise) return configPromise
    configPromise = fetchWithAuth('/api/config')
      .then(r => r.json() as Promise<Record<string, unknown>>)
      .then(cfg => {
        cachedConfig = cfg
        return cfg
      })
      .finally(() => {
        configPromise = null
      })
    return configPromise
  },

  async getScenarios(): Promise<Scenario[]> {
    const res = await fetchWithAuth('/api/scenarios')
    return res.json()
  },

  async getChildren(): Promise<ChildProfile[]> {
    const res = await fetchWithAuth('/api/children')
    if (!res.ok) throw new Error('Failed to load child profiles')
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

  async createAgent(scenarioId: string, avatarConfig?: AvatarConfig) {
    const res = await fetchWithAuth('/api/agents/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario_id: scenarioId,
        avatar: avatarConfig,
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
    avatarConfig?: AvatarConfig
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

  async getSession(sessionId: string): Promise<SessionDetail> {
    const res = await fetchWithAuth(`/api/sessions/${sessionId}`)
    if (!res.ok) throw new Error('Failed to load session detail')
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

  async synthesizeSpeech(text: string): Promise<string> {
    const res = await fetchWithAuth('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error('TTS request failed')
    const data = await res.json()
    return data.audio as string
  },
}
