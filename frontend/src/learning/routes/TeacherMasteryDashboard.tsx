import {
  Badge,
  Card,
  CardHeader,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useCallback, useEffect, useState } from 'react'
import {
  MultimodalIntentBar,
  PendingApprovalCard,
  ProvenanceFooter,
  type HeatmapCellView,
  type PendingApprovalPlanView,
} from '../components/PathfinderPhase2'
import { heatmapCells, pendingPlan as fixturePendingPlan, provenance } from '../fixtures'
import {
  approveLearningPlan,
  getClassMastery,
  listAudit,
  listPendingApprovals,
  rejectLearningPlan,
  submitIntent,
  type ClassMasteryCell,
  type PendingPlanRecord,
} from '../api'

const skillIds = [
  'ratio-proportion',
  'fraction-operations',
  'linear-equations',
  'plane-geometry',
] as const

const skillLabels: Record<(typeof skillIds)[number], string> = {
  'ratio-proportion': 'Ratio',
  'fraction-operations': 'Fractions',
  'linear-equations': 'Linear eq.',
  'plane-geometry': 'Geometry',
}

type Row = {
  studentId: string
  name: string
  cells: Record<string, { p: number; u: number; status: HeatmapCellView['status'] }>
}

const classRows: Row[] = [
  {
    studentId: 'student-001',
    name: 'Tobi A.',
    cells: {
      'ratio-proportion': { p: 0.42, u: 0.18, status: 'needs_support' },
      'fraction-operations': { p: 0.61, u: 0.13, status: 'developing' },
      'linear-equations': { p: 0.74, u: 0.1, status: 'developing' },
      'plane-geometry': { p: 0.86, u: 0.08, status: 'secure' },
    },
  },
  {
    studentId: 'student-002',
    name: 'Amaka O.',
    cells: {
      'ratio-proportion': { p: 0.58, u: 0.14, status: 'developing' },
      'fraction-operations': { p: 0.72, u: 0.1, status: 'developing' },
      'linear-equations': { p: 0.81, u: 0.09, status: 'secure' },
      'plane-geometry': { p: 0.9, u: 0.05, status: 'secure' },
    },
  },
  {
    studentId: 'student-003',
    name: 'Ibrahim S.',
    cells: {
      'ratio-proportion': { p: 0.31, u: 0.22, status: 'needs_support' },
      'fraction-operations': { p: 0.48, u: 0.19, status: 'needs_support' },
      'linear-equations': { p: 0.55, u: 0.16, status: 'developing' },
      'plane-geometry': { p: 0.7, u: 0.12, status: 'developing' },
    },
  },
  {
    studentId: 'student-004',
    name: 'Chinwe E.',
    cells: {
      'ratio-proportion': { p: 0.66, u: 0.12, status: 'developing' },
      'fraction-operations': { p: 0.79, u: 0.09, status: 'developing' },
      'linear-equations': { p: 0.88, u: 0.07, status: 'secure' },
      'plane-geometry': { p: 0.92, u: 0.05, status: 'secure' },
    },
  },
  {
    studentId: 'student-005',
    name: 'Femi K.',
    cells: {
      'ratio-proportion': { p: 0.38, u: 0.2, status: 'needs_support' },
      'fraction-operations': { p: 0.54, u: 0.15, status: 'developing' },
      'linear-equations': { p: 0.62, u: 0.13, status: 'developing' },
      'plane-geometry': { p: 0.78, u: 0.09, status: 'developing' },
    },
  },
  {
    studentId: 'student-006',
    name: 'Ngozi P.',
    cells: {
      'ratio-proportion': { p: 0.71, u: 0.1, status: 'developing' },
      'fraction-operations': { p: 0.83, u: 0.07, status: 'secure' },
      'linear-equations': { p: 0.86, u: 0.06, status: 'secure' },
      'plane-geometry': { p: 0.94, u: 0.04, status: 'secure' },
    },
  },
  {
    studentId: 'student-007',
    name: 'Olu B.',
    cells: {
      'ratio-proportion': { p: 0.49, u: 0.17, status: 'needs_support' },
      'fraction-operations': { p: 0.6, u: 0.14, status: 'developing' },
      'linear-equations': { p: 0.7, u: 0.11, status: 'developing' },
      'plane-geometry': { p: 0.82, u: 0.08, status: 'secure' },
    },
  },
  {
    studentId: 'student-008',
    name: 'Zainab H.',
    cells: {
      'ratio-proportion': { p: 0.55, u: 0.15, status: 'developing' },
      'fraction-operations': { p: 0.68, u: 0.12, status: 'developing' },
      'linear-equations': { p: 0.77, u: 0.1, status: 'developing' },
      'plane-geometry': { p: 0.88, u: 0.06, status: 'secure' },
    },
  },
]

