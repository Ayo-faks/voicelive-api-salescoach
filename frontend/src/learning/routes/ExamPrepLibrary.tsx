/**
 * Learner-facing Exam prep library (`/exam-prep`).
 *
 * Promotes the previously hard-coded exam-prep catalogue out of the learner
 * home into its own navigable, searchable, and filterable page. Selecting an
 * item starts the shared tutor-card + voice practice surface, scrolls the page
 * into context, and offers a back control — replacing the old dead-click that
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PracticeFullscreen from '../components/PracticeFullscreen'
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
import { useLearnerSetup } from '../hooks/useLearnerSetup'
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
  diagnosticId?: string
}

/** A concrete practice session target (whole topic or a single skill). */
type PracticeTarget = {
  key: string
  title: string
  skillId?: string
  skillIds?: string[]
  subject: string
  exam?: string
  classYear?: string
  skillStrict?: boolean
  maxQuestions?: number
  diagnosticSubject?: string
  diagnosticId?: string
}

const EXAM_PREP_MAX_QUESTIONS = 10

function voiceClassYear(year: string): string | undefined {
  const normalized = year.trim().toUpperCase()
  const senior = normalized.match(/^SSS?(\d)$/)
  if (senior) return `SSS${senior[1]}`
  if (/^JSS\d$/.test(normalized)) return normalized
  return undefined
}

function voiceExamForYear(year: string, exam: string): string | undefined {
  const classYear = voiceClassYear(year)
  if (classYear?.startsWith('JSS')) return 'Junior WAEC'
  if (classYear?.startsWith('SSS')) return 'WAEC'
  return ['WAEC', 'NECO', 'JAMB', 'Junior WAEC'].includes(exam)
    ? exam
    : undefined
}

function examPrepVoiceTaxonomy(item: ExamRow): {
  exam?: string
  classYear?: string
} {
  return {
    exam: voiceExamForYear(item.year, item.exam),
    classYear: voiceClassYear(item.year),
  }
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
    diagnosticId: topic.diagnostic_id,
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
    color: 'var(--pf-text)',
  },
  caption: {
    fontSize: '0.9rem',
    color: 'var(--pf-text-secondary)',
    margin: 0,
  },
  resultCount: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--pf-text-secondary)',
    margin: 0,
  },
  toolbar: { display: 'grid', gap: '12px' },
  toolbarSticky: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    display: 'grid',
    gap: '12px',
    paddingTop: '8px',
    paddingBottom: '12px',
    backgroundColor: 'var(--pf-page)',
    boxShadow: '0 1px 0 var(--pf-line)',
  },
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
    color: 'var(--pf-text-tertiary)',
    marginRight: '4px',
  },
  pillButton: {
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text-secondary)',
    borderRadius: t.radius.pill,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  pillButtonActive: {
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    borderRadius: t.radius.pill,
    padding: '6px 14px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  list: { display: 'grid', gap: '10px' },
  sections: { display: 'grid', gap: '10px' },
  section: { display: 'grid', gap: '10px' },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    minHeight: t.control.minHeight,
    textAlign: 'left',
    font: 'inherit',
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface-muted)',
    borderRadius: t.radius.control,
    padding: '8px 14px',
    cursor: 'pointer',
    color: 'var(--pf-text)',
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontWeight: t.weight.strong,
    fontSize: '0.95rem',
  },
  sectionCount: {
    fontSize: '0.78rem',
    fontWeight: t.weight.regular,
    color: 'var(--pf-text-secondary)',
    whiteSpace: 'nowrap',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    borderRadius: t.radius.lg,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  rowActive: {
    border: '1px solid var(--pf-ink)',
    boxShadow: '0 0 0 1px var(--pf-ink)',
  },
  rowIcon: {    display: 'inline-flex',
    width: '36px',
    height: '36px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.md,
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
    flexShrink: 0,
  },
  rowBody: { display: 'grid', gap: '2px', flex: 1, minWidth: 0 },
  rowTitle: { fontWeight: 600, color: 'var(--pf-text)' },
  rowMeta: { fontSize: '0.8rem', color: 'var(--pf-text-secondary)' },
  minutes: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.78rem',
    color: 'var(--pf-text-secondary)',
    whiteSpace: 'nowrap',
  },
  empty: {
    border: '1px dashed var(--pf-line)',
    borderRadius: t.radius.lg,
    padding: '24px',
    textAlign: 'center',
    color: 'var(--pf-text-secondary)',
  },
  practice: {
    display: 'grid',
    gap: '12px',
    border: '1px solid var(--pf-line)',
    borderRadius: t.radius.xl,
    padding: '16px',
    backgroundColor: 'var(--pf-surface-muted)',
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
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    borderRadius: t.radius.pill,
    padding: '6px 12px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  rowChevron: {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'var(--pf-text-tertiary)',
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
    color: 'var(--pf-text)',
  },
  detailMeta: { fontSize: '0.85rem', color: 'var(--pf-text-secondary)' },
  practiceAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
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
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    borderRadius: t.radius.lg,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  skillDot: {
    display: 'inline-flex',
    width: '10px',
    height: '10px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface-muted)',
    flexShrink: 0,
  },
  skillBody: { display: 'grid', gap: '2px', flex: 1, minWidth: 0 },
  skillName: { fontWeight: 600, color: 'var(--pf-text)' },
  skillHint: { fontSize: '0.78rem', color: 'var(--pf-text-secondary)' },
  practiseTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--pf-ink)',
    whiteSpace: 'nowrap',
  },
})

