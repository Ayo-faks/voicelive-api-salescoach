/**
 * ExplanationSurface — W3-B "explain this for me" surface.
 *
 * MVP §4.1: "no citation, no answer". When the retriever clears the
 * threshold this surface shows the matched wiki sources; otherwise it
 * shows a `RefusalCard`. The body explanation itself is wired in W4
 * (currently `response.explanation === null`); the W3-B contract is just
 * "show grounded sources or refuse, never fabricate".
 *
 * Frontend-only: this component is a new addition, intentionally not
 * mounted in `PathfinderLearnApp` (frozen per MVP §3). The W3-B route
 * file under `routes/` mounts it standalone for the vitest contract.
 */

import { useState } from 'react'
import {
  Button,
  Spinner,
  Text,
  Textarea,
  makeStyles,
} from '@fluentui/react-components'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import {
  postExplain,
  type ExplainHit,
  type ExplainRefusal,
  type ExplainResponse,
} from '../api'

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '20px',
    padding: '20px',
    maxWidth: '760px',
    margin: '0 auto',
    backgroundColor: t.brand.page,
    minHeight: '100vh',
  },
  card: {
    backgroundColor: t.surface.card,
    border: t.surface.hairline,
    borderRadius: t.radius.lg,
    padding: '20px',
    boxShadow: t.surface.cardElevatedShadow,
  },
  inputRow: {
    display: 'grid',
    gap: '12px',
  },
  hit: {
    display: 'grid',
    gap: '6px',
    padding: '14px 16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  hitTitle: {
    fontWeight: 600,
    color: t.brand.text,
  },
  hitMeta: {
    color: t.brand.textTertiary,
    fontSize: '12px',
  },
  refusal: {
    backgroundColor: t.status.warnBg,
    color: t.status.warnFg,
    border: '1px solid #e3d8a0',
    borderRadius: t.radius.md,
    padding: '14px 16px',
    display: 'grid',
    gap: '6px',
  },
  errorBox: {
    backgroundColor: t.status.criticalBg,
    color: t.status.criticalFg,
    border: '1px solid #f3c9c4',
    borderRadius: t.radius.md,
    padding: '12px 14px',
  },
})

export type ExplanationSurfaceProps = {
  /** Override the default fetch client — used by tests. */
  fetcher?: typeof postExplain
  /** Optional question context that the retriever doesn't use yet but
   *  the W4 generator and the xAPI explanation_viewed event will. */
  questionId?: string
  skillId?: string
  defaultSubject?: 'maths' | 'english'
  defaultYearGroup?: 'JSS3' | 'SS3'
}

export function ExplanationSurface(props: ExplanationSurfaceProps) {
  const styles = useStyles()
  const fetcher = props.fetcher ?? postExplain
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<ExplainResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setError('Type a question first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher({
        query: trimmed,
        question_id: props.questionId,
        skill_id: props.skillId,
        subject: props.defaultSubject,
        year_group: props.defaultYearGroup,
      })
      setResponse(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      setResponse(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.shell} data-testid="explanation-surface">
      <div className={styles.card}>
        <Text as="h2" weight="semibold" size={500}>
          Explain this for me
        </Text>
        <Text as="p" size={200} style={{ color: t.brand.textTertiary }}>
          Pathfinder will only answer from the approved wiki. If we can&apos;t
          find a source we&apos;ll say so rather than guess.
        </Text>
        <div className={styles.inputRow} style={{ marginTop: 12 }}>
          <Textarea
            aria-label="explanation query"
            placeholder="e.g. how do I simplify a fraction?"
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            rows={3}
            data-testid="explanation-input"
          />
          <div>
            <Button
              appearance="primary"
              disabled={loading || !query.trim()}
              onClick={submit}
              data-testid="explanation-submit"
            >
              {loading ? 'Asking…' : 'Ask'}
            </Button>
          </div>
        </div>
      </div>

      {loading && (
        <div className={styles.card} data-testid="explanation-loading">
          <Spinner size="tiny" label="Looking up sources…" />
        </div>
      )}

      {error && (
        <div className={styles.errorBox} role="alert" data-testid="explanation-error">
          {error}
        </div>
      )}

      {response && response.refusal && (
        <RefusalBlock refusal={response.refusal} />
      )}

      {response && !response.refusal && response.hits.length > 0 && (
        <HitsBlock hits={response.hits} />
      )}
    </div>
  )
}

function RefusalBlock(props: { refusal: ExplainRefusal }) {
  const styles = useStyles()
  return (
    <div className={styles.refusal} role="status" data-testid="refusal-card">
      <Text weight="semibold" data-testid="refusal-reason">
        {readableReason(props.refusal.reason)}
      </Text>
      <Text>{props.refusal.learner_message}</Text>
      {props.refusal.suggested_action && (
        <Text size={200} data-testid="refusal-suggestion">
          Try: {humaniseAction(props.refusal.suggested_action)}
        </Text>
      )}
    </div>
  )
}

function HitsBlock(props: { hits: ExplainHit[] }) {
  const styles = useStyles()
  return (
    <div style={{ display: 'grid', gap: 12 }} data-testid="hits-block">
      <Text size={200} style={{ color: t.brand.textTertiary }}>
        Found {props.hits.length} grounded source
        {props.hits.length === 1 ? '' : 's'}. A learner-facing explanation will
        be generated from these in the next release.
      </Text>
      {props.hits.map((hit) => (
        <article
          key={`${hit.node_id}#${hit.anchor}`}
          className={styles.hit}
          data-testid="hit-card"
          data-node-id={hit.node_id}
        >
          <div className={styles.hitTitle}>{hit.title}</div>
          <div className={styles.hitMeta}>
            {hit.subject} · {hit.year_group ?? '—'} · {hit.topic} · score{' '}
            {hit.score.toFixed(2)}
          </div>
          <Text>{hit.snippet}</Text>
          <div className={styles.hitMeta}>
            {hit.node_id} v{hit.version} #{hit.anchor}
          </div>
        </article>
      ))}
    </div>
  )
}

function readableReason(reason: ExplainRefusal['reason']): string {
  switch (reason) {
    case 'no_grounding':
      return 'No matching wiki source.'
    case 'safety_block':
      return 'Blocked by the safety filter.'
    case 'out_of_scope':
      return 'Out of scope for this subject.'
    case 'rate_limited':
      return 'Slow down — try again in a moment.'
    default:
      return 'Cannot answer right now.'
  }
}

function humaniseAction(action: string): string {
  return action.replace(/_/g, ' ')
}

export default ExplanationSurface
