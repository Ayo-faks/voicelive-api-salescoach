import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScenarioList } from './ScenarioList'
import type { Scenario } from '../types'

const scenarios: Scenario[] = [
  {
    id: 'scenario-1',
    name: 'Scenario 1',
    description: 'Practice scenario one',
    exerciseMetadata: {
      type: 'sound_isolation',
      targetSound: 'k',
      targetWords: ['cat'],
      difficulty: 'easy',
      stepNumber: 1,
    },
  },
  {
    id: 'scenario-2',
    name: 'Scenario 2',
    description: 'Practice scenario two',
    exerciseMetadata: {
      type: 'sound_isolation',
      targetSound: 't',
      targetWords: ['top'],
      difficulty: 'medium',
      stepNumber: 2,
    },
  },
]

describe('ScenarioList', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('updates selection before starting a compact child-mode scenario from the card click', () => {
    const handleSelect = vi.fn()
    const handleStartScenario = vi.fn()

    render(
      <ScenarioList
        scenarios={scenarios}
        customScenarios={[]}
        selectedScenario="scenario-1"
        onSelect={handleSelect}
        onStartScenario={handleStartScenario}
        onAddCustomScenario={() => undefined}
        onUpdateCustomScenario={() => undefined}
        onDeleteCustomScenario={() => undefined}
        compactChildMode
        showFooter={false}
      />
    )

    fireEvent.click(screen.getByText('Scenario 2'))

    expect(handleSelect).toHaveBeenCalledWith('scenario-2')
    expect(handleStartScenario).toHaveBeenCalledWith('scenario-2')
  })
})