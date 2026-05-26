import {
  Button,
  Card,
  CardHeader,
  Input,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
} from '@fluentui/react-components'
import {
  CheckCircleIcon,
  DocumentTextIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

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

export type PendingApprovalPlanEdits = Pick<
  PendingApprovalPlanView,
  | 'targetSkillIds'
  | 'targetStudentIds'
  | 'itemTypes'
  | 'suggestedResources'
  | 'rationale'
>

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
  onApprove?: (planId: string) => void | Promise<void>
  onReject?: (planId: string) => void | Promise<void>
  onEditApprove?: (
    planId: string,
    edits: PendingApprovalPlanEdits,
    reason: string
  ) => void | Promise<void>
}

type PathfinderPhase2DemoProps = {
  cells: HeatmapCellView[]
  pendingPlan: PendingApprovalPlanView
  onSubmitIntent?: (value: string) => void
  onApprove?: (planId: string) => void
  onReject?: (planId: string) => void
  onEditApprove?: PendingApprovalCardProps['onEditApprove']
}

const statusLabels: Record<HeatmapCellView['status'], string> = {
  secure: 'Secure',
  developing: 'Developing',
  needs_support: 'Needs support',
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
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardElevatedShadow,
  },
  heatmapScroller: {
    overflowX: 'auto',
  },
  heatmapGrid: {
    width: '100%',
    minWidth: '520px',
    borderCollapse: 'separate',
    borderSpacing: 0,
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    overflow: 'hidden',
  },
  gridHeader: {
    padding: '10px 12px',
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    fontWeight: 600,
    textAlign: 'left',
    borderBottom: t.surface.hairline,
  },
  gridCell: {
    padding: '10px 12px',
    backgroundColor: t.brand.surface,
    minWidth: 0,
    borderBottom: t.surface.hairline,
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
  dangerButton: {
    minHeight: '36px',
    borderRadius: t.radius.pill,
    fontWeight: 800,
    border: `1px solid ${t.status.criticalFg}`,
    backgroundColor: t.brand.surface,
    color: t.status.criticalFg,
    ':hover': {
      backgroundColor: t.status.criticalBg,
      color: t.status.criticalFg,
      border: `1px solid ${t.status.criticalFg}`,
    },
  },
  primaryButton: {
    minHeight: '36px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    fontWeight: 800,
    ':hover': {
      backgroundColor: t.brand.inkMuted,
      color: t.brand.onInk,
      border: `1px solid ${t.brand.inkMuted}`,
    },
  },
  secondaryButton: {
    minHeight: '36px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    fontWeight: 800,
    ':hover': {
      backgroundColor: t.surface.cardMuted,
      color: t.brand.text,
      border: t.surface.hairline,
    },
  },
  iconButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    minWidth: '38px',
    minHeight: '38px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    ':hover': {
      backgroundColor: t.brand.inkMuted,
      color: t.brand.onInk,
      border: `1px solid ${t.brand.inkMuted}`,
    },
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  approvalCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '10px',
  },
  editForm: {
    display: 'grid',
    gap: '10px',
    marginTop: '12px',
    padding: '12px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  editLabel: {
    display: 'grid',
    gap: '4px',
    fontWeight: 600,
  },
  editHelp: {
    color: t.brand.textTertiary,
  },
  planReview: {
    display: 'grid',
    gap: '10px',
    marginTop: '12px',
    padding: '12px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  planReviewGrid: {
    display: 'grid',
    gap: '8px',
  },
  planSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 640px)': { gridTemplateColumns: '1fr' },
  },
  planSummaryItem: {
    display: 'grid',
    gap: '4px',
    padding: '12px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  planSummaryValue: {
    color: t.brand.text,
    fontWeight: 800,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  planReviewRow: {
    display: 'grid',
    gap: '3px',
  },
  planReviewLabel: {
    color: t.brand.textTertiary,
    fontSize: '0.72rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  planReviewValue: {
    color: t.brand.text,
    overflowWrap: 'anywhere',
  },
  planMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '8px',
  },
  metaBadge: {
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
  provenanceFooter: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '12px',
    paddingTop: '10px',
    borderTop: t.surface.hairline,
    color: t.brand.textTertiary,
  },
  provenanceChip: {
    display: 'inline-flex',
    maxWidth: '100%',
    minHeight: '24px',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    fontSize: '0.72rem',
    fontWeight: 650,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 800,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  statusSecure: {
    backgroundColor: t.risk.low.bg,
    color: t.risk.low.fg,
  },
  statusDeveloping: {
    backgroundColor: t.risk.review.bg,
    color: t.risk.review.fg,
  },
  statusSupport: {
    backgroundColor: t.risk.high.bg,
    color: t.risk.high.fg,
  },
})

