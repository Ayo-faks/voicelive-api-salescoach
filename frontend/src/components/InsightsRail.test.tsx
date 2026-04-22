/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./VisualizationBlock', () => ({
  VisualizationBlock: ({ spec }: { spec: unknown }) => (
    <div data-testid="mock-viz">{JSON.stringify(spec)}</div>
  ),
}))

const askInsights = vi.fn()
const listInsightsConversations = vi.fn()
const getInsightsConversation = vi.fn()

vi.mock('../services/api', () => ({
  api: {
    askInsights: (...args: unknown[]) => askInsights(...args),
    listInsightsConversations: (...args: unknown[]) =>
      listInsightsConversations(...args),
    getInsightsConversation: (...args: unknown[]) =>
      getInsightsConversation(...args),
  },
}))

vi.mock('../hooks/useInsightsVoice', async () => {
  const React = await import('react')
  return {
    useInsightsVoice: () => {
      const [voiceState, setVoiceState] = React.useState('idle')
      return {
        voiceState,
        start: async () => {
          setVoiceState('listening')
        },
        stop: async () => {
          setVoiceState('idle')
        },
        lastTranscript: '',
        lastAnswer: '',
        outputLevel: 0,
      }
    },
  }
})

import { InsightsRail } from './InsightsRail'
import type {
  InsightsAskResponse,
  InsightsConversation,
  InsightsMessage,
  InsightsScope,
} from '../types'

const baseConversation: InsightsConversation = {
  id: 'conv-1',
  user_id: 'user-1',
  workspace_id: null,
  scope_type: 'child',
  scope_child_id: 'child-1',
  scope_session_id: null,
  scope_report_id: null,
  title: 'Recent progress',
  prompt_version: 'insights-v1',
  created_at: '2026-04-22T10:00:00Z',
  updated_at: '2026-04-22T10:05:00Z',
}

const assistantMessage: InsightsMessage = {
  id: 'msg-a',
  conversation_id: 'conv-1',
  role: 'assistant',
  content_text: 'Articulation accuracy improved by 12%.',
  citations: [{ kind: 'session', session_id: 'sess-xyz12345', label: 'Last session' }],
  visualizations: [{ kind: 'line', title: 'Trend', series: [] }],
  tool_trace: [],
  latency_ms: 1200,
  tool_calls_count: 2,
  prompt_version: 'insights-v1',
  error_text: null,
  created_at: '2026-04-22T10:05:00Z',
}

const userMessage: InsightsMessage = {
  id: 'msg-u',
  conversation_id: 'conv-1',
  role: 'user',
  content_text: 'How did they do this week?',
  citations: [],
  visualizations: [],
  tool_trace: [],
  latency_ms: null,
  tool_calls_count: null,
  prompt_version: 'insights-v1',
  error_text: null,
  created_at: '2026-04-22T10:04:00Z',
}

const askResponse: InsightsAskResponse = {
  conversation: baseConversation,
  user_message: userMessage,
  assistant_message: assistantMessage,
  tool_calls_count: 2,
  latency_ms: 1200,
}

const secondUserMessage: InsightsMessage = {
  ...userMessage,
  id: 'msg-u-2',
  content_text: 'What should I focus on next?',
  created_at: '2026-04-22T10:06:00Z',
}

const secondAssistantMessage: InsightsMessage = {
  ...assistantMessage,
  id: 'msg-a-2',
  content_text: 'Focus on short /t/ phrases and quick retries.',
  citations: [],
  visualizations: [],
  created_at: '2026-04-22T10:07:00Z',
}

const childScope: InsightsScope = { type: 'child', child_id: 'child-1' }

