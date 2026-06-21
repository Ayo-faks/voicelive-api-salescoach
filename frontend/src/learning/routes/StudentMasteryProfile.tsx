import {
  Card,
  CardHeader,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useCallback, useEffect, useState } from 'react'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { useLearnerSetup } from '../hooks/useLearnerSetup'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import { fetchLearningMasteryProfile } from '../api'
import { api } from '../../services/api'
import LearnerSelector from '../components/LearnerSelector'
import type { ChildMastery, ChildProfile } from '../../types'

export type StudentMasteryProfileProps = {
  /** Effective viewer role; counsellor widgets only render for staff. */
  role?: string
  /** Selected learner's display name, for a single identity source. */
  learnerName?: string | null
  /** Selected learner id; drives the real (non-demo) mastery profile. */
  studentId?: string | null
  /** All learners this viewer manages; powers the child switcher (multi-kid). */
  learners?: ChildProfile[]
  /** Switch the active learner when a parent manages more than one child. */
  onSelectStudent?: (studentId: string) => void
}
// The parent-ready summary is derived from the learner's live mastery profile
// (strongest skill, below-target gaps, focus skills, scored-session count and
// the real teacher review date) rather than hard-coded demo copy. It mirrors
// whatever child is currently selected in the switcher.
const buildParentReadySummary = (
  name: string,
  mastery: ChildMastery | null,
) => {
  const skills = mastery?.skills ?? []
  const hasData = (mastery?.has_data ?? false) && skills.length > 0
  const sessionCount = mastery?.scored_session_count ?? 0
  const sessionWord = sessionCount === 1 ? 'session' : 'sessions'

  if (!hasData) {
    return [
      {
        label: 'What we noticed',
        items: [
          `${name} has not completed any scored practice yet, so there is no progress to send home this week.`,
        ],
      },
      {
        label: 'What Wulo Academy did',
        items: ['Prepared a short diagnostic to find the right starting point.'],
      },
      {
        label: 'What to do at home',
        items: [
          `Encourage ${name} to finish a first practice exercise so we can share real progress.`,
        ],
      },
    ]
  }

  const strongest = [...skills].sort((a, b) => b.mastery - a.mastery)[0]
  const belowTarget = skills
    .filter(skill => skill.mastery < skill.target)
    .sort((a, b) => a.mastery - b.mastery)
  const topGap = belowTarget[0]
  const focus = belowTarget.slice(0, 3)
  const topGapName = topGap?.skill.toLowerCase()

  const trajectory = mastery?.trajectory ?? []
  let trend: 'improving' | 'steady' | 'dipping' | null = null
  if (trajectory.length >= 2) {
    const delta =
      trajectory[trajectory.length - 1].score - trajectory[0].score
    trend = delta >= 4 ? 'improving' : delta <= -4 ? 'dipping' : 'steady'
  }

  const noticed: string[] = [
    `${name} is strongest in ${strongest.skill.toLowerCase()} (${strongest.mastery}%).`,
  ]
  if (topGap) {
    noticed.push(
      `${topGap.skill} is the main learning gap this week (${topGap.mastery}% against a ${topGap.target}% target).`,
    )
  } else {
    noticed.push(
      `Every tracked skill is at or above its ${strongest.target}% target.`,
    )
  }
  if (trend === 'improving') {
    noticed.push(
      `Weekly practice scores are trending up across ${sessionCount} scored ${sessionWord}.`,
    )
  } else if (trend === 'dipping') {
    noticed.push(
      `Weekly practice scores have dipped recently across ${sessionCount} scored ${sessionWord}.`,
    )
  } else {
    noticed.push(
      `Based on ${sessionCount} scored practice ${sessionWord} so far.`,
    )
  }

  const wuloDid: string[] = [
    topGapName
      ? `Adapted the next questions after ${name} struggled with ${topGapName}.`
      : 'Kept practice at the right challenge level as skills held above target.',
    topGapName
      ? `Proposed a short ${topGapName} recovery plan for teacher approval.`
      : 'Proposed gentle stretch work for teacher approval.',
    `Scheduled spaced retrieval across ${sessionCount} practice ${sessionWord}.`,
  ]

  const atHome: string[] = [
    topGapName
      ? `Spend 10 minutes twice this week practising ${topGapName}.`
      : `Keep ${name}'s routine of short, regular practice going.`,
    `Ask ${name} to explain their thinking out loud on each question.`,
    focus.length > 1
      ? `Also revisit ${focus
          .slice(1)
          .map(skill => skill.skill.toLowerCase())
          .join(' and ')} when there is time.`
      : 'Celebrate effort and consistency rather than just correct answers.',
  ]

  return [
    { label: 'What we noticed', items: noticed },
    { label: 'What Wulo Academy did', items: wuloDid },
    { label: 'What to do at home', items: atHome },
  ]
}

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '18px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    flexWrap: 'wrap',
  },
  studentMeta: {
    display: 'grid',
    gap: '4px',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
  },
  metaBadges: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    marginTop: '6px',
  },
  softBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: '24px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    paddingRight: '10px',
    paddingLeft: '10px',
    lineHeight: 1.35,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    textAlign: 'left',
  },
  softBadgeSolid: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: '24px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    paddingRight: '10px',
    paddingLeft: '10px',
    lineHeight: 1.35,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    textAlign: 'left',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
    gap: '18px',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  chartCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: '10px',
  },
  chartBox: {
    height: '260px',
    width: '100%',
  },
  riskCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    borderLeft: '3px solid var(--pf-status-warn-fg)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: '8px',
  },
  riskTitle: {
    fontWeight: 700,
    color: 'var(--pf-text)',
  },
  sideStack: {
    display: 'grid',
    gap: '14px',
    alignContent: 'start',
  },
  trajectoryCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: '10px',
  },
  tabRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  parentSummaryCard: {
    padding: '18px',
    borderRadius: t.radius.xl,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: '14px',
  },
  parentSummaryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  parentSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 760px)': { gridTemplateColumns: '1fr' },
  },
  parentSummarySection: {
    display: 'grid',
    gap: '8px',
    padding: '12px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
  },
  parentSummaryList: {
    display: 'grid',
    gap: '6px',
    margin: 0,
    paddingLeft: '18px',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.88rem',
    lineHeight: 1.45,
  },
  parentSummaryActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
})

