import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AssistantConfirmationBlock,
  AssistantPlanBlock,
  AssistantProfileBlock,
  AssistantProseBlock,
} from '../../api'
import { AssistantBlockRenderer } from '../AssistantBlockRenderer'

const noop = () => {}

function renderBlock(block: Parameters<typeof AssistantBlockRenderer>[0]['block'], extra = {}) {
  return render(
    <AssistantBlockRenderer
      block={block}
      disabled={false}
      sessionComplete={false}
      onMcqAnswer={noop}
      onAdvance={noop}
      onFinish={noop}
      onConfirm={noop}
      onDismiss={noop}
      {...extra}
    />
  )
}

describe('AssistantBlockRenderer', () => {
  it('renders prose with a defer badge when not grounded and not smalltalk', () => {
    const block: AssistantProseBlock = {
      kind: 'prose',
      speak: '',
      text: 'I have no grounded source for that yet.',
      citations: [],
      grounded: false,
    }
    renderBlock(block)
    const el = screen.getByTestId('assistant-block')
    expect(el.getAttribute('data-block-kind')).toBe('prose')
    expect(screen.getByTestId('assistant-defer-badge')).toBeTruthy()
  })

  it('renders prose without a defer badge for grounded answers and shows citations', () => {
    const block: AssistantProseBlock = {
      kind: 'prose',
      speak: '',
      text: 'Divide both by 2.',
      citations: [{ label: 'Simplifying fractions', topic_id: 'wiki-1' }],
      grounded: true,
    }
    renderBlock(block)
    expect(screen.queryByTestId('assistant-defer-badge')).toBeNull()
    expect(screen.getByText('Simplifying fractions')).toBeTruthy()
  })

  it('renders a profile block with chips and weak topics', () => {
    const block: AssistantProfileBlock = {
      kind: 'profile',
      headline: 'Your snapshot',
      chips: [
        { label: 'Streak', value: '5 days', tone: 'good' },
        { label: 'Weak area', value: 'Algebra', tone: 'warn' },
      ],
      weak_topics: ['Fractions', 'Equations'],
    }
    renderBlock(block)
    const el = screen.getByTestId('assistant-block')
    expect(el.getAttribute('data-block-kind')).toBe('profile')
    expect(screen.getByText('Your snapshot')).toBeTruthy()
    expect(screen.getByText('5 days')).toBeTruthy()
    expect(screen.getByText('Fractions')).toBeTruthy()
  })

  it('renders a plan block with steps', () => {
    const block: AssistantPlanBlock = {
      kind: 'plan',
      headline: "Today's plan",
      steps: [
        { title: 'Warm up', done: true },
        { title: 'Practice fractions' },
      ],
    }
    renderBlock(block)
    const el = screen.getByTestId('assistant-block')
    expect(el.getAttribute('data-block-kind')).toBe('plan')
    expect(screen.getByText('Warm up')).toBeTruthy()
    expect(screen.getByText('Practice fractions')).toBeTruthy()
  })

  it('renders a confirmation block and fires confirm/dismiss callbacks', () => {
    const onConfirm = vi.fn()
    const onDismiss = vi.fn()
    const block: AssistantConfirmationBlock = {
      kind: 'confirmation',
      prompt: 'Start a fractions exercise?',
      confirm_label: 'Start',
      dismiss_label: 'Later',
      action: 'practice',
      params: { skill_id: 'fractions' },
    }
    renderBlock(block, { onConfirm, onDismiss })
    fireEvent.click(screen.getByTestId('assistant-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(block)
    fireEvent.click(screen.getByTestId('assistant-dismiss'))
    expect(onDismiss).toHaveBeenCalledWith(block)
  })

  it('delegates learner-voice card kinds to the card renderer', () => {
    const card = {
      kind: 'mcq-tap' as const,
      card_id: 'c1',
      speak: 'Pick one.',
      stem: 'What is 2 + 2?',
      options: [{ id: 'o1', label: 'A', text: '4' }],
    }
    const onMcqAnswer = vi.fn()
    renderBlock(card as never, { onMcqAnswer })
    expect(screen.getByTestId('practice-card')).toBeTruthy()
    fireEvent.click(screen.getByTestId('practice-option-o1'))
    expect(onMcqAnswer).toHaveBeenCalledWith('o1')
  })
})
