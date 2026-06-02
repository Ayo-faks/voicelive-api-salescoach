import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantBlock } from '../api'
import {
  LearnerContext,
  defaultLearnerContext,
  type LearnerContextValue,
} from '../contexts/LearnerContext'

const toggleRecordingMock = vi.fn(async () => undefined)

vi.mock('../hooks/useAskPathfinderVoice', () => ({
  useAskPathfinderVoice: vi.fn(() => ({
    voiceState: 'listening',
    recording: false,
    inputLevel: 0,
    toggleRecording: toggleRecordingMock,
  })),
}))

import AskPathfinder from '../AskPathfinder'

function renderDrawer(overrides: Partial<LearnerContextValue> = {}) {
  const value: LearnerContextValue = { ...defaultLearnerContext, ...overrides }
  render(
    <LearnerContext.Provider value={value}>
      <AskPathfinder voiceLiveEnabled />
    </LearnerContext.Provider>
  )
  fireEvent.click(screen.getByTestId('ask-pathfinder-fab'))
}

describe('AskPathfinder VoiceLive mode', () => {
  it('uses the VoiceLive mic flow when flag is enabled', async () => {
    renderDrawer()

    fireEvent.click(screen.getByTestId('ask-pathfinder-mode-voice'))
    const mic = screen.getByTestId('ask-pathfinder-mic')
    expect(mic).toBeTruthy()

    fireEvent.click(mic)
    expect(toggleRecordingMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Tap to talk.')).toBeTruthy()
    expect(screen.queryByTestId('ask-pathfinder-input')).toBeNull()
  })

  it('renders assistant blocks emitted by VoiceLive hook callbacks', async () => {
    const block: AssistantBlock = {
      kind: 'prose',
      text: 'VoiceLive reply.',
      speak: 'VoiceLive reply.',
      citations: [],
    } as AssistantBlock

    let onBlockCb: ((block: AssistantBlock, sessionComplete: boolean) => void) | null = null
    const { useAskPathfinderVoice } = await import('../hooks/useAskPathfinderVoice')
    vi.mocked(useAskPathfinderVoice).mockImplementationOnce(({ onBlock }) => {
      onBlockCb = onBlock
      return {
        voiceState: 'listening',
        recording: false,
        inputLevel: 0,
        toggleRecording: toggleRecordingMock,
      }
    })

    renderDrawer()
    fireEvent.click(screen.getByTestId('ask-pathfinder-mode-voice'))

    act(() => {
      onBlockCb?.(block, false)
    })

    expect(screen.getByText('VoiceLive reply.')).toBeTruthy()
  })
})
