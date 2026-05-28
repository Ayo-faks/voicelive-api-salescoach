import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SkillLibrary from '../routes/SkillLibrary'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SkillLibrary', () => {
  it('renders the ready library when the catalogue endpoint is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        tenant_id: 'tenant-phase-2',
        query: '',
        skills: [],
        total: 0,
        limit: 100,
        offset: 0,
        lang: 'en-NG',
        provenance: [],
      })
    )

    render(<SkillLibrary />)

    expect(await screen.findByText('Skills Library')).toBeTruthy()
    const label = screen.getByText('Ratio and proportion')
    const focusLabel = screen.getByText('Focus: Ratio Proportion')
    expect(label).toBeTruthy()
    expect(focusLabel).toBeTruthy()
    expect(label).not.toBe(focusLabel)
    expect(label.parentElement?.textContent).not.toContain(
      'Ratio and proportionratio-proportion'
    )
    expect(screen.getByText('Ready catalogue')).toBeTruthy()
  })

  it('renders live catalogue rows when the skills endpoint is hydrated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        tenant_id: 'tenant-phase-2',
        query: '',
        skills: [
          {
            skill_id: 'statistics',
            tenant_id: 'tenant-phase-2',
            standard_id: 'jss2-maths',
            name: 'Statistics',
            description: 'Interpret charts and summary values.',
            subject: 'Mathematics',
            parent_skill_id: null,
            prerequisites: [],
            kc_tags: ['charts'],
            localisations: {},
            year_group_min: 8,
            year_group_max: 8,
            status: 'active',
            lang: 'en-NG',
            provenance: [
              { source: 'seed_skills', confidence: 1, evidence_count: 1 },
            ],
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
        lang: 'en-NG',
        provenance: [
          { source: 'seed_skills', confidence: 1, evidence_count: 1 },
        ],
      })
    )

    render(<SkillLibrary />)

    expect(await screen.findByText('Statistics')).toBeTruthy()
    expect(screen.getByText('Updated catalogue')).toBeTruthy()
  })

  it('filters visible skills by search text', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<SkillLibrary />)

    expect(await screen.findByText('Ratio and proportion')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search skills'), {
      target: { value: 'geometry' },
    })

    await waitFor(() => {
      expect(screen.queryByText('Ratio and proportion')).toBeNull()
      expect(screen.getByText('Plane geometry')).toBeTruthy()
    })
  })
})
