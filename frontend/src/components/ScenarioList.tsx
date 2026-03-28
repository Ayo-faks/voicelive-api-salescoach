/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  Dropdown,
  Label,
  Option,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { Edit24Regular, PersonVoiceRegular } from '@fluentui/react-icons'
import { useState } from 'react'
import type { CustomScenario, CustomScenarioData, Scenario } from '../types'
import { AVATAR_OPTIONS, DEFAULT_AVATAR } from '../types'
import { CustomScenarioEditor } from './CustomScenarioEditor'

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-lg)',
    width: '100%',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.1rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-sm)',
    width: '100%',
    '@media (max-width: 980px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    cursor: 'pointer',
    minHeight: '140px',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-soft, var(--shadow-md))',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    '&:hover': {
      border: '1px solid var(--color-border-strong)',
      boxShadow: 'var(--shadow-md)',
    },
    '@media (max-width: 640px)': {
      minHeight: '120px',
    },
  },
  selected: {
    border: '1px solid var(--color-primary)',
    boxShadow: 'var(--shadow-glow)',
  },
  customCard: {
    backgroundColor: 'var(--color-bg-secondary)',
  },
  actions: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 'var(--space-sm)',
    gap: 'var(--space-md)',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  graphIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-primary-soft)',
    fontSize: '18px',
    flexShrink: 0,
  },
  cardActions: {
    display: 'flex',
    gap: 'var(--space-xs)',
  },
  editButton: {
    minWidth: 'auto',
    padding: 'var(--space-xs)',
  },
  emptyCustom: {
    textAlign: 'center',
    padding: 'var(--space-lg)',
    color: 'var(--color-text-secondary)',
    backgroundColor: 'var(--color-bg-muted)',
    borderRadius: 'var(--radius-md)',
    border: '1px dashed var(--color-border-strong)',
    fontSize: '0.8125rem',
  },
  cardHeader: {
    display: 'flex',
    gap: 'var(--space-sm)',
    alignItems: 'flex-start',
  },
  cardCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
  },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  cardDescription: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    lineHeight: 1.5,
  },
  metadataRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: 'var(--space-md)',
  },
  metaBadge: {
    minHeight: '24px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.75rem',
  },
  startButton: {
    minHeight: '44px',
    paddingInline: 'var(--space-xl)',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
    color: 'var(--color-text-inverse)',
    boxShadow: '0 14px 28px rgba(13, 138, 132, 0.22)',
    border: 'none',
    '@media (max-width: 640px)': {
      width: '100%',
      minHeight: '48px',
    },
  },
  avatarSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexGrow: 1,
  },
  avatarDropdown: {
    minWidth: '200px',
  },
  sectionCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
})

