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
import { useEffect, useState } from 'react'
import type { CustomScenario, CustomScenarioData, Scenario } from '../types'
import { AVATAR_OPTIONS, DEFAULT_AVATAR } from '../types'
import {
  ACTIVITY_FILTERS,
  SOUND_FILTERS,
  filterScenarios,
  getStepLabel,
  groupByStep,
  type ActivityFilterId,
  type SoundFamilyId,
} from '../utils/exerciseFilters'
import { CustomScenarioEditor } from './CustomScenarioEditor'

const CHILD_ACTIVITY_FILTER_KEY = 'wulo.child.activityFilter'
const CHILD_SOUND_FILTER_KEY = 'wulo.child.soundFilter'
const MAX_CHILD_CARDS_PER_GROUP = 4

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
  filterPanel: {
    display: 'grid',
    gap: 'var(--space-sm)',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    '@media (max-width: 760px)': {
      padding: 'var(--space-sm)',
    },
  },
  filterGroup: {
    display: 'grid',
    gap: '6px',
  },
  filterLabel: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '600',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  desktopFilterRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    '@media (max-width: 760px)': {
      display: 'none',
    },
  },
  mobileFilterRow: {
    display: 'none',
    gap: 'var(--space-sm)',
    gridTemplateColumns: '1fr',
    '@media (max-width: 760px)': {
      display: 'grid',
    },
  },
  filterDropdown: {
    width: '100%',
  },
  filterButton: {
    minHeight: '34px',
    paddingInline: 'var(--space-md)',
    borderRadius: '999px',
    fontSize: '0.8125rem',
    fontWeight: '600',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  activeFilterButton: {
    border: '1px solid var(--color-primary)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
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
  compactCard: {
    minHeight: '104px',
    padding: 'var(--space-sm) var(--space-md)',
    boxShadow: 'none',
    '@media (max-width: 640px)': {
      minHeight: '96px',
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
  compactIcon: {
    width: '30px',
    height: '30px',
    fontSize: '16px',
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
  compactMetadataRow: {
    marginTop: 'var(--space-sm)',
  },
  metaBadge: {
    minHeight: '24px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.75rem',
  },
  stepGroups: {
    display: 'grid',
    gap: 'var(--space-md)',
  },
  stepGroup: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  stepHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    '@media (max-width: 760px)': {
      alignItems: 'stretch',
    },
  },
  stepHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  stepTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--color-text-primary)',
  },
  groupCount: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
  },
  groupCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-sm)',
    '@media (max-width: 820px)': {
      gridTemplateColumns: '1fr',
    },
  },
  showMoreButton: {
    minHeight: '32px',
    paddingInline: 'var(--space-md)',
    borderRadius: '999px',
    fontSize: '0.8125rem',
    fontWeight: '600',
    '@media (max-width: 760px)': {
      width: '100%',
      justifyContent: 'center',
    },
  },
  emptyState: {
    padding: 'var(--space-lg)',
    textAlign: 'center',
    color: 'var(--color-text-secondary)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-secondary)',
    border: '1px dashed var(--color-border-strong)',
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
  compactChildMode?: boolean
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
  compactChildMode = false,
}: Props) {
  const styles = useStyles()
  const [internalAvatar, setInternalAvatar] = useState(DEFAULT_AVATAR)
  const [activityFilter, setActivityFilter] = useState<ActivityFilterId>(() => {
    if (typeof window === 'undefined') {
      return 'recommended'
    }

    const stored = window.sessionStorage.getItem(CHILD_ACTIVITY_FILTER_KEY)
    return ACTIVITY_FILTERS.some(filter => filter.id === stored)
      ? (stored as ActivityFilterId)
      : 'recommended'
  })
  const [soundFilter, setSoundFilter] = useState<SoundFamilyId>(() => {
    if (typeof window === 'undefined') {
      return 'all'
    }

    const stored = window.sessionStorage.getItem(CHILD_SOUND_FILTER_KEY)
    return SOUND_FILTERS.some(filter => filter.id === stored)
      ? (stored as SoundFamilyId)
      : 'all'
  })
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const activeAvatar = selectedAvatar ?? internalAvatar
  const filteredScenarios = compactChildMode
    ? filterScenarios(scenarios, activityFilter, soundFilter)
    : scenarios
  const stepGroups = compactChildMode ? groupByStep(filteredScenarios) : []

  useEffect(() => {
    if (!compactChildMode || typeof window === 'undefined') {
      return
    }

    window.sessionStorage.setItem(CHILD_ACTIVITY_FILTER_KEY, activityFilter)
    window.sessionStorage.setItem(CHILD_SOUND_FILTER_KEY, soundFilter)
  }, [activityFilter, compactChildMode, soundFilter])

  useEffect(() => {
    if (!compactChildMode || filteredScenarios.length === 0) {
      return
    }

    const selectedVisible = filteredScenarios.some(
      scenario => scenario.id === selectedScenario
    )

    if (!selectedVisible && filteredScenarios[0].id !== selectedScenario) {
      onSelect(filteredScenarios[0].id)
    }
  }, [compactChildMode, filteredScenarios, onSelect, selectedScenario])

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

  const renderScenarioCard = (scenario: Scenario) => {
    const isSelected = selectedScenario === scenario.id
    const stepNumber = scenario.exerciseMetadata?.stepNumber

    return (
      <Card
        key={scenario.id}
        className={mergeClasses(
          styles.card,
          compactChildMode && styles.compactCard,
          isSelected && styles.selected
        )}
        onClick={() => onSelect(scenario.id)}
      >
        <div className={styles.cardHeader}>
          <span
            className={mergeClasses(
              styles.graphIcon,
              compactChildMode && styles.compactIcon
            )}
          >
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

        <div
          className={mergeClasses(
            styles.metadataRow,
            compactChildMode && styles.compactMetadataRow
          )}
        >
          {stepNumber ? (
            <Badge appearance="tint" className={styles.metaBadge}>
              Step {stepNumber}
            </Badge>
          ) : null}
          {!compactChildMode ? (
            <Badge appearance="filled" className={styles.metaBadge}>
              {formatExerciseType(scenario.exerciseMetadata?.type)}
            </Badge>
          ) : null}
          {scenario.exerciseMetadata?.targetSound ? (
            <Badge appearance="tint" className={styles.metaBadge}>
              Sound: {scenario.exerciseMetadata.targetSound}
            </Badge>
          ) : null}
          {!compactChildMode && scenario.exerciseMetadata?.difficulty ? (
            <Badge appearance="tint" className={styles.metaBadge}>
              {scenario.exerciseMetadata.difficulty}
            </Badge>
          ) : null}
        </div>
      </Card>
    )
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

      {compactChildMode ? (
        <>
          <div className={styles.filterPanel}>
            <div className={styles.filterGroup}>
              <Text className={styles.filterLabel}>Activity</Text>
              <div className={styles.desktopFilterRow}>
                {ACTIVITY_FILTERS.map(filter => (
                  <Button
                    key={filter.id}
                    appearance="secondary"
                    className={mergeClasses(
                      styles.filterButton,
                      activityFilter === filter.id && styles.activeFilterButton
                    )}
                    onClick={() => setActivityFilter(filter.id)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className={styles.filterGroup}>
              <Text className={styles.filterLabel}>Target sound</Text>
              <div className={styles.desktopFilterRow}>
                {SOUND_FILTERS.map(filter => (
                  <Button
                    key={filter.id}
                    appearance="secondary"
                    className={mergeClasses(
                      styles.filterButton,
                      soundFilter === filter.id && styles.activeFilterButton
                    )}
                    onClick={() => setSoundFilter(filter.id)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className={styles.mobileFilterRow}>
              <Dropdown
                className={styles.filterDropdown}
                value={ACTIVITY_FILTERS.find(filter => filter.id === activityFilter)?.label || ''}
                selectedOptions={[activityFilter]}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    setActivityFilter(data.optionValue as ActivityFilterId)
                  }
                }}
              >
                {ACTIVITY_FILTERS.map(filter => (
                  <Option key={filter.id} value={filter.id}>
                    {filter.label}
                  </Option>
                ))}
              </Dropdown>
              <Dropdown
                className={styles.filterDropdown}
                value={SOUND_FILTERS.find(filter => filter.id === soundFilter)?.label || ''}
                selectedOptions={[soundFilter]}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    setSoundFilter(data.optionValue as SoundFamilyId)
                  }
                }}
              >
                {SOUND_FILTERS.map(filter => (
                  <Option key={filter.id} value={filter.id}>
                    {filter.label}
                  </Option>
                ))}
              </Dropdown>
            </div>
          </div>

          {stepGroups.length === 0 ? (
            <Text className={styles.emptyState} size={300}>
              No practice matches this filter yet. Try another activity or sound.
            </Text>
          ) : (
            <div className={styles.stepGroups}>
              {stepGroups.map(group => {
                const isExpanded = expandedGroups[group.id] ?? false
                const visibleScenarios = isExpanded
                  ? group.scenarios
                  : group.scenarios.slice(0, MAX_CHILD_CARDS_PER_GROUP)

                return (
                  <section key={group.id} className={styles.stepGroup}>
                    <div className={styles.stepHeader}>
                      <div className={styles.stepHeading}>
                        <Text className={styles.stepTitle}>
                          {group.stepNumber
                            ? `Step ${group.stepNumber} · ${getStepLabel(group.stepNumber)}`
                            : group.label}
                        </Text>
                        <Text className={styles.groupCount}>
                          {group.scenarios.length} exercise{group.scenarios.length === 1 ? '' : 's'}
                        </Text>
                      </div>

                      {group.scenarios.length > MAX_CHILD_CARDS_PER_GROUP ? (
                        <Button
                          appearance="subtle"
                          className={styles.showMoreButton}
                          onClick={() =>
                            setExpandedGroups(current => ({
                              ...current,
                              [group.id]: !isExpanded,
                            }))
                          }
                        >
                          {isExpanded ? 'Show less' : `Show all ${group.scenarios.length}`}
                        </Button>
                      ) : null}
                    </div>

                    <div className={styles.groupCards}>
                      {visibleScenarios.map(renderScenarioCard)}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className={styles.cardsGrid}>
          {scenarios.map(renderScenarioCard)}
        </div>
      )}

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
                      {scenario.scenarioData.exerciseType ? (
                        <Badge appearance="tint" className={styles.metaBadge}>
                          Custom
                        </Badge>
                      ) : null}
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
