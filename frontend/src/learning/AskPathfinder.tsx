/**
 * Ask Pathfinder FAB + Drawer — unified assistant entry-point for learners.
 *
 * Replaces the standalone Career Navigator. Phase 1 is text-only and hits the
 * deterministic `/api/learning/assistant/ask` backend. Phase 2 (see
 * `/memories/repo/pathfinder-ask-assistant-phase2.md`) plugs the disabled mic
 * button into the existing voice frame pipeline.
 */
import { useCallback, useState, type FormEvent } from 'react'
import { makeStyles, mergeClasses } from '@fluentui/react-components'
import {
  ChatBubbleLeftRightIcon,
  MicrophoneIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { useLearnerContext } from './contexts/LearnerContext'

type Citation = {
  label?: string
  url?: string
  topic_id?: string
}

type TranscriptEntry =
  | { role: 'user'; text: string; id: string }
  | {
      role: 'assistant'
      text: string
      citations: Citation[]
      grounded?: boolean
      id: string
    }

const useStyles = makeStyles({
  fab: {
    position: 'fixed',
    right: '24px',
    bottom: '168px',
    zIndex: 40,
    width: '60px',
    height: '60px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    background: 'linear-gradient(160deg, #3a3a3c 0%, #0a0a0a 100%)',
    boxShadow:
      '0 12px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.18)',
    transition:
      'transform .18s cubic-bezier(0.2, 0.8, 0.2, 1), filter .15s ease',
    ':hover': {
      filter: 'brightness(1.08)',
      transform: 'translateY(-2px) scale(1.04)',
    },
    ':active': { transform: 'scale(0.92)' },
    '@media (max-width: 1000px)': {
      bottom: '216px',
      right: '16px',
      width: '54px',
      height: '54px',
    },
  },
  fabGlyph: { width: '24px', height: '24px' },
  drawer: {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: 50,
    width: 'min(420px, calc(100vw - 48px))',
    height: 'min(640px, calc(100vh - 80px))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: '18px',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
    background: '#0d0d0f',
    color: '#f4f4f6',
    '@media (max-width: 700px)': {
      right: '0',
      left: '0',
      bottom: '0',
      width: '100vw',
      height: '85vh',
      borderRadius: '18px 18px 0 0',
    },
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  title: { fontWeight: 600, fontSize: '15px' },
  closeBtn: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: '#cfcfd4',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { background: 'rgba(255,255,255,0.06)' },
  },
  closeGlyph: { width: '18px', height: '18px' },
  transcript: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    fontSize: '14px',
    lineHeight: 1.45,
  },
  msgUser: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    padding: '8px 12px',
    borderRadius: '12px 12px 4px 12px',
    background: '#2a2a2e',
  },
  msgAssistant: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    padding: '10px 12px',
    borderRadius: '12px 12px 12px 4px',
    background: '#16161a',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  msgAssistantDeferred: {
    borderTopColor: 'rgba(243, 197, 86, 0.35)',
    borderRightColor: 'rgba(243, 197, 86, 0.35)',
    borderBottomColor: 'rgba(243, 197, 86, 0.35)',
    borderLeftColor: 'rgba(243, 197, 86, 0.35)',
    borderTopStyle: 'dashed',
    borderRightStyle: 'dashed',
    borderBottomStyle: 'dashed',
    borderLeftStyle: 'dashed',
    background: 'rgba(243, 197, 86, 0.06)',
  },
  deferBadge: {
    display: 'inline-block',
    marginBottom: '6px',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: '#f3c556',
    background: 'rgba(243, 197, 86, 0.12)',
  },
  citations: {
    marginTop: '6px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    fontSize: '12px',
    color: '#a8a8b0',
  },
  citation: {
    padding: '2px 8px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.06)',
  },
  empty: { color: '#8a8a91', fontStyle: 'italic' },
  composer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    padding: '10px 12px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  textarea: {
    flex: 1,
    background: '#16161a',
    color: '#f4f4f6',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '14px',
    resize: 'none',
    minHeight: '36px',
    maxHeight: '120px',
    outline: 'none',
    ':focus': {
      borderTopColor: 'rgba(255,255,255,0.18)',
      borderRightColor: 'rgba(255,255,255,0.18)',
      borderBottomColor: 'rgba(255,255,255,0.18)',
      borderLeftColor: 'rgba(255,255,255,0.18)',
    },
  },
  iconBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    background: '#23232a',
    color: '#f4f4f6',
    ':hover:not(:disabled)': { background: '#2c2c34' },
    ':disabled': { opacity: 0.45, cursor: 'not-allowed' },
  },
  iconGlyph: { width: '18px', height: '18px' },
})

export interface AskPathfinderProps {
  endpoint?: string
}