function statusClass(styles: ReturnType<typeof useStyles>, status: HeatmapCellView['status']) {
  if (status === 'secure') return styles.statusSecure
  if (status === 'developing') return styles.statusDeveloping
  return styles.statusSupport
}

function listToText(values: string[]): string {
  return values.join(', ')
}

function textToList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function formFromPlan(plan: PendingApprovalPlanView) {
  return {
    targetSkillIds: listToText(plan.targetSkillIds),
    targetStudentIds: listToText(plan.targetStudentIds),
    itemTypes: listToText(plan.itemTypes),
    suggestedResources: listToText(plan.suggestedResources),
    rationale: plan.rationale,
    reason: 'Adjusted after teacher review',
  }
}

function languageLabel(value: string) {
  if (value === 'en-NG') return 'English'
  if (value === 'yo-NG') return 'Yoruba'
  return 'Learner language'
}

function learnerCountLabel(count: number) {
  return `${count} learner${count === 1 ? '' : 's'}`
}

export function MultimodalIntentBar({
  value = '',
  disabled = false,
  onSubmitIntent,
}: MultimodalIntentBarProps) {
  const styles = useStyles()
  const [intent, setIntent] = useState(value)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedIntent = intent.trim()
    if (!trimmedIntent) return
    onSubmitIntent(trimmedIntent)
  }

  return (
    <form
      className={styles.intentForm}
      onSubmit={handleSubmit}
      data-testid="phase2-intent-bar"
    >
      <Input
        aria-label="Text request"
        value={intent}
        disabled={disabled}
        placeholder="Group students by skill gap"
        onChange={(_, data) => setIntent(data.value)}
      />
      <Tooltip content="Send request" relationship="label">
        <button
          type="submit"
          className={styles.iconButton}
          disabled={disabled || !intent.trim()}
          aria-label="Send request"
        >
          <PaperAirplaneIcon className={styles.icon} aria-hidden="true" />
        </button>
      </Tooltip>
    </form>
  )
}

