import { Card, CardHeader, Text, makeStyles } from '@fluentui/react-components'
import {
  CheckCircleIcon,
  ShieldCheckIcon,
  SpeakerWaveIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

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
  surfaceCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: '10px',
  },
  pathwayTable: {
    width: '100%',
    minWidth: '620px',
    borderCollapse: 'separate',
    borderSpacing: 0,
    border: 'var(--pf-hairline)',
    borderRadius: t.radius.md,
    overflow: 'hidden',
  },
  scroller: {
    overflowX: 'auto',
  },
  headerCell: {
    padding: '10px 12px',
    backgroundColor: 'var(--pf-surface-muted)',
    borderBottom: 'var(--pf-hairline)',
    color: 'var(--pf-text-secondary)',
    textAlign: 'left',
    fontWeight: 600,
  },
  cell: {
    padding: '10px 12px',
    borderBottom: 'var(--pf-hairline)',
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
    borderTop: 'var(--pf-hairline)',
    color: 'var(--pf-text-tertiary)',
  },
  metadataBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'start',
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
  provenanceChip: {
    display: 'inline-flex',
    maxWidth: '100%',
    minHeight: '24px',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.72rem',
    fontWeight: 650,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
  },
  iconButtonPrimary: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    minWidth: '38px',
    minHeight: '38px',
    borderRadius: t.radius.pill,
    border: `1px solid var(--pf-ink)`,
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    ':hover': {
      backgroundColor: 'var(--pf-ink-muted)',
      color: 'var(--pf-on-ink)',
      border: `1px solid var(--pf-ink-muted)`,
    },
  },
  iconButtonSecondary: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    minWidth: '38px',
    minHeight: '38px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      color: 'var(--pf-text)',
      border: 'var(--pf-hairline)',
    },
  },
})

function languageLabel(value: string) {
  if (value === 'en-NG') return 'English'
  if (value === 'yo-NG') return 'Yoruba'
  return 'Learner language'
}

function signalLabel(value: string) {
  if (value.toLowerCase().includes('labour')) return 'Labour market outlook'
  if (value.toLowerCase().includes('career')) return 'Career guidance'
  if (value.toLowerCase().includes('voice')) return 'Voice practice'
  if (value.toLowerCase().includes('parent')) return 'Family progress'
  return 'Review signal'
}

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
        <span
          key={`${entry.source}:${entry.ruleId ?? index}`}
          className={styles.provenanceChip}
        >
          {signalLabel(entry.source)} · {entry.evidenceCount} evidence point
          {entry.evidenceCount === 1 ? '' : 's'}
        </span>
      ))}
    </footer>
  )
}

export function CareerNavigatorCard({ plan }: CareerNavigatorCardProps) {
  const styles = useStyles()

  return (
    <Card className={styles.surfaceCard} data-testid="phase3-career-card">
      <CardHeader
        header={<Text weight="semibold">Career Navigator shortlist</Text>}
        description={
          <Text size={200}>{languageLabel(plan.lang)} guidance</Text>
        }
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
                  <div>Wage outlook · {pathway.wageBand.recency}</div>
                  <span className={styles.metadataBadge}>
                    {pathway.wageBand.source}
                  </span>
                </td>
                <td className={styles.cell}>
                  <div>{String(pathway.demandTrend.value.trend)}</div>
                  <span className={styles.metadataBadge}>
                    {pathway.demandTrend.source}
                  </span>
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
      className={styles.surfaceCard}
      data-testid="phase3-counsellor-gate"
      data-risk-level={decision.riskLevel}
    >
      <CardHeader
        header={<Text weight="semibold">Counsellor review</Text>}
        description={
          <Text size={200}>
            {decision.allowed ? 'Guidance approved' : 'Guidance needs revision'}
          </Text>
        }
      />
      {decision.allowed ? (
        <Text>Guidance passed grounding, safety and privacy checks.</Text>
      ) : (
        <Text>{decision.typedRefusal}</Text>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButtonPrimary}
          aria-label="Approve narration"
          title="Approve narration"
          onClick={() => onApproveNarration?.(plan.planId)}
        >
          <CheckCircleIcon className={styles.icon} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButtonSecondary}
          aria-label="Reject narration"
          title="Reject narration"
          onClick={() => onRejectNarration?.(plan.planId)}
        >
          <XCircleIcon className={styles.icon} aria-hidden="true" />
        </button>
      </div>
    </Card>
  )
}

export function ParentProgressCard({
  progress,
}: {
  progress: ParentProgressViewModel
}) {
  const styles = useStyles()

  return (
    <Card
      className={styles.surfaceCard}
      data-testid="phase3-parent-progress-card"
    >
      <CardHeader
        header={<Text weight="semibold">Parent progress</Text>}
        description={
          <Text size={200}>{languageLabel(progress.lang)} family summary</Text>
        }
      />
      <Text>{progress.masterySummary}</Text>
      <Phase3ProvenanceFooter provenance={progress.provenance} />
    </Card>
  )
}

export function VoiceQueueCard({ voiceQueue }: { voiceQueue: VoiceQueueView }) {
  const styles = useStyles()

  return (
    <Card
      className={styles.surfaceCard}
      data-testid="phase3-voice-queue-card"
      data-queued={voiceQueue.queued ? 'true' : 'false'}
    >
      <CardHeader
        header={<Text weight="semibold">Yoruba voice path</Text>}
        description={
          <Text size={200}>{languageLabel(voiceQueue.lang)} practice</Text>
        }
        image={<SpeakerWaveIcon className={styles.icon} aria-hidden="true" />}
      />
      <Text>
        {voiceQueue.queued
          ? "Saved offline — we'll play this voice practice as soon as you're back online."
          : voiceQueue.transcript}
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
      <span className={styles.metadataBadge}>
        <ShieldCheckIcon className={styles.icon} aria-hidden="true" />
        Counsellor-reviewed experience
      </span>
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