function formatExerciseType(value?: string) {
  if (!value) return 'Practice exercise'

  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface Props {
  scenarios: Scenario[]
  customScenarios: CustomScenario[]
  selectedScenario: string | null
  onSelect: (id: string) => void
  onStart?: (avatarValue: string) => void
  onAddCustomScenario: (
    name: string,
    description: string,
    data: CustomScenarioData
  ) => void
  onUpdateCustomScenario: (
    id: string,
    updates: Partial<
      Pick<CustomScenario, 'name' | 'description' | 'scenarioData'>
    >
  ) => void
  onDeleteCustomScenario: (id: string) => void
  title?: string
  helperText?: string
  showFooter?: boolean
  showCustomExercises?: boolean
  selectedAvatar?: string
  onAvatarChange?: (value: string) => void
}

export function ScenarioList({
  scenarios,
  customScenarios,
  selectedScenario,
  onSelect,
  onStart,
  onAddCustomScenario,
  onUpdateCustomScenario,
  onDeleteCustomScenario,
  title = "Let's practice!",
  helperText = 'Choose a Wulo exercise, then start a calm, guided speech practice session.',
  showFooter = true,
  showCustomExercises = true,
  selectedAvatar,
  onAvatarChange,
}: Props) {
  const styles = useStyles()
  const [internalAvatar, setInternalAvatar] = useState(DEFAULT_AVATAR)
  const activeAvatar = selectedAvatar ?? internalAvatar

  const handleAvatarChange = (value: string) => {
    if (onAvatarChange) {
      onAvatarChange(value)
      return
    }

    setInternalAvatar(value)
  }

  const handleEditCustomScenario = (
    scenario: CustomScenario,
    name: string,
    description: string,
    data: CustomScenarioData
  ) => {
    onUpdateCustomScenario(scenario.id, {
      name,
      description,
      scenarioData: data,
    })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text className={styles.title} size={700} weight="semibold">
          {title}
        </Text>
        <Text className={styles.helperText} size={300}>
          {helperText}
        </Text>
      </div>

      <div className={styles.cardsGrid}>
        {scenarios.map(scenario => {
          const isSelected = selectedScenario === scenario.id

          return (
            <Card
              key={scenario.id}
              className={mergeClasses(styles.card, isSelected && styles.selected)}
              onClick={() => onSelect(scenario.id)}
            >
              <div className={styles.cardHeader}>
                <span className={styles.graphIcon}>
                  <PersonVoiceRegular />
                </span>
                <div className={styles.cardCopy}>
                  <Text className={styles.cardTitle} size={500} weight="semibold">
                    {scenario.name}
                  </Text>
                  <Text className={styles.cardDescription} size={300}>
                    {scenario.description}
                  </Text>
                </div>
              </div>

              <div className={styles.metadataRow}>
                <Badge appearance="filled" className={styles.metaBadge}>
                  {formatExerciseType(scenario.exerciseMetadata?.type)}
                </Badge>
                {scenario.exerciseMetadata?.targetSound && (
                  <Badge appearance="tint" className={styles.metaBadge}>
                    Sound: {scenario.exerciseMetadata.targetSound}
                  </Badge>
                )}
                {scenario.exerciseMetadata?.difficulty && (
                  <Badge appearance="tint" className={styles.metaBadge}>
                    {scenario.exerciseMetadata.difficulty}
                  </Badge>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {showCustomExercises ? (
        <>
          <Divider style={{ marginTop: tokens.spacingVerticalL }} />

          <div className={styles.sectionHeader}>
            <div className={styles.sectionCopy}>
              <Text className={styles.cardTitle} size={500} weight="semibold">
                Therapist exercises
              </Text>
              <Text className={styles.helperText} size={300}>
                Create a custom exercise with target sounds, target words, and a
                guided practice prompt.
              </Text>
            </div>
            <CustomScenarioEditor onSave={onAddCustomScenario} />
          </div>

          {customScenarios.length === 0 ? (
            <Text className={styles.emptyCustom} size={200}>
              No custom exercises yet. Create one for a specific child or target
              sound.
            </Text>
          ) : (
            <div className={styles.cardsGrid}>
              {customScenarios.map(scenario => {
                const isSelected = selectedScenario === scenario.id

                return (
                  <Card
                    key={scenario.id}
                    className={mergeClasses(
                      styles.card,
                      styles.customCard,
                      isSelected && styles.selected
                    )}
                    onClick={() => onSelect(scenario.id)}
                  >
                    <CardHeader
                      header={
                        <Text className={styles.cardTitle} weight="semibold">
                          {scenario.name}
                        </Text>
                      }
                      description={
                        <Text className={styles.cardDescription} size={200}>
                          {scenario.description || scenario.scenarioData.promptText}
                        </Text>
                      }
                      action={
                        <div
                          className={styles.cardActions}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                        >
                          <CustomScenarioEditor
                            scenario={scenario}
                            onSave={(name, description, data) =>
                              handleEditCustomScenario(
                                scenario,
                                name,
                                description,
                                data
                              )
                            }
                            onDelete={onDeleteCustomScenario}
                            trigger={
                              <Button
                                appearance="subtle"
                                icon={<Edit24Regular />}
                                className={styles.editButton}
                                size="small"
                              />
                            }
                          />
                        </div>
                      }
                    />

                    <div className={styles.metadataRow}>
                      <Badge appearance="filled" className={styles.metaBadge}>
                        {formatExerciseType(scenario.scenarioData.exerciseType)}
                      </Badge>
                      {scenario.scenarioData.targetSound && (
                        <Badge appearance="tint" className={styles.metaBadge}>
                          Sound: {scenario.scenarioData.targetSound}
                        </Badge>
                      )}
                      <Badge appearance="tint" className={styles.metaBadge}>
                        {scenario.scenarioData.targetWords.join(', ')}
                      </Badge>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      ) : null}

      {showFooter ? (
        <div className={styles.actions}>
          <div className={styles.avatarSelector}>
            <Label htmlFor="avatar-select">Avatar:</Label>
            <Dropdown
              id="avatar-select"
              className={styles.avatarDropdown}
              value={
                AVATAR_OPTIONS.find(opt => opt.value === activeAvatar)?.label ||
                ''
              }
              selectedOptions={[activeAvatar]}
              onOptionSelect={(_, data) => {
                if (data.optionValue) {
                  handleAvatarChange(data.optionValue)
                }
              }}
            >
              {AVATAR_OPTIONS.map(opt => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Dropdown>
          </div>
          <Button
            appearance="primary"
            className={styles.startButton}
            disabled={!selectedScenario || !onStart}
            onClick={() => onStart?.(activeAvatar)}
          >
            Start child session
          </Button>
        </div>
      ) : null}
    </div>
  )
}
