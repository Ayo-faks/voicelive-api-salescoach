import {
  Badge,
  Button,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  ProgressBar,
  Text,
  Tooltip,
  createTableColumn,
  makeStyles,
  tokens,
  type TableColumnDefinition,
} from '@fluentui/react-components'
import { useMemo, useState } from 'react'
import type { StudentProfileRecord, StudentProfileSkill } from './api'
import { OverrideMasteryDialog } from './OverrideMasteryDialog'
import { useStudentProfile } from './useStudentProfile'

const useStyles = makeStyles({
  body: {
    display: 'grid',
    gap: '18px',
  },
  headerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  section: {
    display: 'grid',
    gap: '10px',
  },
  sectionTitle: {
    fontWeight: 800,
  },
  rowText: {
    display: 'grid',
    gap: '2px',
  },
  actionGroup: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  list: {
    display: 'grid',
    gap: '8px',
  },
  listItem: {
    padding: '10px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: 600,
  },
  toast: {
    padding: '10px 12px',
    borderRadius: '8px',
    color: tokens.colorStatusSuccessForeground1,
    backgroundColor: tokens.colorStatusSuccessBackground1,
    fontWeight: 700,
  },
  statusSecure: {
    backgroundColor: '#ecfdf3',
    color: '#027a48',
  },
  statusDeveloping: {
    backgroundColor: '#fffaeb',
    color: '#b54708',
  },
  statusSupport: {
    backgroundColor: '#fef3f2',
    color: '#b42318',
  },
})

type StudentProfileDrawerProps = {
  open: boolean
  studentId: string | null
  tenantId?: string
  actorId?: string
  fallbackSkills?: StudentProfileSkill[]
  onClose: () => void
}

type EstimateSnapshot = {
  probability: number
  uncertainty: number
}

type RevertOption = {
  latest: EstimateSnapshot
  prior: EstimateSnapshot | null
}

type RevertTarget = {
  skillId: string
  skillLabel: string
  latest: EstimateSnapshot
  prior: EstimateSnapshot
}

function statusLabel(status: StudentProfileSkill['status']) {
  if (status === 'secure') return 'Secure'
  if (status === 'developing') return 'Developing'
  return 'Needs support'
}

function formatRecord(record: StudentProfileRecord) {
  const parts = [record.item_id, record.skill_id, record.response_text]
    .filter(Boolean)
    .map(String)
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(record)
}

function statusClass(styles: ReturnType<typeof useStyles>, status: StudentProfileSkill['status']) {
  if (status === 'secure') return styles.statusSecure
  if (status === 'developing') return styles.statusDeveloping
  return styles.statusSupport
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function estimateFromRecord(record: StudentProfileRecord): EstimateSnapshot | null {
  const probability = finiteNumber(record.estimate?.probability ?? record.probability)
  const uncertainty = finiteNumber(record.estimate?.uncertainty ?? record.uncertainty)
  if (probability === null || uncertainty === null) return null
  return { probability, uncertainty }
}

function isMasteryOverride(record: StudentProfileRecord) {
  return record.kind === 'mastery_override' || record.event_type === 'mastery_override'
}

function findRevertOption(
  skill: StudentProfileSkill,
  recentEvents: StudentProfileRecord[]
): RevertOption | null {
  for (let index = recentEvents.length - 1; index >= 0; index -= 1) {
    const event = recentEvents[index]
    if (event.skill_id !== skill.skill_id) continue
    if (!isMasteryOverride(event)) return null

    let prior: EstimateSnapshot | null = null
    for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
      const priorEvent = recentEvents[priorIndex]
      if (priorEvent.skill_id !== skill.skill_id || isMasteryOverride(priorEvent)) continue
      prior = estimateFromRecord(priorEvent)
      if (prior) break
    }

    return {
      latest: estimateFromRecord(event) ?? {
        probability: skill.probability,
        uncertainty: skill.uncertainty,
      },
      prior,
    }
  }
  return null
}

