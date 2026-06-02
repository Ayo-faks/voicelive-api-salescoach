import { fireEvent, render, screen } from '@testing-library/react'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
      text: 'Divide both by 2. (S1)',
      citations: [{ label: 'Simplifying fractions', topic_id: 'wiki-1' }],
      grounded: true,
    }
    renderBlock(block)
    expect(screen.queryByTestId('assistant-defer-badge')).toBeNull()
    // The grounding chip is kid-friendly; the raw source title is hidden from
    // learners and only exposed to grown-ups via the tooltip (`title`).
    const chip = screen.getByTestId('assistant-citation')
    expect(chip.textContent).toContain('Checked')
    expect(chip.getAttribute('title')).toContain('Simplifying fractions')
    // The engineer-facing source title must not appear in the learner-visible text.
    expect(screen.queryByText('Simplifying fractions', { selector: 'p' })).toBeNull()
    // Inline (S1) markers are stripped from the prose shown to learners.
    expect(screen.getByText('Divide both by 2.')).toBeTruthy()
  })

  it('normalizes LaTeX in prose into plain readable text for learners', () => {
    const block: AssistantProseBlock = {
      kind: 'prose',
      speak: '',
      text:
        'The word equation is: carbon dioxide + water \\( \\xrightarrow{light\\ energy,\\ chlorophyll} \\) glucose + oxygen.',
      citations: [{ label: 'Photosynthesis', topic_id: 'wiki-2' }],
      grounded: true,
    }
    renderBlock(block)
    const prose = screen.getByTestId('assistant-block').querySelector('p')
    expect(prose?.textContent).toBe(
      'The word equation is: carbon dioxide + water —(light energy, chlorophyll)→ glucose + oxygen.'
    )
    // No raw LaTeX backslashes or delimiters leak through.
    expect(prose?.textContent).not.toContain('\\')
    expect(prose?.textContent).not.toContain('xrightarrow')
  })

  it('renders chemistry subscripts and math symbols without backslashes', () => {
    const block: AssistantProseBlock = {
      kind: 'prose',
      speak: '',
      text: 'Water is H_2O and \\(6 \\times 2 \\geq 10\\).',
      citations: [{ label: 'Chemistry', topic_id: 'wiki-3' }],
      grounded: true,
    }
    renderBlock(block)
    const prose = screen.getByTestId('assistant-block').querySelector('p')
    expect(prose?.textContent).toBe('Water is H₂O and 6 × 2 ≥ 10.')
    expect(prose?.textContent).not.toContain('\\')
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

describe('AssistantBlockRenderer · prose streaming reveal', () => {
  // The typewriter is disabled under MODE==='test' so the other suites see full
  // text synchronously. Here we opt INTO the animation by stubbing the Vite
  // mode and driving requestAnimationFrame by hand, asserting the answer
  // reveals progressively (caret + data-streaming) and then settles.
  let frames: Array<(t: number) => void>

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reveals grounded prose character by character, then settles', () => {
    vi.stubEnv('MODE', 'development')
    frames = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb as (t: number) => void)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const block: AssistantProseBlock = {
      kind: 'prose',
      speak: '',
      text: 'Divide both by 2.',
      citations: [],
      grounded: true,
    }
    renderBlock(block)

    const el = screen.getByTestId('assistant-block')
    const para = () => el.querySelector('p')?.textContent ?? ''
    // Mid-stream: not yet the full answer, flagged as streaming.
    expect(para().length).toBeLessThan('Divide both by 2.'.length)
    expect(el.getAttribute('data-streaming')).toBe('true')

    // Drive frames forward until the scheduler stops requesting more.
    let now = 0
    let guard = 0
    while (frames.length > 0 && guard < 200) {
      const cb = frames.shift()
      if (!cb) break
      now += 100 // 100ms/frame × 45 chars/sec ≈ 4-5 chars per frame
      act(() => cb(now))
      guard += 1
    }

    expect(para()).toBe('Divide both by 2.')
    expect(el.getAttribute('data-streaming')).toBeNull()
  })
})

