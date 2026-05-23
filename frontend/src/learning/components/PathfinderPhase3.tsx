import {
  Badge,
  Button,
  Card,
  CardHeader,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  CheckCircleIcon,
  ShieldCheckIcon,
  SpeakerWaveIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'

export type Phase3ProvenanceView = {
  source: string
  ruleId?: string
  confidence: number
  evidenceCount: number
}

export type LabourSignalView = {
  source: string
  recency: string
  confidence: number
  value: Record<string, string | number>
}

export type CareerPathwayView = {
  pathwayId: string
  title: string
  fitScore: number
  wageBand: LabourSignalView
  demandTrend: LabourSignalView
  rationale: string
}

export type CareerPlanView = {
  planId: string
  studentId: string
  lang: string
  requiresCounsellorSignoff: boolean
  pathways: CareerPathwayView[]
  provenance: Phase3ProvenanceView[]
}

export type AdvisorDecisionView = {
  allowed: boolean
  riskLevel: 'allow' | 'review' | 'refuse'
  reasons: string[]
  typedRefusal?: string
}

export type ParentProgressViewModel = {
  studentId: string
  masterySummary: string
  nextReview: string
  lang: string
  provenance: Phase3ProvenanceView[]
}

export type VoiceQueueView = {
  lang: string
  queued: boolean
  offlineFallback: string
  transcript?: string
  provenance: Phase3ProvenanceView[]
}

type CareerNavigatorCardProps = {
  plan: CareerPlanView
}

type CounsellorGatePanelProps = {
  plan: CareerPlanView
  decision: AdvisorDecisionView
  onApproveNarration?: (planId: string) => void
  onRejectNarration?: (planId: string) => void
}

type PathfinderPhase3DemoProps = {
  plan: CareerPlanView
  decision: AdvisorDecisionView
  parentProgress: ParentProgressViewModel
  voiceQueue: VoiceQueueView
  onApproveNarration?: (planId: string) => void
  onRejectNarration?: (planId: string) => void
}

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '16px',
    width: '100%',
  },
  cardGrid: {
    display: 'grid',
    gap: '12px',
  },
  pathwayTable: {
    width: '100%',
    minWidth: '620px',
    borderCollapse: 'separate',
    borderSpacing: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  scroller: {
    overflowX: 'auto',
  },
  headerCell: {
    padding: '10px 12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    textAlign: 'left',
    fontWeight: 600,
  },
  cell: {
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '12px',
  },
  icon: {
    width: '18px',
    height: '18px',
  },
  provenanceFooter: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '12px',
    paddingTop: '10px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },
})

export function Phase3ProvenanceFooter({
  provenance,
}: {
  provenance: Phase3ProvenanceView[]
}) {
  const styles = useStyles()

  return (
    <footer
      className={styles.provenanceFooter}
      data-testid="phase3-provenance-footer"
      data-provenance-count={provenance.length}
    >
      {provenance.map((entry, index) => (
        <Badge
          key={`${entry.source}:${entry.ruleId ?? index}`}
          appearance="outline"
        >
          {entry.source}
          {entry.ruleId ? ` / ${entry.ruleId}` : ''} · {entry.evidenceCount}{' '}
          evidence
        </Badge>
      ))}
    </footer>
  )
}

