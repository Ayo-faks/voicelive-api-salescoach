import { makeStyles, mergeClasses } from '@fluentui/react-components'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AssistantBlock,
  AssistantConfirmationBlock,
  AssistantPlanBlock,
  AssistantProfileBlock,
  AssistantProseBlock,
  LearnerVoiceCard,
} from '../api'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

const CARD_KINDS = new Set([
  'greeting',
  'mcq-tap',
  'explanation',
  'progress',
  'mark-known',
])

function isCard(block: AssistantBlock): block is LearnerVoiceCard {
  return CARD_KINDS.has(block.kind)
}

// Friendly, kid-facing label for the grounding chip. The raw source title is
// engineer-facing corpus metadata, so we never show it to a learner — it stays
// available to grown-ups via the chip tooltip (`title`).
const FRIENDLY_CITATION_LABEL = '📖 Checked against your notes'

// Unicode super/subscript tables so chemistry and exponents (H_2O, x^2) read
// naturally instead of leaking raw LaTeX markup to a learner.
const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
  '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽',
  ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}
const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆',
  '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍',
  ')': '₎',
}

// Single-token LaTeX commands → their Unicode equivalent. Each is matched with
// a trailing non-letter guard so e.g. `\to` does not eat the start of `\theta`.
const LATEX_SYMBOLS: Array<[RegExp, string]> = [
  [/\\xrightarrow/g, '→'], // labels handled separately below
  [/\\longrightarrow/g, '→'],
  [/\\Rightarrow/g, '⇒'],
  [/\\rightarrow/g, '→'],
  [/\\to(?![a-zA-Z])/g, '→'],
  [/\\longleftarrow/g, '←'],
  [/\\Leftarrow/g, '⇐'],
  [/\\leftarrow/g, '←'],
  [/\\times(?![a-zA-Z])/g, '×'],
  [/\\div(?![a-zA-Z])/g, '÷'],
  [/\\cdot(?![a-zA-Z])/g, '·'],
  [/\\pm(?![a-zA-Z])/g, '±'],
  [/\\mp(?![a-zA-Z])/g, '∓'],
  [/\\leq(?![a-zA-Z])/g, '≤'],
  [/\\le(?![a-zA-Z])/g, '≤'],
  [/\\geq(?![a-zA-Z])/g, '≥'],
  [/\\ge(?![a-zA-Z])/g, '≥'],
  [/\\neq(?![a-zA-Z])/g, '≠'],
  [/\\ne(?![a-zA-Z])/g, '≠'],
  [/\\approx(?![a-zA-Z])/g, '≈'],
  [/\\equiv(?![a-zA-Z])/g, '≡'],
  [/\\propto(?![a-zA-Z])/g, '∝'],
  [/\\infty(?![a-zA-Z])/g, '∞'],
  [/\\degree(?![a-zA-Z])/g, '°'],
  [/\\circ(?![a-zA-Z])/g, '°'],
  [/\\alpha(?![a-zA-Z])/g, 'α'],
  [/\\beta(?![a-zA-Z])/g, 'β'],
  [/\\theta(?![a-zA-Z])/g, 'θ'],
  [/\\pi(?![a-zA-Z])/g, 'π'],
  [/\\Delta(?![a-zA-Z])/g, 'Δ'],
  [/\\sum(?![a-zA-Z])/g, '∑'],
]

function toScript(input: string, table: Record<string, string>): string {
  let mapped = ''
  for (const ch of input) {
    mapped += table[ch] ?? ch
  }
  return mapped
}

