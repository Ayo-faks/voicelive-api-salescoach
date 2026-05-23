import {
  Badge,
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
    fontFamily: 'Manrope, sans-serif',
    fontSize: '1.5rem',
    fontWeight: 800,
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
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
    gap: '18px',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  chartCard: {
    padding: '16px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '10px',
  },
  chartBox: {
    height: '260px',
    width: '100%',
  },
  riskCard: {
    padding: '16px',
    borderRadius: '14px',
    border: '1px solid #a3a3a3',
    backgroundColor: '#fffbeb',
    display: 'grid',
    gap: '8px',
  },
  riskTitle: {
    fontWeight: 800,
    color: '#92400e',
  },
  sideStack: {
    display: 'grid',
    gap: '14px',
    alignContent: 'start',
  },
  trajectoryCard: {
    padding: '16px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '10px',
  },
  tabRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
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
            Tobi A. · Learner Insights Profile
          </Text>
          <Text className={styles.subtitle}>
            JSS2 · en-NG · counsellor-gated. Mastery, trajectory, risks and
            career fit, side-by-side.
          </Text>
          <div className={styles.metaBadges}>
            <Badge appearance="tint">Current focus: ratio</Badge>
            <Badge appearance="tint">Review: 2026-06-02</Badge>
            <Badge appearance="filled">Counsellor sign-off</Badge>
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
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fontSize: 12, fill: '#475569' }}
                />
                <PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                />
                <Radar
                  name="Mastery"
                  dataKey="mastery"
                  stroke="#0a0a0a"
                  fill="#0a0a0a"
                  fillOpacity={0.35}
                />
                <Radar
                  name="Target"
                  dataKey="target"
                  stroke="#525252"
                  fill="#525252"
                  fillOpacity={0.1}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className={styles.sideStack}>
          <Card className={styles.riskCard}>
            <Text className={styles.riskTitle}>Risks & flags</Text>
            <Badge appearance="tint">Ratio mastery below 50%</Badge>
            <Badge appearance="tint">Uncertainty rising on linear eq.</Badge>
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
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="ratio"
                  stroke="#0a0a0a"
                  strokeWidth={2.5}
                  dot
                />
                <Line
                  type="monotone"
                  dataKey="fractions"
                  stroke="#525252"
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
            onApproveNarration={id => pushEvent(`Approved narration ${id}`)}
            onRejectNarration={id => pushEvent(`Rejected narration ${id}`)}
          />
          <VoiceQueueCard voiceQueue={voiceQueue} />
          {auditEvents.length > 0 && (
            <Card>
              <CardHeader
                header={<Text weight="semibold">Recent actions</Text>}
              />
              <div style={{ display: 'grid', gap: '6px', marginTop: '8px' }}>
                {auditEvents.slice(-5).reverse().map(e => (
                  <Badge key={e} appearance="outline">
                    {e}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