export function CareerNavigatorCard({ plan }: CareerNavigatorCardProps) {
  const styles = useStyles()

  return (
    <Card data-testid="phase3-career-card">
      <CardHeader
        header={<Text weight="semibold">Career Navigator shortlist</Text>}
        description={<Text size={200}>{plan.lang}</Text>}
      />
      <div className={styles.scroller}>
        <table
          className={styles.pathwayTable}
          aria-label="Career pathway shortlist"
        >
          <thead>
            <tr>
              <th className={styles.headerCell} scope="col">
                Pathway
              </th>
              <th className={styles.headerCell} scope="col">
                Fit
              </th>
              <th className={styles.headerCell} scope="col">
                Wage band
              </th>
              <th className={styles.headerCell} scope="col">
                Demand
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.pathways.map(pathway => (
              <tr
                key={pathway.pathwayId}
                data-testid={`phase3-pathway-${pathway.pathwayId}`}
              >
                <td className={styles.cell}>{pathway.title}</td>
                <td className={styles.cell}>
                  {Math.round(pathway.fitScore * 100)}%
                </td>
                <td className={styles.cell}>
                  {pathway.wageBand.source} · {pathway.wageBand.recency}
                </td>
                <td className={styles.cell}>
                  {pathway.demandTrend.source} ·{' '}
                  {String(pathway.demandTrend.value.trend)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Phase3ProvenanceFooter provenance={plan.provenance} />
    </Card>
  )
}

export function CounsellorGatePanel({
  plan,
  decision,
  onApproveNarration,
  onRejectNarration,
}: CounsellorGatePanelProps) {
  const styles = useStyles()

  return (
    <Card
      data-testid="phase3-counsellor-gate"
      data-risk-level={decision.riskLevel}
    >
      <CardHeader
        header={<Text weight="semibold">Counsellor narration gate</Text>}
        description={
          <Text size={200}>
            {decision.allowed ? 'Advisor passed' : 'Typed refusal'}
          </Text>
        }
      />
      {decision.allowed ? (
        <Text>Advisor passed grounding, safety and PII checks.</Text>
      ) : (
        <Text>{decision.typedRefusal}</Text>
      )}
      <div className={styles.actions}>
        <Tooltip content="Approve narration" relationship="label">
          <Button
            appearance="primary"
            icon={
              <CheckCircleIcon className={styles.icon} aria-hidden="true" />
            }
            onClick={() => onApproveNarration?.(plan.planId)}
          />
        </Tooltip>
        <Tooltip content="Reject narration" relationship="label">
          <Button
            appearance="secondary"
            icon={<XCircleIcon className={styles.icon} aria-hidden="true" />}
            onClick={() => onRejectNarration?.(plan.planId)}
          />
        </Tooltip>
      </div>
    </Card>
  )
}

export function ParentProgressCard({
  progress,
}: {
  progress: ParentProgressViewModel
}) {
  return (
    <Card data-testid="phase3-parent-progress-card">
      <CardHeader
        header={<Text weight="semibold">Parent progress view</Text>}
        description={<Text size={200}>{progress.lang}</Text>}
      />
      <Text>{progress.masterySummary}</Text>
      <Badge appearance="tint">Next review: {progress.nextReview}</Badge>
      <Phase3ProvenanceFooter provenance={progress.provenance} />
    </Card>
  )
}

export function VoiceQueueCard({ voiceQueue }: { voiceQueue: VoiceQueueView }) {
  const styles = useStyles()

  return (
    <Card
      data-testid="phase3-voice-queue-card"
      data-queued={voiceQueue.queued ? 'true' : 'false'}
    >
      <CardHeader
        header={<Text weight="semibold">Yoruba voice path</Text>}
        description={<Text size={200}>{voiceQueue.lang}</Text>}
        image={<SpeakerWaveIcon className={styles.icon} aria-hidden="true" />}
      />
      <Text>
        {voiceQueue.queued ? voiceQueue.offlineFallback : voiceQueue.transcript}
      </Text>
      <Phase3ProvenanceFooter provenance={voiceQueue.provenance} />
    </Card>
  )
}

export function PathfinderPhase3Demo({
  plan,
  decision,
  parentProgress,
  voiceQueue,
  onApproveNarration,
  onRejectNarration,
}: PathfinderPhase3DemoProps) {
  const styles = useStyles()

  return (
    <section className={styles.shell} data-testid="phase3-pilot-workspace">
      <Badge
        appearance="filled"
        icon={<ShieldCheckIcon className={styles.icon} aria-hidden="true" />}
      >
        Counsellor-gated pilot view
      </Badge>
      <CareerNavigatorCard plan={plan} />
      <div className={styles.cardGrid}>
        <CounsellorGatePanel
          plan={plan}
          decision={decision}
          onApproveNarration={onApproveNarration}
          onRejectNarration={onRejectNarration}
        />
        <ParentProgressCard progress={parentProgress} />
        <VoiceQueueCard voiceQueue={voiceQueue} />
      </div>
    </section>
  )
}