// Convert the LaTeX a learner-facing model sometimes emits into plain, readable
// text. The chat has no math typesetter, so without this the raw `\(`,
// `\xrightarrow{...}`, escaped spaces, etc. show up as ugly backslashes.
function normalizeLearnerMath(text: string): string {
  let out = text

  // Arrows that carry a condition above them, e.g.
  // `\xrightarrow{light energy, chlorophyll}` → ` —(light energy, chlorophyll)→ `.
  const arrowLabel = (label: string): string =>
    label
      .replace(/\\[,;:!]/g, ' ')
      .replace(/\\ /g, ' ')
      .replace(/\\[a-zA-Z]+/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  out = out.replace(/\\xrightarrow\s*\{([^}]*)\}/g, (_m, label: string) => {
    const clean = arrowLabel(label)
    return clean ? ` —(${clean})→ ` : ' → '
  })
  out = out.replace(/\\xleftarrow\s*\{([^}]*)\}/g, (_m, label: string) => {
    const clean = arrowLabel(label)
    return clean ? ` ←(${clean})— ` : ' ← '
  })

  // Structural commands.
  out = out.replace(/\\(?:d|t)?frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1/$2')
  out = out.replace(/\\sqrt\s*\{([^}]*)\}/g, '√($1)')
  out = out.replace(
    /\\(?:text|mathrm|mathbf|mathit|mathsf|operatorname)\s*\{([^}]*)\}/g,
    '$1'
  )

  // Single-token symbols.
  for (const [pattern, replacement] of LATEX_SYMBOLS) {
    out = out.replace(pattern, replacement)
  }

  // Super/subscripts: braced first, then a single bare token.
  out = out.replace(/\^\{([^}]*)\}/g, (_m, s: string) => toScript(s, SUPERSCRIPTS))
  out = out.replace(/\^(\w)/g, (_m, s: string) => toScript(s, SUPERSCRIPTS))
  out = out.replace(/_\{([^}]*)\}/g, (_m, s: string) => toScript(s, SUBSCRIPTS))
  out = out.replace(/_(\w)/g, (_m, s: string) => toScript(s, SUBSCRIPTS))

  // Inline math delimiters: \( \) \[ \] and $…$ / $$…$$.
  out = out.replace(/\\[()[\]]/g, '')
  out = out.replace(/\${1,2}/g, '')

  // Escaped spaces and punctuation LaTeX uses for spacing/escaping.
  out = out.replace(/\\[,;:!]/g, ' ')
  out = out.replace(/\\ /g, ' ')
  out = out.replace(/\\([%&#_{}$])/g, '$1')

  // Any leftover lone backslash before a word (unknown command) — drop the
  // slash but keep the word so meaning survives.
  out = out.replace(/\\(?=[a-zA-Z])/g, '')

  return out
}

// Strip the LLM-authored inline source tags like "(S1)", "(S1, S2)" or "[S2]"
// from the prose shown to learners. The grounding requirement is enforced in
// the backend, so removing the academic-looking markers is purely cosmetic and
// does not weaken the "no citation, no answer" guarantee.
function stripSourceMarkers(text: string): string {
  return normalizeLearnerMath(text)
    .replace(/\s*[([]\s*S\d+(?:\s*,\s*S\d+)*\s*[)\]]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,!?;:])/g, '$1')
    .trim()
}

/**
 * Renders a short, single-line piece of learner-facing text (a question stem,
 * prompt, etc.) with inline Markdown emphasis (`*frugal*` → frugal) and the
 * same LaTeX/source-marker cleanup the prose path uses. The block wrapper is
 * collapsed to a `<span>` so it stays inline inside the card's own `<p>`.
 * This is display-only — the spoken `speak` field is normalized separately and
 * must never be routed through here.
 */
export function InlineMarkdown({ text }: { text: string }): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
        em: ({ children }) => <em>{children}</em>,
        strong: ({ children }) => <strong>{children}</strong>,
      }}
    >
      {stripSourceMarkers(text)}
    </ReactMarkdown>
  )
}