export default function ExamPrepLibrary({ studentId }: ExamPrepLibraryProps) {
  const styles = useStyles()
  const [setup] = useLearnerSetup()
  const navigate = useNavigate()
  // The topic + skill segments live in the URL (`/exam-prep/:topic/:skill`) so
  // Back, refresh, and deep links step through the library, the topic detail,
  // and the practice session instead of exiting the whole page.
  const params = useParams()
  const restPath = params['*'] ?? ''
  const [rawTopicSlug, rawSkillSlug] = restPath.split('/').filter(Boolean)
  const topicSlug = rawTopicSlug ? decodeURIComponent(rawTopicSlug) : undefined
  const skillSlug = rawSkillSlug ? decodeURIComponent(rawSkillSlug) : undefined
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('All')
  const [track, setTrack] = useState('All')
  const [rows, setRows] = useState<ExamRow[]>(STATIC_ROWS)
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(
    () => new Set()
  )
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

  const subjectCount = useMemo(
    () => new Set(filtered.map(item => item.subject)).size,
    [filtered]
  )

  // The learner's own subject (from their saved setup) sorts first and opens
  // by default, so the most relevant topics are one tap away while the rest of
  // the catalogue stays collapsed.
  const learnerSubjectKey = useMemo(() => {
    const wanted = setup.subject.trim().toLowerCase()
    if (!wanted) return null
    const match = rows.find(
      item =>
        item.subject.toLowerCase() === wanted ||
        item.subjectLabel.toLowerCase() === wanted
    )
    return match?.subject ?? null
  }, [setup.subject, rows])

  // Group the filtered topics into subject sections, learner's subject first.
  const sections = useMemo(() => {
    const map = new Map<
      string,
      { subject: string; label: string; rows: ExamRow[] }
    >()
    for (const item of filtered) {
      const entry = map.get(item.subject) ?? {
        subject: item.subject,
        label: item.subjectLabel,
        rows: [],
      }
      entry.rows.push(item)
      map.set(item.subject, entry)
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.subject === learnerSubjectKey) return -1
      if (b.subject === learnerSubjectKey) return 1
      return a.label.localeCompare(b.label)
    })
  }, [filtered, learnerSubjectKey])

  // Pre-expand the learner's own subject once the catalogue is known.
  useEffect(() => {
    if (!learnerSubjectKey) return
    setExpandedSubjects(prev => {
      if (prev.has(learnerSubjectKey)) return prev
      const next = new Set(prev)
      next.add(learnerSubjectKey)
      return next
    })
  }, [learnerSubjectKey])

  const toggleSubject = (value: string) => {
    setExpandedSubjects(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  // When the learner searches or narrows by a filter chip, every matching
  // section opens so results are never hidden behind a collapsed header.
  const searchOrFilterActive =
    query.trim() !== '' || subject !== 'All' || track !== 'All'

  const startPractice = useCallback(() => {
    // Defer the scroll until the panel has mounted.
    window.requestAnimationFrame(() => {
      practiceRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }, [])

  // The topic detail and practice session are resolved from the URL segments
  // against the loaded catalogue, so a refresh or shared deep link lands on the
  // same view.
  const activeTopic = useMemo(
    () => (topicSlug ? rows.find(item => item.id === topicSlug) ?? null : null),
    [topicSlug, rows]
  )

  const practice = useMemo<PracticeTarget | null>(() => {
    if (!topicSlug || !skillSlug) return null
    const item = rows.find(row => row.id === topicSlug)
    if (!item) return null
    if (skillSlug === 'all') {
      const skillIds = item.skills.map(skill => skill.skill_id)
      return {
        key: skillIds.length > 0 ? `${item.id}:all` : item.id,
        title:
          skillIds.length > 0 ? `${item.title} · All skills` : item.title,
        skillId: item.skillId,
        skillIds: skillIds.length > 0 ? skillIds : undefined,
        subject: item.subject,
        ...examPrepVoiceTaxonomy(item),
        skillStrict: false,
        maxQuestions: EXAM_PREP_MAX_QUESTIONS,
        diagnosticSubject: item.diagnosticSubject,
        diagnosticId: item.diagnosticId,
      }
    }
    const skill = item.skills.find(entry => entry.skill_id === skillSlug)
    if (skill) {
      return {
        key: `${item.id}:${skill.skill_id}`,
        title: `${item.title} · ${skill.label}`,
        skillId: skill.skill_id,
        subject: item.subject,
        ...examPrepVoiceTaxonomy(item),
        skillStrict: true,
        maxQuestions: EXAM_PREP_MAX_QUESTIONS,
        diagnosticSubject: item.diagnosticSubject,
        diagnosticId: item.diagnosticId,
      }
    }
    // A skill-less teaser topic practised straight from the library.
    return {
      key: item.id,
      title: item.title,
      skillId: item.skillId,
      subject: item.subject,
      ...examPrepVoiceTaxonomy(item),
      skillStrict: Boolean(item.skillId),
      maxQuestions: EXAM_PREP_MAX_QUESTIONS,
      diagnosticSubject: item.diagnosticSubject,
      diagnosticId: item.diagnosticId,
    }
  }, [topicSlug, skillSlug, rows])

  // Scroll the practice panel into view whenever a session opens.
  useEffect(() => {
    if (practice) startPractice()
  }, [practice, startPractice])

  const goToPath = (path: string) => navigate(path)

  // A topic with a drillable skill breakdown opens the detail view; a thin
  // static-teaser row (no skills) practises straight away.
  const openTopic = (item: ExamRow) => {
    if (item.skills.length > 0) {
      goToPath(`/exam-prep/${encodeURIComponent(item.id)}`)
      return
    }
    goToPath(`/exam-prep/${encodeURIComponent(item.id)}/practice`)
  }

  const practiceWholeTopic = (item: ExamRow) => {
    goToPath(`/exam-prep/${encodeURIComponent(item.id)}/all`)
  }

  const practiceSkill = (item: ExamRow, skill: ExamPrepSkill) => {
    goToPath(
      `/exam-prep/${encodeURIComponent(item.id)}/${encodeURIComponent(
        skill.skill_id
      )}`
    )
  }


  return (
    <div className={styles.shell} data-testid="route-exam-prep">
      <div className={styles.header}>
        {practice ? (
          <>
            <Text as="h1" className={styles.title} data-testid="exam-prep-heading">
              {practice.title}
            </Text>
            <p className={styles.caption}>
              Practice session in progress — answer each question, then keep going.
            </p>
          </>
        ) : (
          <>
            <Text as="h1" className={styles.title} data-testid="exam-prep-heading">
              Exam prep · JSS3 &amp; SS3
            </Text>
            <p className={styles.caption}>
              Search and filter WAEC, NECO, and JSSCE practice, then start a session.
            </p>
          </>
        )}
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
              onClick={() =>
                goToPath(
                  activeTopic && activeTopic.skills.length > 0
                    ? `/exam-prep/${encodeURIComponent(activeTopic.id)}`
                    : '/exam-prep'
                )
              }
            >
              <ArrowLeftIcon
                style={{ width: 14, height: 14 }}
                aria-hidden="true"
              />
              {activeTopic && activeTopic.skills.length > 0
                ? 'Back to skills'
                : 'Back to library'}
            </button>
          </div>
          <PracticeFullscreen
            key={practice.key}
            open
            onClose={() =>
              goToPath(
                activeTopic && activeTopic.skills.length > 0
                  ? `/exam-prep/${encodeURIComponent(activeTopic.id)}`
                  : '/exam-prep'
              )
            }
            childId={studentId ?? 'exam-prep-learner'}
            exam={practice.exam}
            classYear={practice.classYear}
            subject={practice.subject}
            skillId={practice.skillId}
            skillStrict={practice.skillStrict}
            maxQuestions={practice.maxQuestions}
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
                onClick={() => goToPath('/exam-prep')}
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
          <div className={styles.toolbarSticky}>
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
            <p className={styles.resultCount} data-testid="exam-prep-count">
              {filtered.length} topic{filtered.length === 1 ? '' : 's'} ·{' '}
              {subjectCount} subject{subjectCount === 1 ? '' : 's'}
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className={styles.empty} data-testid="exam-prep-empty">
              No exam-prep topics match this view.
            </div>
          ) : (
            <div className={styles.sections}>
              {sections.map(section => {
                const open =
                  searchOrFilterActive ||
                  sections.length === 1 ||
                  expandedSubjects.has(section.subject)
                return (
                  <section
                    key={section.subject}
                    className={styles.section}
                    data-testid={`exam-prep-section-${section.subject}`}
                  >
                    <button
                      type="button"
                      className={styles.sectionHeader}
                      aria-expanded={open}
                      data-testid={`exam-prep-section-toggle-${section.subject}`}
                      onClick={() => toggleSubject(section.subject)}
                    >
                      <ChevronRightIcon
                        style={{
                          width: 16,
                          height: 16,
                          transform: open ? 'rotate(90deg)' : 'none',
                        }}
                        aria-hidden="true"
                      />
                      <span className={styles.sectionTitle}>
                        {section.label}
                      </span>
                      <span className={styles.sectionCount}>
                        {section.rows.length} topic
                        {section.rows.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    {open && (
                      <div className={styles.list}>
                        {section.rows.map(item => {
                          const drillable = item.skills.length > 0
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={styles.row}
                              data-testid={`exam-prep-${item.id}`}
                              onClick={() => openTopic(item)}
                            >
                              <span
                                className={styles.rowIcon}
                                aria-hidden="true"
                              >
                                <PlayCircleIcon
                                  style={{ width: 20, height: 20 }}
                                />
                              </span>
                              <span className={styles.rowBody}>
                                <span className={styles.rowTitle}>
                                  {item.title}
                                </span>
                                <span className={styles.rowMeta}>
                                  {item.meta}
                                </span>
                              </span>
                              {drillable ? (
                                <span
                                  className={styles.rowChevron}
                                  aria-hidden="true"
                                >
                                  <ChevronRightIcon
                                    style={{ width: 18, height: 18 }}
                                  />
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
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
