import {
  Card,
  CardHeader,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useState } from 'react'
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
import {
  CounsellorGatePanel,
  ParentProgressCard,
  Phase3ProvenanceFooter,
  VoiceQueueCard,
} from '../components/PathfinderPhase3'
import {
  advisorDecision,
  careerPlan,
  parentProgress,
  voiceQueue,
} from '../fixtures'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const radarData = [
  { skill: 'Ratio', mastery: 42, target: 75 },
  { skill: 'Fractions', mastery: 61, target: 75 },
  { skill: 'Linear eq.', mastery: 74, target: 75 },
  { skill: 'Geometry', mastery: 86, target: 75 },
  { skill: 'Measurement', mastery: 68, target: 75 },
  { skill: 'Statistics', mastery: 55, target: 75 },
]

const trajectoryData = [
  { week: 'W1', ratio: 22, fractions: 41 },
  { week: 'W2', ratio: 28, fractions: 47 },
  { week: 'W3', ratio: 31, fractions: 53 },
  { week: 'W4', ratio: 35, fractions: 56 },
  { week: 'W5', ratio: 38, fractions: 58 },
  { week: 'W6', ratio: 42, fractions: 61 },
]

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
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
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
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
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
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
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
    border: t.surface.hairline,
    borderLeft: `3px solid ${t.status.warnFg}`,
    backgroundColor: t.surface.card,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '8px',
  },
  riskTitle: {
    fontWeight: 800,
    color: t.brand.text,
  },
  sideStack: {
    display: 'grid',
    gap: '14px',
    alignContent: 'start',
  },
  trajectoryCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '10px',
  },
  auditCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '8px',
  },
  tabRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  auditEventList: {
    display: 'grid',
    gap: '6px',
    marginTop: '8px',
  },
  auditEventItem: {
    display: 'block',
    padding: '5px 9px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    fontSize: '0.72rem',
    fontWeight: 650,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
})

export default function StudentMasteryProfile() {
  const styles = useStyles()
  const [auditEvents, setAuditEvents] = useState<string[]>([])

  function pushEvent(e: string) {
    setAuditEvents(cur => [...cur, e])
  }

  return (
    <div className={styles.shell} data-testid="route-student-profile">
      <div className={styles.headerRow}>
        <div className={styles.studentMeta}>
          <Text as="h1" className={styles.title}>
            Tobi A.
          </Text>
          <div className={styles.metaBadges}>
            <span className={styles.softBadgeSolid}>Learner insights profile</span>
            <span className={styles.softBadge}>JSS2</span>
            <span className={styles.softBadge}>English</span>
            <span className={styles.softBadge}>Mastery trajectory</span>
            <span className={styles.softBadge}>Career fit</span>
          </div>
          <div className={styles.metaBadges}>
            <span className={styles.softBadge}>Current focus: ratio</span>
            <span className={styles.softBadge}>Review: 2026-06-02</span>
            <span className={styles.softBadgeSolid}>Counsellor sign-off</span>
          </div>
        </div>
      </div>

      <div className={styles.twoCol}>
        <Card className={styles.chartCard}>
          <CardHeader
            header={<Text weight="semibold">Skill radar</Text>}
            description={
              <Text size={200}>Mastery vs JSS2 target (75%)</Text>
            }
          />
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke={t.brand.line} />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fontSize: 12, fill: t.brand.textSecondary }}
                />
                <PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: t.brand.textTertiary }}
                />
                <Radar
                  name="Mastery"
                  dataKey="mastery"
                  stroke={t.brand.ink}
                  fill={t.brand.ink}
                  fillOpacity={0.35}
                />
                <Radar
                  name="Target"
                  dataKey="target"
                  stroke={t.brand.inkMuted}
                  fill={t.brand.inkMuted}
                  fillOpacity={0.1}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className={styles.sideStack}>
          <Card className={styles.riskCard}>
            <Text className={styles.riskTitle}>Risks & flags</Text>
            <span className={styles.softBadge}>Ratio mastery below 50%</span>
            <span className={styles.softBadge}>Uncertainty rising on linear eq.</span>
            <Text size={200}>
              Two risks open. Counsellor review scheduled 2026-06-02.
            </Text>
          </Card>
          <ParentProgressCard progress={parentProgress} />
        </div>
      </div>

      <div className={styles.twoCol}>
        <Card className={styles.trajectoryCard}>
          <CardHeader
            header={<Text weight="semibold">Mastery trajectory</Text>}
            description={<Text size={200}>Last 6 weeks · ratio vs fractions</Text>}
          />
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trajectoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.brand.line} />
                <XAxis dataKey="week" tick={{ fontSize: 12, fill: t.brand.textTertiary }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: t.brand.textTertiary }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="ratio"
                  stroke={t.brand.ink}
                  strokeWidth={2.5}
                  dot
                />
                <Line
                  type="monotone"
                  dataKey="fractions"
                  stroke={t.brand.inkMuted}
                  strokeWidth={2.5}
                  dot
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Phase3ProvenanceFooter provenance={careerPlan.provenance} />
        </Card>

        <div className={styles.sideStack}>
          <CounsellorGatePanel
            plan={careerPlan}
            decision={advisorDecision}
            onApproveNarration={() => pushEvent('Counsellor guidance approved')}
            onRejectNarration={() => pushEvent('Counsellor guidance sent back for revision')}
          />
          <VoiceQueueCard voiceQueue={voiceQueue} />
          {auditEvents.length > 0 && (
            <Card className={styles.auditCard}>
              <CardHeader
                header={<Text weight="semibold">Recent actions</Text>}
              />
              <div className={styles.auditEventList}>
                {auditEvents.slice(-5).reverse().map(e => (
                  <span key={e} className={styles.auditEventItem}>
                    {e}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
