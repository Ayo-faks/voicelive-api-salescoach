import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { CheckCircleIcon, PaperAirplaneIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { useState, type FormEvent } from 'react'

export type ProvenanceView = {
  source: string
  sourceId?: string
  ruleId?: string
  confidence: number
  evidenceCount: number
}

export type HeatmapCellView = {
  studentId: string
  skillId: string
  skillLabel: string
  probability: number
  uncertainty: number
  status: 'secure' | 'developing' | 'needs_support'
  lang: string
  provenance: ProvenanceView[]
}

export type PendingApprovalPlanView = {
  planId: string
  targetSkillIds: string[]
  targetStudentIds: string[]
  itemTypes: string[]
  suggestedResources: string[]
  rationale: string
  requiresApproval: boolean
  lang: string
  provenance: ProvenanceView[]
}

type MultimodalIntentBarProps = {
  value?: string
  disabled?: boolean
  onSubmitIntent: (value: string) => void
}

type TeacherHeatmapProps = {
  cells: HeatmapCellView[]
}

type PendingApprovalCardProps = {
  plan: PendingApprovalPlanView
  onApprove?: (planId: string) => void
  onReject?: (planId: string) => void
}

type PathfinderPhase2DemoProps = {
  cells: HeatmapCellView[]
  pendingPlan: PendingApprovalPlanView
  onSubmitIntent?: (value: string) => void
  onApprove?: (planId: string) => void
  onReject?: (planId: string) => void
}

const statusLabels: Record<HeatmapCellView['status'], string> = {
  secure: 'Secure',
  developing: 'Developing',
  needs_support: 'Needs support',
}

const statusAppearances: Record<HeatmapCellView['status'], 'filled' | 'tint' | 'outline'> = {
  secure: 'filled',
  developing: 'tint',
  needs_support: 'outline',
}

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '16px',
    width: '100%',
  },
  intentForm: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) auto',
    gap: '8px',
    alignItems: 'center',
  },
  icon: {
    width: '18px',
    height: '18px',
  },
  heatmap: {
    display: 'grid',
    gap: '10px',
  },
  heatmapScroller: {
    overflowX: 'auto',
  },
  heatmapGrid: {
    width: '100%',
    minWidth: '520px',
    borderCollapse: 'separate',
    borderSpacing: 0,
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: 'hidden',
  },
  gridHeader: {
    padding: '10px 12px',
    backgroundColor: tokens.colorNeutralBackground2,
    fontWeight: 600,
    textAlign: 'left',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  gridCell: {
    padding: '10px 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  skillLabel: {
    display: 'block',
    overflowWrap: 'anywhere',
  },
  planActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '12px',
  },
  planMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '8px',
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

export function MultimodalIntentBar({ value = '', disabled = false, onSubmitIntent }: MultimodalIntentBarProps) {
  const styles = useStyles()
  const [intent, setIntent] = useState(value)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedIntent = intent.trim()
    if (!trimmedIntent) return
    onSubmitIntent(trimmedIntent)
  }

  return (
    <form className={styles.intentForm} onSubmit={handleSubmit} data-testid="phase2-intent-bar">
      <Input
        aria-label="Text request"
        value={intent}
        disabled={disabled}
        placeholder="Group students by skill gap"
        onChange={(_, data) => setIntent(data.value)}
      />
      <Tooltip content="Send request" relationship="label">
        <Button
          type="submit"
          appearance="primary"
          disabled={disabled || !intent.trim()}
          icon={<PaperAirplaneIcon className={styles.icon} aria-hidden="true" />}
        />
      </Tooltip>
    </form>
  )
}

export function TeacherHeatmap({ cells }: TeacherHeatmapProps) {
  const styles = useStyles()

  return (
    <Card className={styles.heatmap} data-testid="phase2-teacher-heatmap">
      <CardHeader header={<Text weight="semibold">JSS2 mastery heatmap</Text>} />
      <div className={styles.heatmapScroller}>
        <table className={styles.heatmapGrid} aria-label="JSS2 mastery heatmap grid">
          <thead>
            <tr>
              <th className={styles.gridHeader} scope="col">Skill</th>
              <th className={styles.gridHeader} scope="col">Mastery</th>
              <th className={styles.gridHeader} scope="col">Uncertainty</th>
              <th className={styles.gridHeader} scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => (
              <tr key={`${cell.studentId}:${cell.skillId}`} data-testid={`phase2-heatmap-row-${cell.skillId}`}>
                <td className={styles.gridCell}>
                  <span className={styles.skillLabel}>{cell.skillLabel}</span>
                </td>
                <td className={styles.gridCell}>{Math.round(cell.probability * 100)}%</td>
                <td className={styles.gridCell}>{Math.round(cell.uncertainty * 100)}%</td>
                <td className={styles.gridCell}>
                  <Badge appearance={statusAppearances[cell.status]}>{statusLabels[cell.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function ProvenanceFooter({ provenance }: { provenance: ProvenanceView[] }) {
  const styles = useStyles()

  return (
    <footer
      className={styles.provenanceFooter}
      data-testid="phase2-provenance-footer"
      data-provenance-count={provenance.length}
    >
      {provenance.map((entry, index) => (
        <Badge key={`${entry.source}:${entry.ruleId ?? index}`} appearance="outline">
          {entry.source}{entry.ruleId ? ` / ${entry.ruleId}` : ''} · {entry.evidenceCount} evidence
        </Badge>
      ))}
    </footer>
  )
}

export function PendingApprovalCard({ plan, onApprove, onReject }: PendingApprovalCardProps) {
  const styles = useStyles()

  return (
    <Card data-testid="phase2-pending-approval-card">
      <CardHeader
        header={<Text weight="semibold">Pending teacher approval</Text>}
        description={<Text size={200}>{plan.lang}</Text>}
      />
      <Text>{plan.rationale}</Text>
      <div className={styles.planMeta}>
        {plan.targetSkillIds.map((skillId) => (
          <Badge key={skillId} appearance="tint">{skillId}</Badge>
        ))}
      </div>
      <div className={styles.planActions}>
        <Button
          appearance="primary"
          icon={<CheckCircleIcon className={styles.icon} aria-hidden="true" />}
          onClick={() => onApprove?.(plan.planId)}
        >
          Approve
        </Button>
        <Button
          appearance="secondary"
          icon={<XCircleIcon className={styles.icon} aria-hidden="true" />}
          onClick={() => onReject?.(plan.planId)}
        >
          Reject
        </Button>
      </div>
      <ProvenanceFooter provenance={plan.provenance} />
    </Card>
  )
}

export function PathfinderPhase2Demo({
  cells,
  pendingPlan,
  onSubmitIntent = () => {},
  onApprove,
  onReject,
}: PathfinderPhase2DemoProps) {
  const styles = useStyles()

  return (
    <section className={styles.shell} data-testid="phase2-teacher-workspace">
      <MultimodalIntentBar onSubmitIntent={onSubmitIntent} />
      <TeacherHeatmap cells={cells} />
      <PendingApprovalCard plan={pendingPlan} onApprove={onApprove} onReject={onReject} />
    </section>
  )
}