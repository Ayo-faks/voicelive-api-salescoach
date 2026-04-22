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

const childScope: InsightsScope = { type: 'child', child_id: 'child-1' }

describe('InsightsRail', () => {
  beforeEach(() => {
    askInsights.mockReset()
    listInsightsConversations.mockReset()
    getInsightsConversation.mockReset()
    listInsightsConversations.mockResolvedValue({ conversations: [] })
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

    const item = await screen.findByTestId('insights-rail-history-item')
    expect(item.textContent).toContain('Recent progress')
    fireEvent.click(item)
    await waitFor(() => {
      expect(getInsightsConversation).toHaveBeenCalledWith('conv-1')
    })
    const answer = await screen.findByTestId('insights-rail-answer')
    expect(answer.textContent).toContain('Articulation accuracy improved')
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
})