const useStyles = makeStyles({
  prose: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '16px 18px',
    borderRadius: '18px',
    border: '1px solid var(--scrim-card-line)',
    background: 'var(--scrim-card)',
    color: 'var(--scrim-fg)',
    fontSize: '15px',
    lineHeight: 1.55,
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  proseDeferred: {
    borderTopColor: 'rgba(255,196,84,0.35)',
    borderRightColor: 'rgba(255,196,84,0.35)',
    borderBottomColor: 'rgba(255,196,84,0.35)',
    borderLeftColor: 'rgba(255,196,84,0.35)',
  },
  proseText: {
    margin: 0,
    display: 'grid',
    gap: '8px',
  },
  markdownParagraph: {
    margin: 0,
  },
  markdownList: {
    marginTop: 0,
    marginBottom: 0,
    paddingLeft: '20px',
    display: 'grid',
    gap: '5px',
  },
  markdownListItem: {
    paddingLeft: '2px',
  },
  markdownStrong: {
    fontWeight: 800,
    color: 'var(--scrim-fg-strong)',
  },
  caret: {
    display: 'inline-block',
    width: '2px',
    height: '1.05em',
    marginLeft: '1px',
    verticalAlign: 'text-bottom',
    background: 'currentColor',
    opacity: 0.7,
    animationName: {
      '0%, 45%': { opacity: 0.7 },
      '50%, 95%': { opacity: 0 },
      '100%': { opacity: 0.7 },
    },
    animationDuration: '900ms',
    animationIterationCount: 'infinite',
  },
  deferBadge: {
    alignSelf: 'flex-start',
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    // Theme-aware warn colours so the badge reads clearly on BOTH the light
    // Ask Wulo drawer and the dark fullscreen scrim. The previous hardcoded
    // light-amber-on-transparent was near-invisible on the white drawer.
    color: 'var(--pf-status-warn-fg)',
    background:
      'color-mix(in srgb, var(--pf-status-warn-fg) 16%, transparent)',
    border: '1px solid color-mix(in srgb, var(--pf-status-warn-fg) 55%, transparent)',
  },
  citations: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '4px',
  },
  citation: {
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: 'var(--scrim-fg-soft)',
    background: 'var(--scrim-chip)',
    border: '1px solid var(--scrim-line-strong)',
    textDecoration: 'none',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '20px',
    borderRadius: '20px',
    border: '1px solid var(--scrim-card-line)',
    background: 'var(--scrim-card)',
    color: 'var(--scrim-fg)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  speak: {
    margin: 0,
    fontSize: '14px',
    fontStyle: 'italic',
    color: 'var(--scrim-fg-soft)',
  },
  headline: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--scrim-fg-strong)',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
  },
  chip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderRadius: '14px',
    background: 'var(--scrim-chip)',
    border: '1px solid var(--scrim-line)',
    minWidth: '92px',
  },
  chipGood: {
    borderTopColor: 'rgba(120,224,143,0.35)',
    borderRightColor: 'rgba(120,224,143,0.35)',
    borderBottomColor: 'rgba(120,224,143,0.35)',
    borderLeftColor: 'rgba(120,224,143,0.35)',
    background: 'rgba(120,224,143,0.08)',
  },
  chipWarn: {
    borderTopColor: 'rgba(255,196,84,0.35)',
    borderRightColor: 'rgba(255,196,84,0.35)',
    borderBottomColor: 'rgba(255,196,84,0.35)',
    borderLeftColor: 'rgba(255,196,84,0.35)',
    background: 'rgba(255,196,84,0.08)',
  },
  chipLabel: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: 'var(--scrim-fg-muted)',
  },
  chipValue: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--scrim-fg-strong)',
  },
  weakTopics: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  weakTopic: {
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: '#ffce7a',
    background: 'rgba(255,196,84,0.1)',
    border: '1px solid rgba(255,196,84,0.25)',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '15px',
    color: 'var(--scrim-fg)',
  },
  stepDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--scrim-fg-muted)',
    flexShrink: 0,
  },
  stepDone: {
    color: 'var(--scrim-fg-muted)',
    textDecoration: 'line-through',
  },
  confirmRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  confirmPrompt: {
    margin: 0,
    fontSize: '16px',
    color: 'var(--scrim-fg-strong)',
  },
  confirmBtn: {
    padding: '10px 18px',
    borderRadius: '999px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'var(--scrim-mic-bg)',
    color: '#ffffff',
    ':disabled': { opacity: 0.5, cursor: 'wait' },
  },
  dismissBtn: {
    background: 'transparent',
    border: '1px solid var(--scrim-line-strong)',
    color: 'var(--scrim-fg-soft)',
  },
})

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Whether the typewriter reveal should run. We only animate in environments
 * that expose `matchMedia` and a frame scheduler (real browsers) and where the
 * learner has not asked for reduced motion. Under the unit-test runner and in
 * SSR/jsdom environments without those primitives we show the full answer
 * immediately so assertions see the complete, already-screened text.
 */
