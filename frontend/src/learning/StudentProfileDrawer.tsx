import {
  Dialog,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { useMemo, useState } from 'react'
import type { StudentProfileRecord, StudentProfileSkill } from './api'
import { OverrideMasteryDialog } from './OverrideMasteryDialog'
import { pathfinderTokens as t } from './theme/pathfinder-tokens'
import { useStudentProfile } from './useStudentProfile'

const useStyles = makeStyles({
  drawerSurface: {
    width: 'min(820px, calc(100vw - 32px))',
    maxWidth: '820px',
    borderLeft: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: '-24px 0 64px rgba(0, 0, 0, 0.22)',
  },
  drawerHeader: {
    display: 'grid',
    gap: '14px',
    paddingTop: '28px',
    paddingRight: '28px',
    paddingBottom: '18px',
    paddingLeft: '28px',
    borderBottom: t.surface.hairline,
    background: `linear-gradient(180deg, ${t.brand.surface}, ${t.surface.cardMuted})`,
  },
  drawerHeaderTitle: {
    fontFamily: t.font.display,
    fontSize: '1.32rem',
    fontWeight: 800,
    letterSpacing: '0',
  },
  body: {
    display: 'grid',
    gap: '22px',
    paddingTop: '22px',
    paddingRight: '28px',
    paddingBottom: '32px',
    paddingLeft: '28px',
  },
  closeButton: {
    appearance: 'none',
    minHeight: '36px',
    paddingRight: '16px',
    paddingLeft: '16px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 800,
    lineHeight: 1,
  },
  headerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  section: {
    display: 'grid',
    gap: '12px',
  },
  sectionTitle: {
    fontWeight: 800,
    color: t.brand.text,
  },
  tableFrame: {
    overflowX: 'auto',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardElevatedShadow,
  },
  masteryTable: {
    width: '100%',
    minWidth: '640px',
    borderCollapse: 'collapse',
  },
  tableHeadCell: {
    paddingTop: '12px',
    paddingRight: '14px',
    paddingBottom: '12px',
    paddingLeft: '14px',
    borderBottom: t.surface.hairline,
    color: t.brand.textSecondary,
    fontSize: '0.74rem',
    fontWeight: 800,
    textAlign: 'left',
  },
  tableCell: {
    paddingTop: '13px',
    paddingRight: '14px',
    paddingBottom: '13px',
    paddingLeft: '14px',
    borderBottom: t.surface.hairline,
    color: t.brand.text,
    verticalAlign: 'middle',
    fontSize: '0.86rem',
  },
  tableCellLast: {
    paddingTop: '13px',
    paddingRight: '14px',
    paddingBottom: '13px',
    paddingLeft: '14px',
    color: t.brand.text,
    verticalAlign: 'middle',
    fontSize: '0.86rem',
  },
  skillName: {
    fontWeight: 800,
  },
  progressTrack: {
    width: '92px',
    height: '4px',
    marginTop: '6px',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.lineSoft,
    overflow: 'hidden',
  },
  progressFill: {
    display: 'block',
    height: '100%',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.ink,
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '12px 14px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  error: {
    color: t.status.criticalFg,
    fontWeight: 600,
  },
  toast: {
    padding: '10px 12px',
    borderRadius: t.radius.md,
    color: t.status.okFg,
    backgroundColor: t.status.okBg,
    fontWeight: 700,
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
  answerPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.card,
    color: t.brand.textSecondary,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 800,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  softPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  actionButton: {
    appearance: 'none',
    minHeight: '32px',
    paddingRight: '13px',
    paddingLeft: '13px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.76rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  secondaryActionButton: {
    appearance: 'none',
    minHeight: '32px',
    paddingRight: '13px',
    paddingLeft: '13px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.76rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  dialogSurface: {
    maxWidth: '480px',
    borderRadius: t.radius.lg,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardHoverShadow,
  },
  dialogBody: {
    display: 'grid',
    gap: '16px',
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
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

function displaySkill(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatRecord(record: StudentProfileRecord) {
  const skill = record.skill_id ? displaySkill(record.skill_id) : null
  const response = record.response_text ? `Response: ${record.response_text}` : null
  const item = record.item_id ? `Practice item ${String(record.item_id).replace(/[-_]/g, ' ')}` : null
  const parts = [skill, response, item]
    .filter(Boolean)
    .map(String)
  return parts.length > 0 ? parts.join(' · ') : 'Learning activity recorded'
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

  const responses = profile?.recent_responses.slice().reverse() ?? []
  const events = rawEvents.slice().reverse()

  function openRestoreDialog(item: StudentProfileSkill, option: RevertOption) {
    if (!option.prior) return
    setRevertError(null)
    setRevertTarget({
      skillId: item.skill_id,
      skillLabel: item.skill_label,
      latest: option.latest,
      prior: option.prior,
    })
  }

  async function handleConfirmRevert() {
    if (!revertTarget) return
    setRevertBusy(true)
    setRevertError(null)
    try {
      await overrideMastery({
        skill_id: revertTarget.skillId,
        probability: revertTarget.prior.probability,
        uncertainty: revertTarget.prior.uncertainty,
        reason: 'Restored previous teacher-reviewed estimate',
      })
      setToast('Mastery restored to the previous estimate')
      setRevertTarget(null)
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : String(err))
    } finally {
      setRevertBusy(false)
    }
  }

  return (
    <>
      <Drawer className={styles.drawerSurface} open={open} position="end" size="large" onOpenChange={(_, data) => !data.open && onClose()}>
        <DrawerHeader className={styles.drawerHeader}>
          <DrawerHeaderTitle
            className={styles.drawerHeaderTitle}
            action={<button type="button" className={styles.closeButton} aria-label="Close profile" onClick={onClose}>Close</button>}
          >
            Student profile
          </DrawerHeaderTitle>
          <div className={styles.headerMeta}>
            <span className={styles.softPill}>{studentId ? 'Learner selected' : 'No student selected'}</span>
            {profile?.tenant_id ? <span className={styles.softPill}>School profile</span> : null}
            {profile?.audit ? <span className={styles.softPill}>Viewed now</span> : null}
          </div>
        </DrawerHeader>
        <DrawerBody className={styles.body}>
          {toast ? <div className={styles.toast} aria-live="polite">{toast}</div> : null}
          {loading ? <Text>Loading profile…</Text> : null}
          {error ? <Text className={styles.error}>Profile could not load right now.</Text> : null}

          <section className={styles.section} aria-label="Skill mastery">
            <Text className={styles.sectionTitle}>Skill mastery</Text>
            <div className={styles.tableFrame}>
              <table className={styles.masteryTable} aria-label="Skill mastery">
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell} scope="col">Skill</th>
                    <th className={styles.tableHeadCell} scope="col">Probability</th>
                    <th className={styles.tableHeadCell} scope="col">Uncertainty</th>
                    <th className={styles.tableHeadCell} scope="col">Status</th>
                    <th className={styles.tableHeadCell} scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((item, index) => {
                    const revertOption = revertOptions.get(item.skill_id)
                    const cellClass = index === skills.length - 1 ? styles.tableCellLast : styles.tableCell
                    return (
                      <tr key={item.skill_id}>
                        <td className={cellClass}><span className={styles.skillName}>{item.skill_label}</span></td>
                        <td className={cellClass}>
                          <div className={styles.rowText}>
                            <span>{formatPercent(item.probability)}</span>
                            <span className={styles.progressTrack} aria-hidden="true">
                              <span className={styles.progressFill} style={{ width: formatPercent(item.probability) }} />
                            </span>
                          </div>
                        </td>
                        <td className={cellClass}>{formatPercent(item.uncertainty)}</td>
                        <td className={cellClass}>
                          <span className={`${styles.statusPill} ${statusClass(styles, item.status)}`}>{statusLabel(item.status)}</span>
                        </td>
                        <td className={cellClass}>
                          <div className={styles.actionGroup}>
                            <button type="button" className={styles.actionButton} onClick={() => setSelectedSkill(item)}>
                              Adjust mastery
                            </button>
                            {revertOption ? (
                              <button
                                type="button"
                                className={styles.secondaryActionButton}
                                disabled={!revertOption.prior}
                                title={revertOption.prior ? undefined : 'No previous estimate available'}
                                onClick={() => openRestoreDialog(item, revertOption)}
                              >
                                Restore estimate
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section} aria-label="Recent responses">
            <Text className={styles.sectionTitle}>Recent responses</Text>
            <div className={styles.list}>
              {responses.length === 0 ? <Text size={200}>No responses yet.</Text> : null}
              {responses.slice(0, 20).map((record, index) => (
                <div className={styles.listItem} key={`${record.id ?? record.item_id ?? index}-response`}>
                  <Text>{formatRecord(record)}</Text>
                  {typeof record.correct === 'boolean' ? (
                    <span className={styles.answerPill}>{record.correct ? 'Correct' : 'Incorrect'}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-label="Recent mastery events">
            <Text className={styles.sectionTitle}>Recent mastery events</Text>
            <div className={styles.list}>
              {events.length === 0 ? <Text size={200}>No recent mastery changes yet.</Text> : null}
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
          setToast('Mastery adjustment saved')
        }}
      />

      <Dialog open={Boolean(revertTarget)} onOpenChange={(_, data) => !data.open && setRevertTarget(null)}>
        <DialogSurface aria-label="Restore mastery dialog" className={styles.dialogSurface}>
          <DialogBody className={styles.dialogBody}>
            <DialogTitle>Restore previous estimate</DialogTitle>
            <Text>
              {revertTarget
                ? `Restore mastery from ${formatPercent(revertTarget.latest.probability)} to ${formatPercent(revertTarget.prior.probability)}?`
                : 'Restore this mastery estimate?'}
            </Text>
            {revertTarget ? <Text size={200}>{revertTarget.skillLabel}</Text> : null}
            {revertError ? <Text className={styles.error}>{revertError}</Text> : null}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondaryActionButton} onClick={() => setRevertTarget(null)} disabled={revertBusy}>
              Cancel
              </button>
              <button type="button" className={styles.actionButton} onClick={() => void handleConfirmRevert()} disabled={revertBusy}>
                {revertBusy ? 'Restoring…' : 'Confirm restore'}
              </button>
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  )
}