function colourForMastery(p: number): string {
  if (p < 0.5) return '#fafafa'
  if (p < 0.7) return '#ededed'
  if (p < 0.85) return '#e5e5e5'
  return '#d4d4d4'
}

function textColourForMastery(p: number): string {
  if (p < 0.5) return '#0a0a0a'
  if (p < 0.7) return '#0a0a0a'
  if (p < 0.85) return '#0a0a0a'
  return '#0a0a0a'
}

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '18px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '16px',
    flexWrap: 'wrap',
  },
  title: {
    fontFamily: 'Manrope, sans-serif',
    fontSize: '1.5rem',
    fontWeight: 800,
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    maxWidth: '640px',
  },
  filterBar: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: '18px',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  heatmapCard: {
    padding: '16px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '12px',
  },
  heatmapScroll: {
    overflowX: 'auto',
  },
  heatmapGrid: {
    width: '100%',
    minWidth: '640px',
    borderCollapse: 'separate',
    borderSpacing: '4px',
  },
  th: {
    padding: '8px 10px',
    fontSize: '0.78rem',
    fontWeight: 700,
    textAlign: 'left',
    color: tokens.colorNeutralForeground2,
  },
  nameCell: {
    padding: '10px 12px',
    fontWeight: 700,
    fontSize: '0.85rem',
    backgroundColor: '#fff',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '10px 8px',
    textAlign: 'center',
    borderRadius: '8px',
    fontWeight: 700,
    fontSize: '0.85rem',
    minWidth: '64px',
    border: '1px solid transparent',
  },
  cellUncertainty: {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 500,
    opacity: 0.75,
    marginTop: '2px',
  },
  legend: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    fontSize: '0.78rem',
    color: tokens.colorNeutralForeground2,
  },
  legendDot: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    marginRight: '6px',
    verticalAlign: 'middle',
  },
  sidePanel: {
    display: 'grid',
    gap: '14px',
    alignContent: 'start',
  },
  intentCard: {
    padding: '14px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'grid',
    gap: '8px',
  },
  classSummary: {
    padding: '14px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '10px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  summaryTile: {
    padding: '10px',
    borderRadius: '10px',
    backgroundColor: '#f8fafc',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  summaryLabel: {
    fontSize: '0.68rem',
    fontWeight: 700,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  summaryValue: {
    fontSize: '1.3rem',
    fontWeight: 800,
  },
})

const filters = ['All JSS2', 'Needs support', 'Developing', 'Secure', 'Group A']

function planRecordToView(record: PendingPlanRecord): PendingApprovalPlanView {
  return {
    planId: record.id,
    targetSkillIds: record.plan.target_skill_ids,
    targetStudentIds: record.plan.target_student_ids,
    itemTypes: record.plan.item_types,
    suggestedResources: record.plan.suggested_resources,
    rationale: record.plan.rationale,
    requiresApproval: record.plan.requires_approval,
    lang: record.plan.lang,
    provenance: record.plan.provenance.map(item => ({
      source: item.source,
      ruleId: item.rule_id ?? undefined,
      confidence: item.confidence,
      evidenceCount: item.evidence_count,
    })),
  }
}

function mergeLiveCellsWithFixture(
  live: ClassMasteryCell[]
): typeof classRowsBase {
  if (live.length === 0) return classRowsBase
  const merged = classRowsBase.map(row => ({
    ...row,
    cells: { ...row.cells },
  }))
  let liveRow = merged.find(row => row.studentId === 'student-001')
  if (!liveRow) {
    liveRow = {
      studentId: 'student-001',
      name: 'Tobi A. (live)',
      cells: {},
    } as Row
    merged.unshift(liveRow)
  }
  for (const cell of live) {
    liveRow.cells[cell.skill_id] = {
      p: cell.probability,
      u: cell.uncertainty,
      status: cell.status,
    }
  }
  return merged
}

const classRowsBase = classRows

export default function TeacherMasteryDashboard() {
  const styles = useStyles()
  const [activeFilter, setActiveFilter] = useState('All JSS2')
  const [auditEvents, setAuditEvents] = useState<string[]>([
    'Loaded JSS2 maths diagnostic fixture',
    'Teacher approval gate active',
  ])
  const [liveCells, setLiveCells] = useState<ClassMasteryCell[]>([])
  const [pendingPlans, setPendingPlans] = useState<PendingPlanRecord[]>([])
  const [intentBusy, setIntentBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [mastery, approvals, audit] = await Promise.all([
        getClassMastery(),
        listPendingApprovals(),
        listAudit(),
      ])
      setLiveCells(mastery.cells)
      setPendingPlans(approvals.plans)
      if (audit.events.length > 0) {
        setAuditEvents(cur => {
          const baseline = cur.filter(
            value => !value.startsWith('[live]')
          )
          return [
            ...baseline,
            ...audit.events.map(event => `[live] ${event.label}`),
          ]
        })
      }
    } catch {
      // Backend unavailable in pure-frontend dev — fall back silently.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const handle = window.setInterval(() => {
      void refresh()
    }, 5000)
    return () => window.clearInterval(handle)
  }, [refresh])

  const visibleRows = mergeLiveCellsWithFixture(liveCells)
  const visiblePlan: PendingApprovalPlanView =
    pendingPlans.length > 0 ? planRecordToView(pendingPlans[0]) : fixturePendingPlan

  function pushEvent(e: string) {
    setAuditEvents(cur => [...cur, e])
  }

  async function handleSubmitIntent(value: string) {
    pushEvent(`Teacher request: ${value}`)
    setIntentBusy(true)
    try {
      const result = await submitIntent({ prompt: value, role: 'teacher' })
      pushEvent(
        `Intent plan ${result.plan.plan_id} ready (${result.plan.target_skill_ids.join(', ')})`
      )
      await refresh()
    } catch (err) {
      pushEvent(`Intent failed: ${(err as Error).message}`)
    } finally {
      setIntentBusy(false)
    }
  }

  async function handleApprove(planId: string) {
    pushEvent(`Approving plan ${planId}…`)
    try {
      await approveLearningPlan(planId, { reason: 'Teacher dashboard approval' })
      pushEvent(`Approved plan ${planId}`)
      await refresh()
    } catch (err) {
      pushEvent(`Approve failed: ${(err as Error).message}`)
    }
  }

  async function handleReject(planId: string) {
    pushEvent(`Rejecting plan ${planId}…`)
    try {
      await rejectLearningPlan(planId, { reason: 'Teacher dashboard rejection' })
      pushEvent(`Rejected plan ${planId}`)
      await refresh()
    } catch (err) {
      pushEvent(`Reject failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className={styles.shell} data-testid="route-teacher-dashboard">
      <div className={styles.headerRow}>
        <div>
          <Text as="h1" className={styles.title}>
            Teacher Mastery Dashboard
          </Text>
          <Text className={styles.subtitle}>
            JSS2 mathematics · 8 learners · mastery probability and uncertainty
            per skill. All interventions wait for your approval.
          </Text>
        </div>
        <Badge appearance="tint">Approval gate active</Badge>
      </div>

      <div className={styles.filterBar} role="tablist" aria-label="Class filter">
        {filters.map(f => (
          <Badge
            key={f}
            appearance={activeFilter === f ? 'filled' : 'outline'}
            onClick={() => setActiveFilter(f)}
            style={{ cursor: 'pointer' }}
          >
            {f}
          </Badge>
        ))}
      </div>

      <div className={styles.twoCol}>
        <Card className={styles.heatmapCard}>
          <CardHeader
            header={<Text weight="semibold">Knowledge Mastery Heatmap</Text>}
            description={
              <Text size={200}>
                Each cell shows mastery % (large) and uncertainty % (small).
              </Text>
            }
          />
          <div className={styles.heatmapScroll}>
            <table
              className={styles.heatmapGrid}
              aria-label="Class mastery heatmap"
            >
              <thead>
                <tr>
                  <th className={styles.th} scope="col">
                    Student
                  </th>
                  {skillIds.map(s => (
                    <th key={s} className={styles.th} scope="col">
                      {skillLabels[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr key={row.studentId}>
                    <td className={styles.nameCell}>{row.name}</td>
                    {skillIds.map(s => {
                      const c = row.cells[s]
                      if (!c) {
                        return (
                          <td key={s} className={styles.cell} style={{ backgroundColor: '#fafafa' }}>
                            —
                          </td>
                        )
                      }
                      return (
                        <td
                          key={s}
                          data-testid={`mastery-cell-${row.studentId}-${s}`}
                          className={styles.cell}
                          style={{
                            backgroundColor: colourForMastery(c.p),
                            color: textColourForMastery(c.p),
                          }}
                          title={`${row.name} · ${skillLabels[s]} · mastery ${Math.round(
                            c.p * 100
                          )}% · uncertainty ${Math.round(c.u * 100)}%`}
                        >
                          {Math.round(c.p * 100)}%
                          <span className={styles.cellUncertainty}>
                            ±{Math.round(c.u * 100)}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.legend}>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: '#fafafa' }}
              />
              Needs support &lt; 50%
            </span>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: '#ededed' }}
              />
              Developing 50–70%
            </span>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: '#e5e5e5' }}
              />
              Approaching 70–85%
            </span>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: '#d4d4d4' }}
              />
              Secure &gt; 85%
            </span>
          </div>
          <ProvenanceFooter provenance={provenance} />
        </Card>

        <div className={styles.sidePanel}>
          <div className={styles.classSummary}>
            <Text weight="semibold">Class summary</Text>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Tracked</div>
                <div className={styles.summaryValue}>4</div>
                <Text size={200}>skills</Text>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Support</div>
                <div className={styles.summaryValue}>3</div>
                <Text size={200}>learners</Text>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Median</div>
                <div className={styles.summaryValue}>68%</div>
                <Text size={200}>mastery</Text>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Pending</div>
                <div className={styles.summaryValue}>1</div>
                <Text size={200}>approval</Text>
              </div>
            </div>
          </div>

          <div className={styles.intentCard}>
            <Text weight="semibold">Plan an intervention</Text>
            <MultimodalIntentBar
              disabled={intentBusy}
              onSubmitIntent={value => void handleSubmitIntent(value)}
            />
          </div>

          <PendingApprovalCard
            plan={visiblePlan}
            onApprove={id => void handleApprove(id)}
            onReject={id => void handleReject(id)}
          />

          <Card>
            <CardHeader
              header={<Text weight="semibold">Audit events</Text>}
              description={<Text size={200}>Recent local UI actions</Text>}
            />
            <div
              style={{ display: 'grid', gap: '6px', marginTop: '8px' }}
              data-testid="audit-events"
            >
              {auditEvents
                .slice(-10)
                .reverse()
                .map((e, idx) => (
                  <Badge key={`${idx}-${e}`} appearance="outline">
                    {e}
                  </Badge>
                ))}
            </div>
          </Card>
        </div>
      </div>

      {/* keep upstream heatmap component referenced for tests that import via demo */}
      <span data-testid="legacy-cells-count" style={{ display: 'none' }}>
        {heatmapCells.length}
      </span>
    </div>
  )
}