function shouldAnimateReveal(): boolean {
  if (import.meta.env.MODE === 'test') {
    return false
  }
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    typeof window.requestAnimationFrame === 'function' &&
    !prefersReducedMotion()
  )
}

/**
 * Reveal `full` one character at a time so a freshly-arrived grounded answer
 * visibly "streams in" instead of popping in whole. The text itself is the
 * complete, already safety-screened answer from the backend; we only animate
 * how much of it is on screen, so no unscreened token ever reaches the learner.
 *
 * `animate` is the caller's verdict on freshness: only the turn that just
 * arrived from the live transport should type in. Restored transcripts —
 * localStorage rehydrate, resuming a saved thread from history, reopening the
 * drawer — pass `animate={false}` and render instantly, so opening an old
 * session never replays every answer. Honours `prefers-reduced-motion` (and
 * test/SSR environments) by showing the whole answer immediately.
 */
function useTypewriter(
  full: string,
  animate: boolean,
): { shown: string; done: boolean } {
  const [count, setCount] = useState(() =>
    animate && shouldAnimateReveal() ? 0 : full.length,
  )
  const fullRef = useRef(full)
  fullRef.current = full

  useEffect(() => {
    if (!animate || !shouldAnimateReveal()) {
      setCount(full.length)
      return
    }
    setCount(0)
    let raf = 0
    let last = 0
    // ~45 chars/sec feels like brisk typing without dragging on long answers.
    const charsPerMs = 45 / 1000
    const tick = (now: number) => {
      if (last === 0) last = now
      const delta = now - last
      last = now
      setCount((prev) => {
        const next = Math.min(
          fullRef.current.length,
          prev + Math.max(1, Math.round(delta * charsPerMs)),
        )
        if (next < fullRef.current.length) {
          raf = requestAnimationFrame(tick)
        }
        return next
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [full, animate])

  return { shown: full.slice(0, count), done: count >= full.length }
}

function ProseBlockView({
  block,
  animate,
}: {
  block: AssistantProseBlock
  animate: boolean
}): JSX.Element {
  const styles = useStyles()
  const deferred = block.grounded === false && block.smalltalk !== true
  const fullText = stripSourceMarkers(block.text)
  const { shown, done } = useTypewriter(fullText, animate)
  return (
    <div
      className={mergeClasses(styles.prose, deferred && styles.proseDeferred)}
      data-testid="assistant-block"
      data-block-kind="prose"
      data-streaming={done ? undefined : 'true'}
    >
      {deferred ? (
        <span className={styles.deferBadge} data-testid="assistant-defer-badge">
          No grounded source
        </span>
      ) : null}
      <div className={styles.proseText}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <p className={styles.markdownParagraph}>{children}</p>
            ),
            ul: ({ children }) => (
              <ul className={styles.markdownList}>{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className={styles.markdownList}>{children}</ol>
            ),
            li: ({ children }) => (
              <li className={styles.markdownListItem}>{children}</li>
            ),
            strong: ({ children }) => (
              <strong className={styles.markdownStrong}>{children}</strong>
            ),
          }}
        >
          {shown}
        </ReactMarkdown>
        {!done ? (
          <span className={styles.caret} aria-hidden="true" />
        ) : null}
      </div>
      {block.citations.length > 0 ? (
        <div className={styles.citations}>
          <span
            className={styles.citation}
            data-testid="assistant-citation"
            title={block.citations
              .map(
                (citation) =>
                  citation.label ?? citation.topic_id ?? citation.url ?? 'source',
              )
              .join(', ')}
          >
            {FRIENDLY_CITATION_LABEL}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function ProfileBlockView({
  block,
}: {
  block: AssistantProfileBlock
}): JSX.Element {
  const styles = useStyles()
  return (
    <div
      className={styles.card}
      data-testid="assistant-block"
      data-block-kind="profile"
    >
      {block.speak ? <p className={styles.speak}>{block.speak}</p> : null}
      <h3 className={styles.headline}>{block.headline}</h3>
      {block.chips.length > 0 ? (
        <div className={styles.chips}>
          {block.chips.map((chip, index) => (
            <div
              key={`${chip.label}-${index}`}
              className={mergeClasses(
                styles.chip,
                chip.tone === 'good' && styles.chipGood,
                chip.tone === 'warn' && styles.chipWarn
              )}
            >
              <span className={styles.chipLabel}>{chip.label}</span>
              <span className={styles.chipValue}>{chip.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {block.weak_topics.length > 0 ? (
        <div className={styles.weakTopics}>
          {block.weak_topics.map(topic => (
            <span key={topic} className={styles.weakTopic}>
              {topic}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PlanBlockView({ block }: { block: AssistantPlanBlock }): JSX.Element {
  const styles = useStyles()
  return (
    <div
      className={styles.card}
      data-testid="assistant-block"
      data-block-kind="plan"
    >
      {block.speak ? <p className={styles.speak}>{block.speak}</p> : null}
      <h3 className={styles.headline}>{block.headline}</h3>
      <ul className={styles.steps}>
        {block.steps.map((step, index) => (
          <li
            key={`${step.title}-${index}`}
            className={mergeClasses(styles.step, step.done && styles.stepDone)}
          >
            <span className={styles.stepDot} />
            {step.title}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConfirmationBlockView({
  block,
  disabled,
  onConfirm,
  onDismiss,
}: {
  block: AssistantConfirmationBlock
  disabled: boolean
  onConfirm: (block: AssistantConfirmationBlock) => void
  onDismiss: (block: AssistantConfirmationBlock) => void
}): JSX.Element {
  const styles = useStyles()
  return (
    <div
      className={styles.card}
      data-testid="assistant-block"
      data-block-kind="confirmation"
    >
      {block.speak ? <p className={styles.speak}>{block.speak}</p> : null}
      <p className={styles.confirmPrompt}>{block.prompt}</p>
      <div className={styles.confirmRow}>
        <button
          type="button"
          className={styles.confirmBtn}
          disabled={disabled}
          onClick={() => onConfirm(block)}
          data-testid="assistant-confirm"
        >
          {block.confirm_label ?? 'Yes'}
        </button>
        <button
          type="button"
          className={mergeClasses(styles.confirmBtn, styles.dismissBtn)}
          disabled={disabled}
          onClick={() => onDismiss(block)}
          data-testid="assistant-dismiss"
        >
          {block.dismiss_label ?? 'Not now'}
        </button>
      </div>
    </div>
  )
}

export interface AssistantBlockRendererProps {
  block: AssistantBlock
  disabled: boolean
  sessionComplete: boolean
  /**
   * Whether a prose block should type itself in. Defaults to true (a lone
   * block is presumed live); transcript hosts pass false for restored turns so
   * reopening a saved session renders instantly instead of replaying.
   */
  animate?: boolean
  onMcqAnswer: (optionId: string) => void
  onAdvance: () => void
  onFinish: () => void
  onConfirm: (block: AssistantConfirmationBlock) => void
  onDismiss: (block: AssistantConfirmationBlock) => void
}

/**
 * Renders one assistant block. The five learner-voice cards delegate to the
 * existing {@link LearnerVoiceCardRenderer}; prose/profile/plan/confirmation
 * are rendered here. This is the single seam the merged voice+chat surface
 * uses, so both transports produce identical UI.
 */
export function AssistantBlockRenderer({
  block,
  disabled,
  sessionComplete,
  animate = true,
  onMcqAnswer,
  onAdvance,
  onFinish,
  onConfirm,
  onDismiss,
}: AssistantBlockRendererProps): JSX.Element | null {
  if (isCard(block)) {
    return (
      <LearnerVoiceCardRenderer
        card={block}
        disabled={disabled}
        sessionComplete={sessionComplete}
        onMcqAnswer={onMcqAnswer}
        onAdvance={onAdvance}
        onFinish={onFinish}
      />
    )
  }
  if (block.kind === 'prose') {
    return <ProseBlockView block={block} animate={animate} />
  }
  if (block.kind === 'profile') {
    return <ProfileBlockView block={block} />
  }
  if (block.kind === 'plan') {
    return <PlanBlockView block={block} />
  }
  if (block.kind === 'confirmation') {
    return (
      <ConfirmationBlockView
        block={block}
        disabled={disabled}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    )
  }
  return null
}

export default AssistantBlockRenderer