export function TeacherHeatmap({ cells }: TeacherHeatmapProps) {
  const styles = useStyles()

  return (
    <Card className={styles.heatmap} data-testid="phase2-teacher-heatmap">
      <CardHeader
        header={<Text weight="semibold">Class mastery heatmap</Text>}
      />
      <div className={styles.heatmapScroller}>
        <table
          className={styles.heatmapGrid}
          aria-label="Class mastery heatmap grid"
        >
          <thead>
            <tr>
              <th className={styles.gridHeader} scope="col">
                Skill
              </th>
              <th className={styles.gridHeader} scope="col">
                Mastery
              </th>
              <th className={styles.gridHeader} scope="col">
                Uncertainty
              </th>
              <th className={styles.gridHeader} scope="col">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {cells.map(cell => (
              <tr
                key={`${cell.studentId}:${cell.skillId}`}
                data-testid={`phase2-heatmap-row-${cell.skillId}`}
              >
                <td className={styles.gridCell}>
                  <span className={styles.skillLabel}>{cell.skillLabel}</span>
                </td>
                <td className={styles.gridCell}>
                  {Math.round(cell.probability * 100)}%
                </td>
                <td className={styles.gridCell}>
                  {Math.round(cell.uncertainty * 100)}%
                </td>
                <td className={styles.gridCell}>
                  <span className={`${styles.statusPill} ${statusClass(styles, cell.status)}`}>
                    {statusLabels[cell.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function ProvenanceFooter({
  provenance,
}: {
  provenance: ProvenanceView[]
}) {
  const styles = useStyles()

  return (
    <footer
      className={styles.provenanceFooter}
      data-testid="phase2-provenance-footer"
      data-provenance-count={provenance.length}
    >
      {provenance.map((entry, index) => (
        <span
          key={`${entry.source}:${entry.ruleId ?? index}`}
          className={styles.provenanceChip}
        >
          Review signal {index + 1} · {entry.evidenceCount} evidence point{entry.evidenceCount === 1 ? '' : 's'}
        </span>
      ))}
    </footer>
  )
}

export function PendingApprovalCard({
  plan,
  onApprove,
  onReject,
  onEditApprove,
}: PendingApprovalCardProps) {
  const styles = useStyles()
  const editIdPrefix = useId()
  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [submittingEdit, setSubmittingEdit] = useState(false)
  const [draft, setDraft] = useState(() => formFromPlan(plan))

  useEffect(() => {
    setDraft(formFromPlan(plan))
    setReviewing(false)
    setEditing(false)
  }, [plan])

  const parsedEdits: PendingApprovalPlanEdits = {
    targetSkillIds: textToList(draft.targetSkillIds),
    targetStudentIds: textToList(draft.targetStudentIds),
    itemTypes: textToList(draft.itemTypes),
    suggestedResources: textToList(draft.suggestedResources),
    rationale: draft.rationale.trim(),
  }
  const canSubmitEdits =
    parsedEdits.targetSkillIds.length > 0 &&
    parsedEdits.targetStudentIds.length > 0 &&
    parsedEdits.itemTypes.length > 0 &&
    parsedEdits.rationale.length > 0
  const practicePlanSummary = [
    { label: 'Duration', value: '1-2 weeks' },
    { label: 'Learners', value: learnerCountLabel(plan.targetStudentIds.length) },
    { label: 'Focus', value: listToText(plan.targetSkillIds) },
    { label: 'Practice mix', value: listToText(plan.itemTypes) },
  ]

  async function handleSubmitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onEditApprove || !canSubmitEdits) return
    setSubmittingEdit(true)
    try {
      await onEditApprove(plan.planId, parsedEdits, draft.reason.trim())
      setEditing(false)
    } finally {
      setSubmittingEdit(false)
    }
  }

  return (
    <Card className={styles.approvalCard} data-testid="phase2-pending-approval-card">
      <CardHeader
        header={<Text weight="semibold">1-2 week practice plan awaiting teacher approval</Text>}
        description={<Text size={200}>Pathfinder proposes; the teacher stays in charge.</Text>}
      />
      <div className={styles.planMeta}>
        <span className={styles.metaBadge}>Pathfinder proposal</span>
        <span className={styles.metaBadge}>{languageLabel(plan.lang)} review</span>
        <span className={styles.metaBadge}>Teacher approval required</span>
      </div>
      <Text>{plan.rationale}</Text>
      <div className={styles.planSummaryGrid} data-testid="practice-plan-proposal">
        {practicePlanSummary.map(item => (
          <div key={item.label} className={styles.planSummaryItem}>
            <span className={styles.planReviewLabel}>{item.label}</span>
            <span className={styles.planSummaryValue}>{item.value}</span>
          </div>
        ))}
        <div className={styles.planSummaryItem}>
          <span className={styles.planReviewLabel}>Resources</span>
          <span className={styles.planSummaryValue}>{listToText(plan.suggestedResources)}</span>
        </div>
      </div>
      <div className={styles.planActions}>
        {!reviewing ? (
          <Button
            appearance="primary"
            className={styles.primaryButton}
            icon={<DocumentTextIcon className={styles.icon} aria-hidden="true" />}
            onClick={() => setReviewing(true)}
          >
            Review plan
          </Button>
        ) : null}
      </div>
      {reviewing ? (
        <div className={styles.planReview} data-testid="phase2-plan-review">
          <Text weight="semibold">Read plan before decision</Text>
          <div className={styles.planReviewGrid}>
            <div className={styles.planReviewRow}>
              <span className={styles.planReviewLabel}>Learners</span>
              <span className={styles.planReviewValue}>{listToText(plan.targetStudentIds)}</span>
            </div>
            <div className={styles.planReviewRow}>
              <span className={styles.planReviewLabel}>Skills</span>
              <span className={styles.planReviewValue}>{listToText(plan.targetSkillIds)}</span>
            </div>
            <div className={styles.planReviewRow}>
              <span className={styles.planReviewLabel}>Activity types</span>
              <span className={styles.planReviewValue}>{listToText(plan.itemTypes)}</span>
            </div>
            <div className={styles.planReviewRow}>
              <span className={styles.planReviewLabel}>Resources</span>
              <span className={styles.planReviewValue}>{listToText(plan.suggestedResources)}</span>
            </div>
            <div className={styles.planReviewRow}>
              <span className={styles.planReviewLabel}>Rationale</span>
              <span className={styles.planReviewValue}>{plan.rationale}</span>
            </div>
          </div>
          <div className={styles.planActions}>
            <Button
              appearance="primary"
              className={styles.primaryButton}
              icon={<CheckCircleIcon className={styles.icon} aria-hidden="true" />}
              onClick={() => onApprove?.(plan.planId)}
            >
              Approve
            </Button>
            <Button
              appearance="secondary"
              className={styles.dangerButton}
              icon={<XCircleIcon className={styles.icon} aria-hidden="true" />}
              onClick={() => onReject?.(plan.planId)}
            >
              Reject
            </Button>
            {onEditApprove ? (
              <Button
                appearance="secondary"
                className={styles.secondaryButton}
                icon={<PencilSquareIcon className={styles.icon} aria-hidden="true" />}
                onClick={() => setEditing(value => !value)}
              >
                {editing ? 'Cancel edit' : 'Edit plan'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {reviewing && editing ? (
        <form className={styles.editForm} onSubmit={handleSubmitEdit}>
          <label className={styles.editLabel} htmlFor={`${editIdPrefix}-target-skills`}>
            <Text size={200} weight="semibold">Target skills</Text>
            <Input
              id={`${editIdPrefix}-target-skills`}
              aria-label="Edited target skills"
              value={draft.targetSkillIds}
              onChange={(_, data) =>
                setDraft(current => ({ ...current, targetSkillIds: data.value }))
              }
            />
          </label>
          <label className={styles.editLabel} htmlFor={`${editIdPrefix}-target-students`}>
            <Text size={200} weight="semibold">Target students</Text>
            <Input
              id={`${editIdPrefix}-target-students`}
              aria-label="Edited target students"
              value={draft.targetStudentIds}
              onChange={(_, data) =>
                setDraft(current => ({ ...current, targetStudentIds: data.value }))
              }
            />
          </label>
          <label className={styles.editLabel} htmlFor={`${editIdPrefix}-item-types`}>
            <Text size={200} weight="semibold">Item types</Text>
            <Input
              id={`${editIdPrefix}-item-types`}
              aria-label="Edited item types"
              value={draft.itemTypes}
              onChange={(_, data) =>
                setDraft(current => ({ ...current, itemTypes: data.value }))
              }
            />
          </label>
          <label className={styles.editLabel} htmlFor={`${editIdPrefix}-resources`}>
            <Text size={200} weight="semibold">Resources</Text>
            <Input
              id={`${editIdPrefix}-resources`}
              aria-label="Edited resources"
              value={draft.suggestedResources}
              onChange={(_, data) =>
                setDraft(current => ({ ...current, suggestedResources: data.value }))
              }
            />
          </label>
          <label className={styles.editLabel} htmlFor={`${editIdPrefix}-rationale`}>
            <Text size={200} weight="semibold">Rationale</Text>
            <Textarea
              id={`${editIdPrefix}-rationale`}
              aria-label="Edited rationale"
              resize="vertical"
              value={draft.rationale}
              onChange={(_, data) =>
                setDraft(current => ({ ...current, rationale: data.value }))
              }
            />
          </label>
          <label className={styles.editLabel} htmlFor={`${editIdPrefix}-reason`}>
            <Text size={200} weight="semibold">Approval reason</Text>
            <Input
              id={`${editIdPrefix}-reason`}
              aria-label="Edit approval reason"
              value={draft.reason}
              onChange={(_, data) =>
                setDraft(current => ({ ...current, reason: data.value }))
              }
            />
          </label>
          <Text size={100} className={styles.editHelp}>
            Use commas to add more than one item.
          </Text>
          <Button
            type="submit"
            appearance="primary"
            className={styles.primaryButton}
            disabled={!canSubmitEdits || submittingEdit}
            icon={<CheckCircleIcon className={styles.icon} aria-hidden="true" />}
          >
            Save edits and approve
          </Button>
        </form>
      ) : null}
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
  onEditApprove,
}: PathfinderPhase2DemoProps) {
  const styles = useStyles()

  return (
    <section className={styles.shell} data-testid="phase2-teacher-workspace">
      <MultimodalIntentBar onSubmitIntent={onSubmitIntent} />
      <TeacherHeatmap cells={cells} />
      <PendingApprovalCard
        plan={pendingPlan}
        onApprove={onApprove}
        onReject={onReject}
        onEditApprove={onEditApprove}
      />
    </section>
  )
}