export function StudentProfileDrawer({
  open,
  studentId,
  tenantId,
  actorId,
  fallbackSkills = [],
  onClose,
}: StudentProfileDrawerProps) {
  const styles = useStyles()
  const { profile, loading, error, overrideMastery } = useStudentProfile(studentId, {
    tenantId,
    actorId,
    enabled: open,
  })
  const [selectedSkill, setSelectedSkill] = useState<StudentProfileSkill | null>(null)
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null)
  const [revertBusy, setRevertBusy] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const skills = profile?.skills.length ? profile.skills : fallbackSkills
  const rawEvents = profile?.recent_mastery_events ?? []
  const revertOptions = useMemo(() => {
    const options = new Map<string, RevertOption>()
    for (const item of skills) {
      const option = findRevertOption(item, rawEvents)
      if (option) options.set(item.skill_id, option)
    }
    return options
  }, [rawEvents, skills])

  const columns = useMemo<TableColumnDefinition<StudentProfileSkill>[]>(
    () => [
      createTableColumn<StudentProfileSkill>({
        columnId: 'skill',
        renderHeaderCell: () => 'Skill',
        renderCell: item => <Text weight="semibold">{item.skill_label}</Text>,
      }),
      createTableColumn<StudentProfileSkill>({
        columnId: 'probability',
        renderHeaderCell: () => 'Probability',
        renderCell: item => (
          <div className={styles.rowText}>
            <Text>{Math.round(item.probability * 100)}%</Text>
            <ProgressBar value={item.probability} thickness="medium" />
          </div>
        ),
      }),
      createTableColumn<StudentProfileSkill>({
        columnId: 'uncertainty',
        renderHeaderCell: () => 'Uncertainty',
        renderCell: item => <Text>{Math.round(item.uncertainty * 100)}%</Text>,
      }),
      createTableColumn<StudentProfileSkill>({
        columnId: 'status',
        renderHeaderCell: () => 'Status',
        renderCell: item => (
          <Badge className={statusClass(styles, item.status)}>{statusLabel(item.status)}</Badge>
        ),
      }),
      createTableColumn<StudentProfileSkill>({
        columnId: 'actions',
        renderHeaderCell: () => 'Actions',
        renderCell: item => {
          const revertOption = revertOptions.get(item.skill_id)
          return (
            <div className={styles.actionGroup}>
              <Button size="small" onClick={() => setSelectedSkill(item)}>
                Override mastery
              </Button>
              {revertOption ? (
                <Tooltip
                  content={revertOption.prior ? 'Restore the latest model estimate' : 'No prior model estimate available'}
                  relationship="description"
                >
                  <Button
                    appearance="secondary"
                    size="small"
                    disabled={!revertOption.prior}
                    title={revertOption.prior ? undefined : 'No prior model estimate available'}
                    onClick={() => {
                      if (!revertOption.prior) return
                      setRevertError(null)
                      setRevertTarget({
                        skillId: item.skill_id,
                        skillLabel: item.skill_label,
                        latest: revertOption.latest,
                        prior: revertOption.prior,
                      })
                    }}
                  >
                    Revert to model estimate
                  </Button>
                </Tooltip>
              ) : null}
            </div>
          )
        },
      }),
    ],
    [revertOptions, styles]
  )

  const responses = profile?.recent_responses.slice().reverse() ?? []
  const events = rawEvents.slice().reverse()

  async function handleConfirmRevert() {
    if (!revertTarget) return
    setRevertBusy(true)
    setRevertError(null)
    try {
      await overrideMastery({
        skill_id: revertTarget.skillId,
        probability: revertTarget.prior.probability,
        uncertainty: revertTarget.prior.uncertainty,
        reason: 'Reverted teacher override',
      })
      setToast('Mastery reverted to model estimate')
      setRevertTarget(null)
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : String(err))
    } finally {
      setRevertBusy(false)
    }
  }

  return (
    <>
      <Drawer open={open} position="end" size="large" onOpenChange={(_, data) => !data.open && onClose()}>
        <DrawerHeader>
          <DrawerHeaderTitle action={<Button appearance="subtle" aria-label="Close profile" onClick={onClose}>Close</Button>}>
            Student profile
          </DrawerHeaderTitle>
          <div className={styles.headerMeta}>
            <Badge appearance="outline">{studentId ?? 'No student selected'}</Badge>
            {profile?.tenant_id ? <Badge appearance="tint">Tenant {profile.tenant_id}</Badge> : null}
            {profile?.audit ? <Badge appearance="outline">Viewed now</Badge> : null}
          </div>
        </DrawerHeader>
        <DrawerBody className={styles.body}>
          {toast ? <div className={styles.toast} aria-live="polite">{toast}</div> : null}
          {loading ? <Text>Loading profile…</Text> : null}
          {error ? <Text className={styles.error}>Profile failed: {error.message}</Text> : null}

          <section className={styles.section} aria-label="Skill mastery">
            <Text className={styles.sectionTitle}>Skill mastery</Text>
            <DataGrid items={skills} columns={columns} getRowId={item => item.skill_id}>
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<StudentProfileSkill>>
                {({ item, rowId }) => (
                  <DataGridRow<StudentProfileSkill> key={rowId}>
                    {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
          </section>

          <section className={styles.section} aria-label="Recent responses">
            <Text className={styles.sectionTitle}>Recent responses</Text>
            <div className={styles.list}>
              {responses.length === 0 ? <Text size={200}>No responses yet.</Text> : null}
              {responses.slice(0, 20).map((record, index) => (
                <div className={styles.listItem} key={`${record.id ?? record.item_id ?? index}-response`}>
                  <Text>{formatRecord(record)}</Text>
                  {typeof record.correct === 'boolean' ? (
                    <Badge appearance="outline">{record.correct ? 'Correct' : 'Incorrect'}</Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-label="Recent mastery events">
            <Text className={styles.sectionTitle}>Recent mastery events</Text>
            <div className={styles.list}>
              {events.length === 0 ? <Text size={200}>No mastery events yet.</Text> : null}
              {events.slice(0, 20).map((record, index) => (
                <div className={styles.listItem} key={`${record.id ?? record.skill_id ?? index}-event`}>
                  <Text>{formatRecord(record)}</Text>
                </div>
              ))}
            </div>
          </section>
        </DrawerBody>
      </Drawer>

      <OverrideMasteryDialog
        open={Boolean(selectedSkill)}
        studentId={studentId ?? ''}
        skill={selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onSubmit={async payload => {
          await overrideMastery(payload)
          setToast('Mastery overridden')
        }}
      />

      <Dialog open={Boolean(revertTarget)} onOpenChange={(_, data) => !data.open && setRevertTarget(null)}>
        <DialogSurface aria-label="Revert mastery dialog">
          <DialogTitle>Revert to model estimate</DialogTitle>
          <DialogBody className={styles.body}>
            <Text>
              {revertTarget
                ? `Revert from ${formatPercent(revertTarget.latest.probability)} back to ${formatPercent(revertTarget.prior.probability)}?`
                : 'Revert this mastery override?'}
            </Text>
            {revertTarget ? <Text size={200}>{revertTarget.skillLabel}</Text> : null}
            {revertError ? <Text className={styles.error}>{revertError}</Text> : null}
          </DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setRevertTarget(null)} disabled={revertBusy}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={() => void handleConfirmRevert()} disabled={revertBusy}>
              {revertBusy ? 'Reverting…' : 'Confirm revert'}
            </Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>
    </>
  )
}