describe('InsightsRail', () => {
  beforeEach(() => {
    askInsights.mockReset()
    listInsightsConversations.mockReset()
    getInsightsConversation.mockReset()
    listInsightsConversations.mockResolvedValue({ conversations: [] })
    window.localStorage.clear()
  })

  it('renders scope chips with the current scope active', async () => {
    render(<InsightsRail currentScope={childScope} />)
    const chip = await screen.findByTestId('insights-rail-scope-child')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByTestId('insights-rail-scope-caseload').getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('disables scope chips for missing context', async () => {
    render(<InsightsRail currentScope={{ type: 'caseload' }} />)
    const childChip = (await screen.findByTestId(
      'insights-rail-scope-child',
    )) as HTMLButtonElement
    expect(childChip.disabled).toBe(true)
    const sessionChip = screen.getByTestId(
      'insights-rail-scope-session',
    ) as HTMLButtonElement
    expect(sessionChip.disabled).toBe(true)
  })

  it('sends a question and renders answer, viz, and citations', async () => {
    askInsights.mockResolvedValue(askResponse)
    render(<InsightsRail currentScope={childScope} />)

    const input = (await screen.findByTestId('insights-rail-input')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'How did they do this week?' } })
    fireEvent.click(screen.getByTestId('insights-rail-send'))

    await waitFor(() => {
      expect(askInsights).toHaveBeenCalledTimes(1)
    })
    expect(askInsights.mock.calls[0][0]).toMatchObject({
      message: 'How did they do this week?',
      scope: childScope,
    })

    const answer = await screen.findByTestId('insights-rail-answer')
    expect(answer.textContent).toContain('Articulation accuracy improved')
    expect(screen.getByTestId('insights-rail-visualizations')).toBeTruthy()
    expect(screen.getByTestId('mock-viz')).toBeTruthy()
    expect(screen.getByTestId('insights-rail-citations').textContent).toContain(
      'Last session',
    )
  })

  it('shows an error when the request fails', async () => {
    askInsights.mockRejectedValue(new Error('boom'))
    render(<InsightsRail currentScope={childScope} />)
    const input = (await screen.findByTestId('insights-rail-input')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Hi' } })
    fireEvent.click(screen.getByTestId('insights-rail-send'))
    const err = await screen.findByTestId('insights-rail-error')
    expect(err.textContent).toContain('boom')
  })

  it('renders conversation history and loads a conversation on click', async () => {
    listInsightsConversations.mockResolvedValue({
      conversations: [baseConversation],
    })
    getInsightsConversation.mockResolvedValue({
      conversation: baseConversation,
      messages: [userMessage, assistantMessage],
    })
    render(<InsightsRail currentScope={childScope} />)

    // History now lives behind the "My conversations" menu trigger.
    const trigger = await screen.findByTestId('insights-rail-conversations-menu')
    fireEvent.click(trigger)
    const item = await screen.findByTestId('insights-rail-history-item')
    expect(item.textContent).toContain('Recent progress')
    fireEvent.click(item)
    await waitFor(() => {
      expect(getInsightsConversation).toHaveBeenCalledWith('conv-1')
    })
    const answer = await screen.findByTestId('insights-rail-answer')
    expect(answer.textContent).toContain('Articulation accuracy improved')
    expect(screen.getByTestId('insights-rail-user-message').textContent).toContain(
      'How did they do this week?',
    )
  })

  it('calls onScopeChange when a scope chip is selected', async () => {
    const onScopeChange = vi.fn()
    render(
      <InsightsRail
        currentScope={{ type: 'child', child_id: 'child-1' }}
        onScopeChange={onScopeChange}
      />,
    )
    fireEvent.click(await screen.findByTestId('insights-rail-scope-caseload'))
    expect(onScopeChange).toHaveBeenCalledWith({ type: 'caseload' })
  })

  it('focuses the composer when focusToken changes', async () => {
    const { rerender } = render(
      <InsightsRail currentScope={childScope} focusToken={0} />,
    )
    const input = (await screen.findByTestId(
      'insights-rail-input',
    )) as HTMLTextAreaElement
    expect(document.activeElement).not.toBe(input)
    rerender(<InsightsRail currentScope={childScope} focusToken={1} />)
    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
  })

  it('collapses into a visible side tab that can be reopened', async () => {
    render(<InsightsRail currentScope={childScope} />)

    fireEvent.click(await screen.findByTestId('insights-rail-collapse'))

    await waitFor(() => {
      expect(screen.getByTestId('insights-rail').getAttribute('data-mode')).toBe('collapsed')
    })

    expect(screen.getByTestId('insights-rail-launcher').textContent).toContain('Open chat')
    expect(screen.getByTestId('insights-rail-launcher').textContent).toContain('Ask your data')
    expect(window.localStorage.getItem('wulo.insightsRail.mode')).toBe('collapsed')
  })

  it('can recover from persisted collapsed mode', async () => {
    window.localStorage.setItem('wulo.insightsRail.mode', 'collapsed')

    render(<InsightsRail currentScope={childScope} />)

    const rail = await screen.findByTestId('insights-rail')
    expect(rail.getAttribute('data-mode')).toBe('collapsed')

    fireEvent.click(screen.getByTestId('insights-rail-expand'))

    const input = await screen.findByTestId('insights-rail-input')
    expect(input).toBeTruthy()
    expect(screen.getByTestId('insights-rail-conversations-menu')).toBeTruthy()
    expect(window.localStorage.getItem('wulo.insightsRail.mode')).toBe('normal')
  })

  it('keeps prior turns and renders user/assistant bubbles across multiple sends', async () => {
    askInsights
      .mockResolvedValueOnce(askResponse)
      .mockResolvedValueOnce({
        conversation: baseConversation,
        user_message: secondUserMessage,
        assistant_message: secondAssistantMessage,
        tool_calls_count: 1,
        latency_ms: 900,
      } satisfies InsightsAskResponse)

    render(<InsightsRail currentScope={childScope} />)

    const input = (await screen.findByTestId('insights-rail-input')) as HTMLTextAreaElement

    fireEvent.change(input, { target: { value: 'How did they do this week?' } })
    fireEvent.click(screen.getByTestId('insights-rail-send'))
    await screen.findByText('Articulation accuracy improved by 12%.')

    fireEvent.change(screen.getByTestId('insights-rail-input'), {
      target: { value: 'What should I focus on next?' },
    })
    fireEvent.click(screen.getByTestId('insights-rail-send'))

    await screen.findByText('Focus on short /t/ phrases and quick retries.')

    expect(screen.getAllByTestId('insights-rail-user-message')).toHaveLength(2)
    expect(screen.getAllByTestId('insights-rail-answer')).toHaveLength(2)
    expect(screen.getByTestId('insights-rail-transcript').textContent).toContain(
      'How did they do this week?',
    )
    expect(screen.getByTestId('insights-rail-transcript').textContent).toContain(
      'What should I focus on next?',
    )
    expect(screen.getByTestId('insights-rail-transcript').textContent).toContain('Wulo')
    expect(screen.getByTestId('insights-rail-transcript').textContent).toContain('You')
  })

  it('auto-grows the composer as the message gets longer', async () => {
    render(<InsightsRail currentScope={childScope} />)

    const input = (await screen.findByTestId('insights-rail-input')) as HTMLTextAreaElement
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      get: () => 132,
    })

    fireEvent.change(input, { target: { value: 'This is a much longer question that should grow the composer.' } })

    await waitFor(() => {
      expect(input.style.height).toBe('132px')
      expect(input.style.overflowY).toBe('hidden')
    })
  })

  it('swaps the composer action between Talk to Wulo and send based on draft text', async () => {
    render(<InsightsRail currentScope={childScope} />)

    const input = (await screen.findByTestId('insights-rail-input')) as HTMLTextAreaElement
    const voiceAction = screen.getByTestId('insights-rail-voice-action') as HTMLButtonElement

    expect(voiceAction.title).toBe('Talk to Wulo')
    expect(screen.queryByTestId('insights-rail-send')).toBeNull()

    fireEvent.click(voiceAction)
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'Show me the next step.' } })

    await waitFor(() => {
      expect(screen.getByTestId('insights-rail-send')).toBeTruthy()
    })
    expect(screen.queryByTestId('insights-rail-voice-action')).toBeNull()

    fireEvent.change(input, { target: { value: '   ' } })

    await waitFor(() => {
      expect(screen.getByTestId('insights-rail-voice-action')).toBeTruthy()
    })
    expect(screen.queryByTestId('insights-rail-send')).toBeNull()
  })

  it('renders assistant markdown formatting for richer responses', async () => {
    askInsights.mockResolvedValue({
      ...askResponse,
      assistant_message: {
        ...assistantMessage,
        id: 'msg-a-markdown',
        content_text: '## Highlights\n- Stronger /t/ accuracy\n- Good self-correction',
      },
    } satisfies InsightsAskResponse)

    render(<InsightsRail currentScope={childScope} />)

    const input = (await screen.findByTestId('insights-rail-input')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Summarise progress' } })
    fireEvent.click(screen.getByTestId('insights-rail-send'))

    const answer = await screen.findByTestId('insights-rail-answer')
    expect(answer.querySelector('ul')).toBeTruthy()
    expect(answer.textContent).toContain('Highlights')
    expect(answer.textContent).toContain('Stronger /t/ accuracy')
  })

  it('does not render voice controls when insights voice mode is off', async () => {
    render(<InsightsRail currentScope={childScope} insightsVoiceMode="off" />)

    await screen.findByTestId('insights-rail-input')

    expect(screen.queryByTestId('insights-rail-voice-toggle')).toBeNull()
    expect(screen.queryByTestId('insights-orb')).toBeNull()
  })

  it('renders the voice toggle and mounts the orb in listening state on press', async () => {
    render(<InsightsRail currentScope={childScope} insightsVoiceMode="push_to_talk" />)

    const toggle = await screen.findByTestId('insights-rail-voice-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('insights-orb')).toBeNull()

    fireEvent.click(toggle)

    const orb = await screen.findByTestId('insights-orb')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(orb.getAttribute('data-state')).toBe('listening')
    expect(screen.getByTestId('insights-orb-interrupt').textContent).toContain('Stop voice')
  })

  it('keeps mode-off markup byte-identical to the baseline render', async () => {
    const baseline = render(<InsightsRail currentScope={childScope} />)
    await screen.findByTestId('insights-rail-input')
    const baselineTestIdCount = baseline.container.querySelectorAll('[data-testid]').length
    baseline.unmount()

    const explicitOff = render(
      <InsightsRail currentScope={childScope} insightsVoiceMode="off" />,
    )
    await screen.findByTestId('insights-rail-input')

    expect(explicitOff.container.querySelectorAll('[data-testid]').length).toBe(baselineTestIdCount)
  })
})
