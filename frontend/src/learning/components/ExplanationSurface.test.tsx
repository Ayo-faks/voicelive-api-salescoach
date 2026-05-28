import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExplanationSurface } from './ExplanationSurface'
import type { ExplainResponse } from '../api'

const refusalResponse: ExplainResponse = {
  lang: 'en',
  query: 'photosynthesis',
  subject: null,
  year_group: null,
  hits: [],
  refusal: {
    lang: 'en',
    provenance: [
      {
        source: 'rag:retriever',
        rule_id: 'no_grounding',
        confidence: 1,
        evidence_count: 0,
      },
    ],
    reason: 'no_grounding',
    learner_message: "I couldn't find a wiki source for that — try a different question.",
    suggested_action: 'ask_simpler_question',
  },
  explanation: null,
  similarity_threshold: 0.5,
}

const hitResponse: ExplainResponse = {
  lang: 'en',
  query: 'simplify fractions',
  subject: 'maths',
  year_group: 'JSS3',
  hits: [
    {
      node_id: 'wiki.maths.jss3.fractions.simplify',
      version: '1.0.0',
      title: 'Simplifying fractions',
      subject: 'maths',
      year_group: 'JSS3',
      topic: 'fractions',
      anchor: 'sec-simplify-fractions',
      score: 1.0,
      snippet: 'To simplify a fraction divide the numerator and denominator by their GCD.',
      status: 'approved',
    },
  ],
  refusal: null,
  explanation: null,
  similarity_threshold: 0.5,
}

describe('ExplanationSurface', () => {
  it('submit is disabled until the query is non-empty', () => {
    render(<ExplanationSurface fetcher={vi.fn()} />)
    const btn = screen.getByTestId('explanation-submit') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('renders a refusal card when the backend cannot ground', async () => {
    const fetcher = vi.fn().mockResolvedValue(refusalResponse)
    render(<ExplanationSurface fetcher={fetcher} />)
    fireEvent.change(screen.getByTestId('explanation-input'), {
      target: { value: 'photosynthesis' },
    })
    fireEvent.click(screen.getByTestId('explanation-submit'))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const card = await screen.findByTestId('refusal-card')
    expect(card).toBeTruthy()
    expect(screen.getByTestId('refusal-reason').textContent).toContain('No matching wiki source.')
    expect(screen.getByTestId('refusal-suggestion').textContent).toContain('ask simpler question')
    expect(screen.queryByTestId('hit-card')).toBeNull()
  })

  it('renders grounded hits when the retriever returns matches', async () => {
    const fetcher = vi.fn().mockResolvedValue(hitResponse)
    render(<ExplanationSurface fetcher={fetcher} />)
    fireEvent.change(screen.getByTestId('explanation-input'), {
      target: { value: 'simplify fractions' },
    })
    fireEvent.click(screen.getByTestId('explanation-submit'))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const cards = await screen.findAllByTestId('hit-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-node-id')).toBe('wiki.maths.jss3.fractions.simplify')
    expect(cards[0].textContent).toContain('Simplifying fractions')
    expect(cards[0].textContent).toContain('To simplify a fraction')
    expect(screen.queryByTestId('refusal-card')).toBeNull()
  })

  it('forwards question/skill/subject context to the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(hitResponse)
    render(
      <ExplanationSurface
        fetcher={fetcher}
        questionId="maths-v1-jss3-006"
        skillId="jss3.number.fractions"
        defaultSubject="maths"
        defaultYearGroup="JSS3"
      />,
    )
    fireEvent.change(screen.getByTestId('explanation-input'), {
      target: { value: '  how do I simplify a fraction  ' },
    })
    fireEvent.click(screen.getByTestId('explanation-submit'))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(fetcher).toHaveBeenCalledWith({
      query: 'how do I simplify a fraction',
      question_id: 'maths-v1-jss3-006',
      skill_id: 'jss3.number.fractions',
      subject: 'maths',
      year_group: 'JSS3',
    })
  })

  it('surfaces fetch errors without falling back to a fake answer', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
    render(<ExplanationSurface fetcher={fetcher} />)
    fireEvent.change(screen.getByTestId('explanation-input'), {
      target: { value: 'anything' },
    })
    fireEvent.click(screen.getByTestId('explanation-submit'))
    const err = await screen.findByTestId('explanation-error')
    expect(err.textContent).toContain('boom')
    expect(screen.queryByTestId('hit-card')).toBeNull()
    expect(screen.queryByTestId('refusal-card')).toBeNull()
  })
})