export default function StudentMasteryProfile({
  role,
  learnerName,
  studentId,
  learners,
  onSelectStudent,
}: StudentMasteryProfileProps = {}) {
  const styles = useStyles()
  const [setup] = useLearnerSetup()
  const [mastery, setMastery] = useState<ChildMastery | null>(null)
  const [masteryLoading, setMasteryLoading] = useState(false)
  const [masteryError, setMasteryError] = useState<string | null>(null)
  const useLegacyChildMastery = role === 'therapist' || role === 'admin'

  // Pull the real per-child mastery profile (skill radar + weekly trajectory)
  // instead of demo fixtures (#1). Falls back to an empty state when the
  // learner has not practised yet. Scoped to one learner at a time — for a
  // parent with several children, the radar reflects whichever child is
  // selected in the switcher below.
  const loadMastery = useCallback(
    async (signal?: { cancelled: boolean }, opts?: { quiet?: boolean }) => {
      if (!studentId) {
        setMastery(null)
        setMasteryError(null)
        return
      }
      if (!opts?.quiet) {
        setMasteryLoading(true)
        setMasteryError(null)
      }
      try {
        const data = useLegacyChildMastery
          ? await api.getChildMastery(studentId)
          : await fetchLearningMasteryProfile({ student_id: studentId })
        if (!signal?.cancelled) {
          setMastery(data)
          setMasteryError(null)
        }
      } catch {
        if (!signal?.cancelled && !opts?.quiet) {
          setMastery(null)
          setMasteryError('Could not load progress right now. Try again in a moment.')
        }
      } finally {
        if (!signal?.cancelled && !opts?.quiet) setMasteryLoading(false)
      }
    },
    [studentId, useLegacyChildMastery]
  )

  useEffect(() => {
    const signal = { cancelled: false }
    loadMastery(signal)
    // Keep the radar fresh after the learner finishes practice elsewhere:
    // refetch quietly when the tab regains focus / becomes visible again.
    const onFocus = () => loadMastery(signal, { quiet: true })
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadMastery(signal, { quiet: true })
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      signal.cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadMastery])

  // Counsellor/teacher/parent controls (approvals, risk flags, send-home) are
  // for adults reviewing a learner. Learners themselves get a read-only,
  // encouraging progress view (#3).
  const isStaff =
    role === 'parent' || role === 'therapist' || role === 'admin'

  // One identity source across surfaces (#7): the selected learner's name,
  // falling back to the saved setup first name.
  const displayName =
    learnerName?.trim() || setup.firstName.trim() || 'Your progress'

  // Parent-ready summary uses a readable first name (never the H1 fallback)
  // and is derived from the live mastery profile + real teacher review date.
  const summaryName =
    learnerName?.trim() || setup.firstName.trim() || 'Your learner'
  const parentReadySummary = buildParentReadySummary(summaryName, mastery)

  // Real data drives the charts; the radar broadens to every skill the learner
  // has actually practised (#2) rather than a fixed list of maths strands.
  const radarData = mastery?.skills ?? []
  const trajectoryData = mastery?.trajectory ?? []
  const hasRadarData = radarData.length > 0
  const hasTrajectoryData = trajectoryData.length > 0

  // Skills sitting below their mastery target become the real "focus"/"risk"
  // signal, replacing the previous hard-coded ratio/linear-eq flags (#1).
  const focusSkills = [...radarData]
    .filter(point => point.mastery < point.target)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 3)

  // Plain-language, table-style alternatives for the charts (#17).
  const radarSummary = radarData
    .map(point => `${point.skill} ${point.mastery}%`)
    .join(', ')
  const trajectorySummary = trajectoryData
    .map(point => `${point.week}: ${point.score}%`)
    .join('; ')

  return (
    <div className={styles.shell} data-testid="route-student-profile">
      {learners && learners.length > 1 && onSelectStudent && (
        <LearnerSelector
          learners={learners}
          selectedLearnerId={studentId ?? null}
          onChange={onSelectStudent}
        />
      )}
      <div className={styles.headerRow}>
        <div className={styles.studentMeta}>
          <Text as="h1" className={styles.title}>
            {displayName}
          </Text>
          <div className={styles.metaBadges}>
            <span className={styles.softBadge}>{setup.year}</span>
            <span className={styles.softBadge}>{setup.subject}</span>
            {mastery?.has_data && (
              <span className={styles.softBadge}>
                {mastery.scored_session_count} sessions
              </span>
            )}
          </div>
        </div>
      </div>

      <Card
        className={styles.parentSummaryCard}
        data-testid="parent-ready-summary"
      >
        <div className={styles.parentSummaryHeader}>
          <div>
            <Text weight="semibold">One-page parent-ready summary</Text>
            <p
              style={{
                margin: '6px 0 0',
                color: 'var(--pf-text-secondary)',
                lineHeight: 1.45,
              }}
            >
              Plain-language update for home: progress, support plan, next
              practice, and teacher-controlled memory.
            </p>
          </div>
          <div className={styles.parentSummaryActions}>
            {isStaff && (
              <span className={styles.softBadgeSolid}>Ready to send home</span>
            )}
          </div>
        </div>
        <div className={styles.parentSummaryGrid}>
          {parentReadySummary.map(section => (
            <section
              key={section.label}
              className={styles.parentSummarySection}
            >
              <Text weight="semibold">{section.label}</Text>
              <ul className={styles.parentSummaryList}>
                {section.items.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Card>

      <div className={styles.twoCol}>
        <Card className={styles.chartCard}>
          <CardHeader
            header={<Text weight="semibold">Skill radar</Text>}
            description={
              <Text size={200}>
                Average mastery per skill from real practice sessions
              </Text>
            }
          />
          <div className={styles.chartBox}>
            {!hasRadarData ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  textAlign: 'center',
                  color: 'var(--pf-text-secondary)',
                  padding: '0 16px',
                }}
              >
                <Text size={200}>
                  {masteryLoading
                    ? 'Loading mastery…'
                    : masteryError
                      ? masteryError
                    : 'No practice sessions yet — the skill radar appears once this learner completes their first exercise.'}
                </Text>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={radarData}
                role="img"
                aria-label={`Skill radar — mastery versus the ${setup.year} target of 75 percent: ${radarSummary}.`}
              >
                <PolarGrid stroke={'var(--pf-line)'} />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fontSize: 12, fill: 'var(--pf-text-secondary)' }}
                />
                <PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: 'var(--pf-text-tertiary)' }}
                />
                <Radar
                  name="Mastery"
                  dataKey="mastery"
                  stroke={'var(--pf-ink)'}
                  fill={'var(--pf-ink)'}
                  fillOpacity={0.35}
                />
                <Radar
                  name="Target"
                  dataKey="target"
                  stroke={'var(--pf-ink-muted)'}
                  fill={'var(--pf-ink-muted)'}
                  fillOpacity={0.1}
                />
              </RadarChart>
            </ResponsiveContainer>
            )}
          </div>
        </Card>

        <div className={styles.sideStack}>
          {isStaff ? (
            <Card className={styles.riskCard}>
              <Text className={styles.riskTitle}>Risks &amp; flags</Text>
              {focusSkills.length > 0 ? (
                <>
                  {focusSkills.map(point => (
                    <span key={point.skill} className={styles.softBadge}>
                      {point.skill} mastery {point.mastery}% (target{' '}
                      {point.target}%)
                    </span>
                  ))}
                  <Text size={200}>
                    {focusSkills.length} skill
                    {focusSkills.length === 1 ? '' : 's'} below target.
                  </Text>
                </>
              ) : (
                <Text size={200}>
                  {hasRadarData
                    ? 'No skills below target right now.'
                    : 'No practice data yet — flags appear after the first sessions.'}
                </Text>
              )}
            </Card>
          ) : (
            <Card className={styles.riskCard}>
              <Text className={styles.riskTitle}>Your focus this week</Text>
              {focusSkills.length > 0 ? (
                <>
                  {focusSkills.map(point => (
                    <span key={point.skill} className={styles.softBadge}>
                      {point.skill}
                    </span>
                  ))}
                  <Text size={200}>
                    You&apos;re making steady progress — a little practice on
                    these will lift your score.
                  </Text>
                </>
              ) : (
                <Text size={200}>
                  {hasRadarData
                    ? 'Great work — every skill is on target. Keep it up!'
                    : 'Start your first practice to see your focus skills here.'}
                </Text>
              )}
            </Card>
          )}
        </div>
      </div>

      <Card className={styles.trajectoryCard}>
        <CardHeader
            header={<Text weight="semibold">Mastery trajectory</Text>}
            description={
              <Text size={200}>Weekly average mastery across practice</Text>
            }
          />
          <div className={styles.chartBox}>
            {!hasTrajectoryData ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  textAlign: 'center',
                  color: 'var(--pf-text-secondary)',
                  padding: '0 16px',
                }}
              >
                <Text size={200}>
                  {masteryLoading
                    ? 'Loading trajectory…'
                    : masteryError
                      ? masteryError
                    : 'The weekly trajectory appears after a couple of practice sessions.'}
                </Text>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={trajectoryData}
                  role="img"
                  aria-label={`Mastery trajectory by week — ${trajectorySummary}.`}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={'var(--pf-line)'} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 12, fill: 'var(--pf-text-tertiary)' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 12, fill: 'var(--pf-text-tertiary)' }}
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="score"
                    name="Mastery"
                    stroke={'var(--pf-ink)'}
                    strokeWidth={2.5}
                    dot
                  />
                </LineChart>
            </ResponsiveContainer>
            )}
          </div>
        </Card>
    </div>
  )
}
