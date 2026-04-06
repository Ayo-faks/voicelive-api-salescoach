import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'

describe('api createAgent payloads', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('includes child_id when creating a server-backed agent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ agent_id: 'agent-1' }),
    } as Response)

    await api.createAgent('scenario-1', { character: 'meg', style: 'casual', is_photo_avatar: false }, 'child-2')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agents/create')
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      scenario_id: 'scenario-1',
      avatar: { character: 'meg', style: 'casual', is_photo_avatar: false },
      child_id: 'child-2',
    })
  })

  it('includes child_id when creating a custom scenario agent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ agent_id: 'agent-1' }),
    } as Response)

    await api.createAgentWithCustomScenario(
      'custom-1',
      'Custom',
      'Desc',
      {
        systemPrompt: 'Prompt',
        exerciseType: 'word_repetition',
        targetSound: 's',
        targetWords: ['sun'],
        difficulty: 'easy',
        promptText: 'Say sun',
      },
      { character: 'meg', style: 'casual', is_photo_avatar: false },
      'child-2'
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agents/create')
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        avatar: { character: 'meg', style: 'casual', is_photo_avatar: false },
        child_id: 'child-2',
      })
    )
  })
})