export function AskPathfinder({
  endpoint = '/api/learning/assistant/ask',
}: AskPathfinderProps) {
  const styles = useStyles()
  const learner = useLearnerContext()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [busy, setBusy] = useState(false)

  const send = useCallback(
    async (event?: FormEvent) => {
      if (event) event.preventDefault()
      const question = draft.trim()
      if (!question || busy) return
      const userId = `u-${Date.now().toString(36)}`
      // Maintain the dig-deeper thread: prior turns (before this question) give
      // the model the running context to ground multi-turn follow-ups.
      const thread = transcript.map(entry => ({
        role: entry.role,
        text: entry.text,
      }))
      const focusItem = learner.focusItem
      const setup = learner.learnerSetup
      setTranscript(prev => [
        ...prev,
        { role: 'user', text: question, id: userId },
      ])
      setDraft('')
      setBusy(true)
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            user_id: learner.userId,
            question,
            weak_topics: learner.weakTopics.map(w => ({
              skill_id: w.skillId,
              label: w.label,
            })),
            daily_plan: learner.dailyPlan.map(d => ({
              id: d.id,
              title: d.title,
            })),
            career_fits: learner.careerFits,
            last_wrong_answer: learner.lastWrongAnswer
              ? {
                  skill_id: learner.lastWrongAnswer.skillId,
                  label: learner.lastWrongAnswer.label,
                }
              : null,
            // Dig-Deeper anchoring: the item the learner is on (if any), the
            // running thread, and the subject/year for curriculum retrieval.
            focus_item: focusItem
              ? {
                  stem: focusItem.stem,
                  options: focusItem.options,
                  chosen: focusItem.chosen,
                  correct: focusItem.correct,
                  rationale: focusItem.rationale,
                  skill_id: focusItem.skillId,
                  misconception: focusItem.misconception,
                  scored: focusItem.scored,
                }
              : null,
            learner_setup: setup
              ? { subject: setup.subject, year_group: setup.yearGroup }
              : null,
            // Episodic recall (Phase 5): recent misconception-tagged wrong
            // attempts as working memory. The backend gates this on memory
            // consent before turning it into a cross-session trap callback.
            attempt_history: learner.attemptHistory.map(a => ({
              misconception_code: a.misconceptionCode,
              topic: a.topic,
              correct: a.correct ?? false,
              occurred_at: a.occurredAt,
            })),
            thread,
          }),
        })
        const body = (await resp.json()) as {
          answer?: string
          citations?: Citation[]
          grounded?: boolean
          error?: string
        }
        const text =
          body.answer ??
          body.error ??
          'Sorry — Pathfinder could not answer that just now.'
        setTranscript(prev => [
          ...prev,
          {
            role: 'assistant',
            text,
            citations: body.citations ?? [],
            grounded: body.grounded,
            id: `a-${Date.now().toString(36)}`,
          },
        ])
      } catch {
        setTranscript(prev => [
          ...prev,
          {
            role: 'assistant',
            text: 'Offline for the moment. Try again when you have a connection.',
            citations: [],
            id: `a-${Date.now().toString(36)}`,
          },
        ])
      } finally {
        setBusy(false)
      }
    },
    [busy, draft, endpoint, learner, transcript]
  )

  return (
    <>
      {!open && (
        <button
          type="button"
          className={styles.fab}
          onClick={() => setOpen(true)}
          aria-label="Open Ask Pathfinder"
          data-testid="ask-pathfinder-fab"
        >
          <ChatBubbleLeftRightIcon
            className={styles.fabGlyph}
            aria-hidden="true"
          />
        </button>
      )}
      {open && (
        <aside
          className={styles.drawer}
          aria-label="Ask Pathfinder"
          data-testid="ask-pathfinder-drawer"
        >
          <header className={styles.header}>
            <span className={styles.title}>Ask Pathfinder</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close Ask Pathfinder"
            >
              <XMarkIcon className={styles.closeGlyph} aria-hidden="true" />
            </button>
          </header>
          <div
            className={styles.transcript}
            data-testid="ask-pathfinder-transcript"
          >
            {transcript.length === 0 && (
              <span className={styles.empty}>
                Ask about today's plan, a wrong answer, or a career pathway.
                Grounded answers, no outcome guarantees.
              </span>
            )}
            {transcript.map(entry =>
              entry.role === 'user' ? (
                <div key={entry.id} className={styles.msgUser}>
                  {entry.text}
                </div>
              ) : (
                <div
                  key={entry.id}
                  className={mergeClasses(
                    styles.msgAssistant,
                    entry.grounded === false && styles.msgAssistantDeferred
                  )}
                  data-grounded={entry.grounded === false ? 'false' : 'true'}
                >
                  {entry.grounded === false && (
                    <span
                      className={styles.deferBadge}
                      data-testid="ask-pathfinder-defer-badge"
                    >
                      No grounded source
                    </span>
                  )}
                  {entry.text}
                  {entry.citations.length > 0 && (
                    <div className={styles.citations}>
                      {entry.citations.map((c, idx) => (
                        <span
                          key={`${entry.id}-${idx}`}
                          className={styles.citation}
                        >
                          {c.label ?? c.topic_id ?? c.url ?? 'source'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
          <form className={styles.composer} onSubmit={send}>
            <button
              type="button"
              className={styles.iconBtn}
              disabled
              title="Voice answers coming next"
              aria-label="Voice answers coming next"
              data-testid="ask-pathfinder-mic"
            >
              <MicrophoneIcon className={styles.iconGlyph} aria-hidden="true" />
            </button>
            <textarea
              className={styles.textarea}
              aria-label="Ask Pathfinder a question"
              placeholder="Ask Pathfinder…"
              value={draft}
              onChange={e => setDraft(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              data-testid="ask-pathfinder-input"
            />
            <button
              type="submit"
              className={styles.iconBtn}
              disabled={busy || draft.trim().length === 0}
              aria-label="Send question"
              data-testid="ask-pathfinder-send"
            >
              <PaperAirplaneIcon
                className={styles.iconGlyph}
                aria-hidden="true"
              />
            </button>
          </form>
        </aside>
      )}
    </>
  )
}

export default AskPathfinder
