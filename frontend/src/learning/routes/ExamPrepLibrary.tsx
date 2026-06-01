/**
 * Learner-facing Exam prep library (`/exam-prep`).
 *
 * Promotes the previously hard-coded exam-prep catalogue out of the learner
 * home into its own navigable, searchable, and filterable page. Selecting an
 * item starts a *visible* practice session inline (a `DiagnosticPanel`), scrolls
 * it into view, and offers a back control — replacing the old dead-click that
 * silently mutated home state.
 */
import { Input, Text, makeStyles } from '@fluentui/react-components'
import {
  ArrowLeftIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useMemo, useRef, useState } from 'react'
import DiagnosticPanel from '../components/DiagnosticPanel'
import { fetchExamPrepTopics, type ExamPrepTopic } from '../api'
import {
  examPrep,
  examPrepExam,
  examPrepSubjectLabel,
  examPrepYear,
  type Activity,
} from '../data/examPrep'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import { featureFlags } from '../../utils/featureFlags'

export type ExamPrepLibraryProps = {
  studentId?: string | null
}

/**
 * Normalised row rendered by the library. Both the live topic catalogue
 * (`/api/learning/exam-prep/topics`) and the static `examPrep` teaser used as
 * an offline fallback map into this shape.
 */
type ExamRow = {
  id: string
  title: string
  meta: string
  minutes: number
  skillId?: string
  subject: string
  subjectLabel: string
  year: string
  exam: string
  diagnosticSubject?: string
}

function activityToRow(item: Activity): ExamRow {
  return {
    id: item.id,
    title: item.title,
    meta: item.meta,
    minutes: item.minutes,
    skillId: item.skillId,
    subject: item.subject ?? 'general',
    subjectLabel: examPrepSubjectLabel(item.subject),
    year: examPrepYear(item),
    exam: examPrepExam(item),
    diagnosticSubject: item.subject,
  }
}

function topicToRow(topic: ExamPrepTopic): ExamRow {
  const skills = `${topic.skill_count} skill${topic.skill_count === 1 ? '' : 's'}`
  return {
    id: topic.id,
    title: topic.title,
    meta: `${topic.year} · ${topic.exam} · ${skills}`,
    minutes: topic.minutes,
    skillId: topic.skill_id,
    subject: topic.subject,
    subjectLabel: topic.subject_label,
    year: topic.year,
    exam: topic.exam,
    diagnosticSubject: topic.diagnostic_subject,
  }
}

const STATIC_ROWS: ExamRow[] = examPrep.map(activityToRow)

