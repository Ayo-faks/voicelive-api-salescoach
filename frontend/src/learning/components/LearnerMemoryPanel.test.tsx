import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearnerMemoryPanel } from './LearnerMemoryPanel'
import * as api from '../api'

function fact(id: string, key: string, value: string, expires?: string) {
  return {
    id,
    tenant_id: 't1',
    student_id: 'learner-1',
    status: 'auto_approved',
    fact: { key, value },
    expires_at: expires ?? null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('LearnerMemoryPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders consent-off state when consent not accepted', async () => {
    vi.spyOn(api, 'getLearnerMemory').mockResolvedValue({
      learner_id: 'learner-1',
      consent: {
        learner_id: 'learner-1',
        accepted: false,
        policy_version: 'v1',
        accepted_at: null,
        withdrawn_at: null,
      },
      facts: [],
      count: 0,
    })
    render(<LearnerMemoryPanel learnerId="learner-1" />)
    await screen.findByText(/Memory is off/i)
  })

  it('renders grouped chips when memory exists', async () => {
    vi.spyOn(api, 'getLearnerMemory').mockResolvedValue({
      learner_id: 'learner-1',
      consent: {
        learner_id: 'learner-1',
        accepted: true,
        accepted_at: '2026-01-01T00:00:00Z',
        withdrawn_at: null,
        policy_version: 'v1',
      },
      facts: [
        fact('f1', 'preferred_subject', 'maths'),
        fact('f2', 'mood', 'good', '2026-01-04T00:00:00Z'),
      ],
      count: 2,
    })
    render(<LearnerMemoryPanel learnerId="learner-1" />)
    await screen.findByText(/Subjects & goals/i)
    expect(screen.getByText(/Mood \(last 3 days\)/i)).toBeTruthy()
    expect(screen.getByText('maths')).toBeTruthy()
    expect(screen.getByText('good')).toBeTruthy()
  })

  it('calls deleteLearnerMemoryFact when chip delete clicked', async () => {
    vi.spyOn(api, 'getLearnerMemory').mockResolvedValue({
      learner_id: 'learner-1',
      consent: {
        learner_id: 'learner-1',
        accepted: true,
        accepted_at: '2026-01-01T00:00:00Z',
        withdrawn_at: null,
        policy_version: 'v1',
      },
      facts: [fact('f1', 'preferred_subject', 'maths')],
      count: 1,
    })
    const del = vi
      .spyOn(api, 'deleteLearnerMemoryFact')
      .mockResolvedValue({ ok: true, fact_id: 'f1' })
    render(<LearnerMemoryPanel learnerId="learner-1" />)
    const btn = await screen.findByRole('button', {
      name: /Delete preferred subject/i,
    })
    fireEvent.click(btn)
    await waitFor(() => expect(del).toHaveBeenCalledWith('f1', 'learner-1'))
  })

  it('renders empty state when consented with zero facts', async () => {
    vi.spyOn(api, 'getLearnerMemory').mockResolvedValue({
      learner_id: 'learner-1',
      consent: {
        learner_id: 'learner-1',
        accepted: true,
        accepted_at: '2026-01-01T00:00:00Z',
        withdrawn_at: null,
        policy_version: 'v1',
      },
      facts: [],
      count: 0,
    })
    render(<LearnerMemoryPanel learnerId="learner-1" />)
    await screen.findByText(/Nothing yet/i)
  })
})
