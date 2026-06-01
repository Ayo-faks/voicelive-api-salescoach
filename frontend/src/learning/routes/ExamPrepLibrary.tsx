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
  ChevronRightIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useMemo, useRef, useState } from 'react'
import DiagnosticPanel from '../components/DiagnosticPanel'
import {
  fetchExamPrepTopics,
  type ExamPrepSkill,
  type ExamPrepTopic,
} from '../api'
import {
  examPrep,
  examPrepExam,
  examPrepSubjectLabel,
  examPrepYear,
  type Activity,
} from '../data/examPrep'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

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
  skills: ExamPrepSkill[]
  subject: string
  subjectLabel: string
  year: string
  exam: string
  diagnosticSubject?: string
}

/** A concrete practice session target (whole topic or a single skill). */
type PracticeTarget = {
  key: string
  title: string
  skillId?: string
  skillIds?: string[]
  subject: string
  diagnosticSubject?: string
}

function activityToRow(item: Activity): ExamRow {
  return {
    id: item.id,
    title: item.title,
    meta: item.meta,
    minutes: item.minutes,
    skillId: item.skillId,
    skills: [],
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
    skills: topic.skills ?? [],
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
  rowIcon: {    display: 'inline-flex',
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
  rowChevron: {
    display: 'inline-flex',
    alignItems: 'center',
    color: t.brand.textTertiary,
    flexShrink: 0,
  },
  detail: { display: 'grid', gap: '16px' },
  detailHead: {
    display: 'grid',
    gap: '10px',
  },
  detailTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  detailTitle: {
    fontFamily: t.font.display,
    fontSize: '1.3rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  detailMeta: { fontSize: '0.85rem', color: t.brand.textSecondary },
  practiceAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    borderRadius: t.radius.pill,
    padding: '10px 18px',
    fontSize: '0.85rem',
    fontWeight: 700,
    cursor: 'pointer',
    justifySelf: 'start',
  },
  skillList: { display: 'grid', gap: '8px' },
  skillRow: {
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
  skillDot: {
    display: 'inline-flex',
    width: '10px',
    height: '10px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.surface.cardMuted,
    flexShrink: 0,
  },
  skillBody: { display: 'grid', gap: '2px', flex: 1, minWidth: 0 },
  skillName: { fontWeight: 600, color: t.brand.text },
  skillHint: { fontSize: '0.78rem', color: t.brand.textSecondary },
  practiseTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: t.brand.ink,
    whiteSpace: 'nowrap',
  },
})

export default function ExamPrepLibrary({ studentId }: ExamPrepLibraryProps) {
  const styles = useStyles()
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('All')
  const [track, setTrack] = useState('All')
  const [activeTopic, setActiveTopic] = useState<ExamRow | null>(null)
  const [practice, setPractice] = useState<PracticeTarget | null>(null)
  const [rows, setRows] = useState<ExamRow[]>(STATIC_ROWS)
  const practiceRef = useRef<HTMLDivElement | null>(null)

  // Load the live diagnostic topic catalogue. The static teaser stays as the
  // fallback when the request fails or comes back empty.
  useEffect(() => {
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

  const startPractice = (target: PracticeTarget) => {
    setPractice(target)
    // Defer the scroll until the panel has mounted.
    window.requestAnimationFrame(() => {
      practiceRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  // A topic with a drillable skill breakdown opens the detail view; a thin
  // static-teaser row (no skills) practises straight away.
  const openTopic = (item: ExamRow) => {
    if (item.skills.length > 0) {
      setActiveTopic(item)
      return
    }
    startPractice({
      key: item.id,
      title: item.title,
      skillId: item.skillId,
      subject: item.subject,
      diagnosticSubject: item.diagnosticSubject,
    })
  }

  const practiceWholeTopic = (item: ExamRow) => {
    const skillIds = item.skills.map(skill => skill.skill_id)
    startPractice({
      key: skillIds.length > 0 ? `${item.id}:all` : item.id,
      title:
        skillIds.length > 0 ? `${item.title} · All skills` : item.title,
      skillId: item.skillId,
      skillIds: skillIds.length > 0 ? skillIds : undefined,
      subject: item.subject,
      diagnosticSubject: item.diagnosticSubject,
    })
  }

  const practiceSkill = (item: ExamRow, skill: ExamPrepSkill) => {
    startPractice({
      key: `${item.id}:${skill.skill_id}`,
      title: `${item.title} · ${skill.label}`,
      skillId: skill.skill_id,
      subject: item.subject,
      diagnosticSubject: item.diagnosticSubject,
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

      {practice ? (
        <div
          className={styles.practice}
          data-testid="exam-prep-practice"
          ref={practiceRef}
        >
          <div className={styles.practiceHead}>
            <Text className={styles.rowTitle}>
              Practising: {practice.title}
            </Text>
            <button
              type="button"
              className={styles.backButton}
              data-testid="exam-prep-back"
              onClick={() => setPractice(null)}
            >
              <ArrowLeftIcon
                style={{ width: 14, height: 14 }}
                aria-hidden="true"
              />
              {activeTopic ? 'Back to skills' : 'Back to library'}
            </button>
          </div>
          <DiagnosticPanel
            key={practice.key}
            skillId={practice.skillId}
            skillIds={practice.skillIds}
            subject={practice.diagnosticSubject ?? practice.subject}
            studentId={studentId}
          />
        </div>
      ) : activeTopic ? (
        <div className={styles.detail} data-testid="exam-prep-detail">
          <div className={styles.detailHead}>
            <div className={styles.detailTitleRow}>
              <Text as="h2" className={styles.detailTitle}>
                {activeTopic.title}
              </Text>
              <button
                type="button"
                className={styles.backButton}
                data-testid="exam-prep-detail-back"
                onClick={() => setActiveTopic(null)}
              >
                <ArrowLeftIcon
                  style={{ width: 14, height: 14 }}
                  aria-hidden="true"
                />
                Back to library
              </button>
            </div>
            <span className={styles.detailMeta}>{activeTopic.meta}</span>
            <button
              type="button"
              className={styles.practiceAll}
              data-testid="exam-prep-practice-all"
              onClick={() => practiceWholeTopic(activeTopic)}
            >
              <PlayCircleIcon
                style={{ width: 18, height: 18 }}
                aria-hidden="true"
              />
              Practise all {activeTopic.skills.length} skill
              {activeTopic.skills.length === 1 ? '' : 's'}
            </button>
          </div>
          <div className={styles.skillList}>
            {activeTopic.skills.map(skill => (
              <button
                key={skill.skill_id}
                type="button"
                className={styles.skillRow}
                data-testid={`exam-prep-skill-${skill.skill_id}`}
                onClick={() => practiceSkill(activeTopic, skill)}
              >
                <span className={styles.skillDot} aria-hidden="true" />
                <span className={styles.skillBody}>
                  <span className={styles.skillName}>{skill.label}</span>
                  <span className={styles.skillHint}>
                    Tap to practise this skill
                  </span>
                </span>
                <span className={styles.practiseTag}>
                  <PlayCircleIcon
                    style={{ width: 14, height: 14 }}
                    aria-hidden="true"
                  />
                  Practise
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
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
                    subject === item
                      ? styles.pillButtonActive
                      : styles.pillButton
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
                    track === item
                      ? styles.pillButtonActive
                      : styles.pillButton
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
              {filtered.map(item => {
                const drillable = item.skills.length > 0
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.row}
                    data-testid={`exam-prep-${item.id}`}
                    onClick={() => openTopic(item)}
                  >
                    <span className={styles.rowIcon} aria-hidden="true">
                      <PlayCircleIcon style={{ width: 20, height: 20 }} />
                    </span>
                    <span className={styles.rowBody}>
                      <span className={styles.rowTitle}>{item.title}</span>
                      <span className={styles.rowMeta}>{item.meta}</span>
                    </span>
                    {drillable ? (
                      <span className={styles.rowChevron} aria-hidden="true">
                        <ChevronRightIcon style={{ width: 18, height: 18 }} />
                      </span>
                    ) : (
                      <span className={styles.minutes}>
                        <ClockIcon
                          style={{ width: 14, height: 14 }}
                          aria-hidden="true"
                        />
                        {item.minutes} min
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