const useStyles = makeStyles({
  shell: { display: 'grid', gap: '18px' },
  header: { display: 'grid', gap: '10px' },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    color: t.brand.text,
  },
  caption: {
    fontSize: '0.9rem',
    color: t.brand.textSecondary,
    margin: 0,
  },
  toolbar: { display: 'grid', gap: '12px' },
  searchBox: { maxWidth: '420px' },
  filterRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  filterLabel: {
    fontSize: '0.72rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: t.brand.textTertiary,
    marginRight: '4px',
  },
  pillButton: {
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
    color: t.brand.textSecondary,
    borderRadius: t.radius.pill,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  pillButtonActive: {
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    borderRadius: t.radius.pill,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  list: { display: 'grid', gap: '10px' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
    borderRadius: t.radius.lg,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  rowActive: {
    border: `1px solid ${t.brand.ink}`,
    boxShadow: `0 0 0 1px ${t.brand.ink}`,
  },
  rowIcon: {
    display: 'inline-flex',
    width: '36px',
    height: '36px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.md,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.text,
    flexShrink: 0,
  },
  rowBody: { display: 'grid', gap: '2px', flex: 1, minWidth: 0 },
  rowTitle: { fontWeight: 600, color: t.brand.text },
  rowMeta: { fontSize: '0.8rem', color: t.brand.textSecondary },
  minutes: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.78rem',
    color: t.brand.textSecondary,
    whiteSpace: 'nowrap',
  },
  empty: {
    border: `1px dashed ${t.brand.line}`,
    borderRadius: t.radius.lg,
    padding: '24px',
    textAlign: 'center',
    color: t.brand.textSecondary,
  },
  practice: {
    display: 'grid',
    gap: '12px',
    border: `1px solid ${t.brand.line}`,
    borderRadius: t.radius.xl,
    padding: '16px',
    backgroundColor: t.surface.cardMuted,
  },
  practiceHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    borderRadius: t.radius.pill,
    padding: '6px 12px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
})

export default function ExamPrepLibrary({ studentId }: ExamPrepLibraryProps) {
  const styles = useStyles()
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('All')
  const [track, setTrack] = useState('All')
  const [activeItem, setActiveItem] = useState<ExamRow | null>(null)
  const [rows, setRows] = useState<ExamRow[]>(STATIC_ROWS)
  const practiceRef = useRef<HTMLDivElement | null>(null)

  // Load the live diagnostic topic catalogue. The static teaser stays as the
  // fallback when the feature is gated off (404) or the request fails/empties.
  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    let cancelled = false
    fetchExamPrepTopics()
      .then(response => {
        if (cancelled) return
        const mapped = (response.topics ?? []).map(topicToRow)
        if (mapped.length > 0) setRows(mapped)
      })
      .catch(() => {
        // Keep the static fallback already in state.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const subjects = useMemo(
    () => ['All', ...Array.from(new Set(rows.map(item => item.subject)))],
    [rows]
  )

  const tracks = useMemo(
    () => ['All', ...Array.from(new Set(rows.map(item => item.exam)))],
    [rows]
  )

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return rows.filter(item => {
      const matchesSubject = subject === 'All' || item.subject === subject
      const matchesTrack = track === 'All' || item.exam === track
      const haystack = [
        item.title,
        item.meta,
        item.skillId ?? '',
        item.subjectLabel,
        item.year,
        item.exam,
      ]
        .join(' ')
        .toLowerCase()
      return (
        matchesSubject &&
        matchesTrack &&
        (!normalized || haystack.includes(normalized))
      )
    })
  }, [query, subject, track, rows])

  const startPractice = (item: ExamRow) => {
    setActiveItem(item)
    // Defer the scroll until the panel has mounted.
    window.requestAnimationFrame(() => {
      practiceRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  return (
    <div className={styles.shell} data-testid="route-exam-prep">
      <div className={styles.header}>
        <Text as="h1" className={styles.title}>
          Exam prep · JSS3 &amp; SS3
        </Text>
        <p className={styles.caption}>
          Search and filter WAEC, NECO, and JSSCE practice, then start a session.
        </p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Input
            data-testid="exam-prep-search"
            placeholder="Search topics"
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            contentBefore={
              <MagnifyingGlassIcon
                style={{ width: 16, height: 16 }}
                aria-hidden="true"
              />
            }
          />
        </div>
        <div className={styles.filterRow} aria-label="Filter by subject">
          <span className={styles.filterLabel}>Subject</span>
          {subjects.map(item => (
            <button
              key={item}
              type="button"
              aria-pressed={subject === item}
              className={
                subject === item ? styles.pillButtonActive : styles.pillButton
              }
              data-testid={`exam-prep-subject-${item}`}
              onClick={() => setSubject(item)}
            >
              {item === 'All' ? 'All' : examPrepSubjectLabel(item)}
            </button>
          ))}
        </div>
        <div className={styles.filterRow} aria-label="Filter by exam">
          <span className={styles.filterLabel}>Exam</span>
          {tracks.map(item => (
            <button
              key={item}
              type="button"
              aria-pressed={track === item}
              className={
                track === item ? styles.pillButtonActive : styles.pillButton
              }
              data-testid={`exam-prep-track-${item}`}
              onClick={() => setTrack(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty} data-testid="exam-prep-empty">
          No exam-prep topics match this view.
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map(item => (
            <button
              key={item.id}
              type="button"
              className={[
                styles.row,
                activeItem?.id === item.id ? styles.rowActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid={`exam-prep-${item.id}`}
              aria-pressed={activeItem?.id === item.id}
              onClick={() => startPractice(item)}
            >
              <span className={styles.rowIcon} aria-hidden="true">
                <PlayCircleIcon style={{ width: 20, height: 20 }} />
              </span>
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowMeta}>{item.meta}</span>
              </span>
              <span className={styles.minutes}>
                <ClockIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
                {item.minutes} min
              </span>
            </button>
          ))}
        </div>
      )}

      {activeItem && (
        <div
          className={styles.practice}
          data-testid="exam-prep-practice"
          ref={practiceRef}
        >
          <div className={styles.practiceHead}>
            <Text className={styles.rowTitle}>
              Practising: {activeItem.title}
            </Text>
            <button
              type="button"
              className={styles.backButton}
              data-testid="exam-prep-back"
              onClick={() => setActiveItem(null)}
            >
              <ArrowLeftIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
              Back to library
            </button>
          </div>
          <DiagnosticPanel
            key={activeItem.id}
            skillId={activeItem.skillId}
            subject={activeItem.diagnosticSubject ?? activeItem.subject}
            studentId={studentId}
          />
        </div>
      )}
    </div>
  )
}
