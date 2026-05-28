import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VoiceAgentFullscreen from './VoiceAgentFullscreen'

const useInsightsVoiceMock = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useInsightsVoice', () => ({
  useInsightsVoice: (args: unknown) => {
    useInsightsVoiceMock(args)
    return {
      voiceState: 'idle',
      start: vi.fn(),
      stop: vi.fn(),
      interrupt: vi.fn(),
      endSession: vi.fn(),
      lastTranscript: '',
      lastAnswer: '',
      lastError: null,
      lastUiSpecs: [],
      lastActionSuggestions: [],
    }
  },
}))

vi.mock('./VoiceAgentDynamicSurface', () => ({
  VoiceAgentDynamicSurface: () => <div data-testid="voice-agent-dynamic-surface" />,
}))

afterEach(() => {
  useInsightsVoiceMock.mockClear()
  cleanup()
})

describe('VoiceAgentFullscreen', () => {
  it('keeps the existing Insights voice hook and default caseload scope', () => {
    render(<VoiceAgentFullscreen open={true} onClose={() => {}} />)

    expect(screen.getByTestId('voice-agent-fullscreen')).toBeTruthy()
    expect(screen.getByTestId('voice-agent-dynamic-surface')).toBeTruthy()
    expect(useInsightsVoiceMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: 'caseload' },
      mode: 'full_duplex',
    }))
  })
})