/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Card,
  Dropdown,
  Option,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { AVATAR_OPTIONS, type ChildProfile } from '../types'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  hero: {
    display: 'grid',
    gap: 'var(--space-sm)',
    padding: 'clamp(1.1rem, 2.4vw, 1.5rem)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background:
      'radial-gradient(circle at top right, rgba(32, 163, 158, 0.18), transparent 34%), linear-gradient(135deg, rgba(235, 247, 246, 0.98), rgba(224, 241, 239, 0.98))',
  },
  heroCopy: {
    display: 'grid',
    gap: '6px',
    maxWidth: '52ch',
  },
  eyebrow: {
    color: 'var(--color-primary-light)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
    fontWeight: '800',
    letterSpacing: '-0.05em',
    lineHeight: 1.02,
  },
  copy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.88rem',
    lineHeight: 1.5,
    maxWidth: '50ch',
  },
  summaryBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
  },
  summaryPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '32px',
    paddingInline: '12px',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
  },
  summaryValue: {
    color: 'var(--color-text-primary)',
    fontWeight: '700',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  card: {
    display: 'grid',
    gap: 'var(--space-md)',
    padding: 'var(--space-lg)',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.05rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  controlsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  controlBlock: {
    display: 'grid',
    gap: '6px',
    padding: 'var(--space-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'rgba(248, 252, 251, 0.92)',
  },
  label: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  dropdown: {
    minWidth: '100%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  modeToggleRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  modeButton: {
    minHeight: '38px',
    paddingInline: '14px',
    borderRadius: '999px',
    border: '1px solid rgba(13, 138, 132, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    color: 'var(--color-text-secondary)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  modeButtonActive: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: '1px solid var(--color-primary)',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.45,
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: 'var(--space-md)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(32, 163, 158, 0.08)',
    '@media (max-width: 720px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
    },
  },
  metricValue: {
    color: 'var(--color-primary-light)',
    fontFamily: 'var(--font-display)',
    fontWeight: '800',
    letterSpacing: '-0.02em',
  },
  supportCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.55,
  },
})

interface SettingsViewProps {
  isTherapist: boolean
  currentMode: 'therapist' | 'child' | null
  authRole?: string | null
  selectedChild: ChildProfile | null
  childProfiles: ChildProfile[]
  selectedAvatar: string
  onChooseMode: (mode: 'therapist' | 'child') => void
  onSelectChild: (childId: string) => void
  onSelectAvatar: (avatarValue: string) => void
}

export function SettingsView({
  isTherapist,
  currentMode,
  authRole,
  selectedChild,
  childProfiles,
  selectedAvatar,
  onChooseMode,
  onSelectChild,
  onSelectAvatar,
}: SettingsViewProps) {
  const styles = useStyles()
  const roleLabel = authRole || 'Unknown role'
  const modeLabel = currentMode || 'No mode selected'
  const childLabel = selectedChild?.name || 'No child selected'
  const avatarLabel = AVATAR_OPTIONS.find(option => option.value === selectedAvatar)?.label || 'Practice buddy'
  const toolAccessLabel = currentMode === 'child'
    ? 'Child-safe practice view active'
    : isTherapist
      ? 'Therapist review and planning tools available'
      : 'Practice workspace ready'

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <div className={styles.heroCopy}>
          <Text className={styles.eyebrow}>Workspace</Text>
          <Text className={styles.title}>Adjust your current practice setup.</Text>
          <Text className={styles.copy}>
            Use this page for quick environment changes: switch mode, pick the active child, and choose the current practice buddy.
          </Text>
        </div>
        <div className={styles.summaryBar}>
          <div className={styles.summaryPill}>
            Role: <span className={styles.summaryValue}>{roleLabel}</span>
          </div>
          <div className={styles.summaryPill}>
            Mode: <span className={styles.summaryValue}>{modeLabel}</span>
          </div>
          <div className={styles.summaryPill}>
            Child: <span className={styles.summaryValue}>{childLabel}</span>
          </div>
          <div className={styles.summaryPill}>
            Buddy: <span className={styles.summaryValue}>{avatarLabel}</span>
          </div>
        </div>
      </Card>

      <div className={styles.grid}>
        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Workspace controls</Text>
          <div className={styles.controlsGrid}>
            <div className={styles.controlBlock}>
              <Text className={styles.label}>Mode</Text>
              <div className={styles.modeToggleRow}>
                <Button
                  appearance="secondary"
                  className={mergeClasses(styles.modeButton, currentMode === 'child' && styles.modeButtonActive)}
                  onClick={() => onChooseMode('child')}
                >
                  Child mode
                </Button>
                <Button
                  appearance="secondary"
                  className={mergeClasses(styles.modeButton, currentMode === 'therapist' && styles.modeButtonActive)}
                  onClick={() => onChooseMode('therapist')}
                  disabled={!isTherapist}
                >
                  Therapist mode
                </Button>
              </div>
              <Text className={styles.helperText}>
                Child mode keeps the practice surface simple. Therapist mode re-enables review and planning tools.
              </Text>
            </div>

            <div className={styles.controlBlock}>
              <Text className={styles.label}>Active child</Text>
              <Dropdown
                className={styles.dropdown}
                disabled={!isTherapist || childProfiles.length === 0}
                placeholder={childProfiles.length > 0 ? 'Select child' : 'No child profiles'}
                selectedOptions={selectedChild ? [selectedChild.id] : []}
                value={selectedChild?.name}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSelectChild(data.optionValue)
                  }
                }}
              >
                {childProfiles.map(child => (
                  <Option key={child.id} value={child.id} text={child.name}>
                    {child.name}
                  </Option>
                ))}
              </Dropdown>
              <Text className={styles.helperText}>
                This child becomes the active context for home and dashboard tools.
              </Text>
            </div>

            <div className={styles.controlBlock}>
              <Text className={styles.label}>Practice buddy</Text>
              <Dropdown
                className={styles.dropdown}
                selectedOptions={[selectedAvatar]}
                value={avatarLabel}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSelectAvatar(data.optionValue)
                  }
                }}
              >
                {AVATAR_OPTIONS.map(option => (
                  <Option key={option.value} value={option.value} text={option.label}>
                    {option.label}
                  </Option>
                ))}
              </Dropdown>
              <Text className={styles.helperText}>
                Sets the current buddy used when launching a session.
              </Text>
            </div>
          </div>
          <div className={styles.metricRow}>
            <Text className={styles.label}>Workspace status</Text>
            <Text className={styles.metricValue}>{toolAccessLabel}</Text>
          </div>
          <Text className={styles.supportCopy}>
            These controls apply immediately to the active workspace, so you can adjust context here without bouncing back through onboarding or home.
          </Text>
        </Card>
      </div>
    </div>
  )
}