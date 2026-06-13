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
  it('engages live voice from the composer mic, keeping the message bar', async () => {
    renderDrawer()

    const mic = screen.getByTestId('ask-pathfinder-mic')
    fireEvent.click(mic)
    // Voice engages in place: the drawer flips to voice but the message bar
    // (text input) stays — no separate orb screen.
    expect(
      screen.getByTestId('ask-pathfinder-drawer').getAttribute('data-mode')
    ).toBe('voice')
    expect(screen.queryByTestId('ask-pathfinder-input')).not.toBeNull()
    expect(screen.getByText('Tap to talk.')).toBeTruthy()
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
    fireEvent.click(screen.getByTestId('ask-pathfinder-mic'))

    act(() => {
      onBlockCb?.(block, false)
    })

    expect(screen.getByText('VoiceLive reply.')).toBeTruthy()
  })
})
