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
  Dialog,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Label,
  Option,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
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
const ALL_STEPS_ID = 'all-steps'
const MOBILE_BROWSER_BREAKPOINT = 960

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
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    '@media (max-width: 960px)': {
      padding: 'var(--space-sm)',
    },
  },
  browserShell: {
    display: 'grid',
    gridTemplateColumns: '220px minmax(0, 1fr)',
    gap: 'var(--space-md)',
    alignItems: 'start',
    '@media (max-width: 960px)': {
      gridTemplateColumns: '1fr',
    },
  },
  categoryRail: {
    display: 'grid',
    gap: '8px',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    '@media (max-width: 960px)': {
      display: 'none',
    },
  },
  categoryRailTitle: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '600',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  categoryButton: {
    justifyContent: 'space-between',
    minHeight: '40px',
    paddingInline: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    color: 'var(--color-text-primary)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
    fontWeight: '700',
  },
  categoryButtonActive: {
    border: '1px solid rgba(13, 138, 132, 0.2)',
    backgroundColor: 'rgba(13, 138, 132, 0.18)',
    color: 'var(--color-primary-dark)',
  },
  categoryCount: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.74rem',
  },
  browserContent: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  mobileCategoryRow: {
    display: 'none',
    '@media (max-width: 960px)': {
      display: 'grid',
      gap: 'var(--space-sm)',
    },
  },
  mobileCategoryTrigger: {
    minHeight: '42px',
    justifyContent: 'space-between',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(13, 138, 132, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    color: 'var(--color-text-primary)',
    fontWeight: '700',
  },
  drawerSurface: {
    width: 'min(92vw, 360px)',
    minHeight: '100vh',
    marginLeft: 'auto',
    borderRadius: '24px 0 0 24px',
    padding: 'var(--space-lg)',
    display: 'grid',
    gap: 'var(--space-md)',
  },
  drawerBody: {
    display: 'grid',
    gap: 'var(--space-md)',
  },
  drawerSection: {
    display: 'grid',
    gap: '8px',
  },
  drawerSectionTitle: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '600',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
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
    '@media (max-width: 960px)': {
      display: 'none',
    },
  },
  mobileFilterRow: {
    display: 'none',
    gap: 'var(--space-sm)',
    gridTemplateColumns: '1fr',
    '@media (max-width: 960px)': {
      display: 'grid',
    },
  },
  filterDropdown: {
    width: '100%',
  },
  filterButton: {
    minHeight: '34px',
    paddingInline: 'var(--space-md)',
    borderRadius: '6px',
    fontSize: '0.8125rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    border: '1px solid transparent',
    color: 'var(--color-primary-dark)',
    backgroundColor: 'rgba(13, 138, 132, 0.12)',
  },
  activeFilterButton: {
    border: '1px solid rgba(13, 138, 132, 0.16)',
    backgroundColor: 'rgba(13, 138, 132, 0.18)',
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
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    boxShadow: '0 12px 24px rgba(17, 36, 58, 0.08)',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    '&:hover': {
      border: '1px solid rgba(13, 138, 132, 0.22)',
      boxShadow: '0 16px 30px rgba(17, 36, 58, 0.12)',
    },
    '@media (max-width: 640px)': {
      minHeight: '120px',
    },
  },
  cardBusy: {
    cursor: 'progress',
    opacity: 0.72,
    pointerEvents: 'none',
  },
  compactCard: {
    minHeight: 'unset',
    aspectRatio: '1 / 1',
    padding: 'var(--space-sm)',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    boxShadow: '0 12px 24px rgba(17, 36, 58, 0.08)',
    display: 'grid',
    alignContent: 'space-between',
    gap: 'var(--space-sm)',
    overflow: 'hidden',
    '@media (max-width: 640px)': {
      aspectRatio: '1 / 1',
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
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 'var(--radius-md)',
    border: '1px dashed rgba(13, 138, 132, 0.18)',
    fontSize: '0.8125rem',
  },
  cardHeader: {
    display: 'flex',
    gap: 'var(--space-sm)',
    alignItems: 'flex-start',
  },
  compactCardHeader: {
    display: 'grid',
    gap: 'var(--space-sm)',
    alignContent: 'start',
  },
  cardCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1,
  },
  compactCardCopy: {
    gap: 'var(--space-sm)',
  },
  cardTitle: {
    display: 'inline-flex',
    alignSelf: 'start',
    maxWidth: '100%',
    padding: '8px 10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(13, 138, 132, 0.12)',
    fontFamily: 'var(--font-display)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.88rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  compactCardTitle: {
    display: 'inline-flex',
    alignSelf: 'start',
    maxWidth: '100%',
    padding: '8px 10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(13, 138, 132, 0.12)',
    fontSize: '0.88rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
    boxShadow: 'none',
    color: 'var(--color-primary-dark)',
  },
  cardDescription: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    lineHeight: 1.5,
    maxWidth: '28ch',
  },
  compactCardDescription: {
    display: '-webkit-box',
    WebkitLineClamp: '4',
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    fontSize: '0.79rem',
    lineHeight: 1.45,
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
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    fontFamily: 'var(--font-display)',
    fontSize: '0.95rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    color: 'var(--color-text-primary)',
  },
  groupCount: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '700',
  },
  groupCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(172px, 1fr))',
    gap: 'var(--space-sm)',
    '@media (max-width: 820px)': {
      gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
    },
  },
  showMoreButton: {
    minHeight: '32px',
    minWidth: '120px',
    paddingInline: 'var(--space-md)',
    borderRadius: '4px',
    fontSize: '0.8125rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    color: 'var(--color-text-primary)',
    border: '1px solid transparent',
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
    minWidth: '160px',
    paddingInline: 'var(--space-lg)',
    borderRadius: '4px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    boxShadow: 'none',
    border: 'none',
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
  onStartScenario?: (id: string) => void
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
  showCustomCreateTrigger?: boolean
  customExerciseTrigger?: ReactElement
  selectedAvatar?: string
  onAvatarChange?: (value: string) => void
  compactChildMode?: boolean
  launchInFlight?: boolean
}

export function ScenarioList({
  scenarios,
  customScenarios,
  selectedScenario,
  onSelect,
  onStartScenario,
  onStart,
  onAddCustomScenario,
  onUpdateCustomScenario,
  onDeleteCustomScenario,
  title = "Let's practice!",
  helperText = 'Choose a Wulo exercise, then start a calm, guided speech practice session.',
  showFooter = true,
  showCustomExercises = true,
  showCustomCreateTrigger = true,
  customExerciseTrigger,
  selectedAvatar,
  onAvatarChange,
  compactChildMode = false,
  launchInFlight = false,
}: Props) {
  const styles = useStyles()
  const [isMobileBrowser, setIsMobileBrowser] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.innerWidth <= MOBILE_BROWSER_BREAKPOINT
  })
  const [internalAvatar, setInternalAvatar] = useState(DEFAULT_AVATAR)
  const [activityFilter, setActivityFilter] = useState<ActivityFilterId>(() => {
    if (typeof window === 'undefined') {
      return compactChildMode ? 'recommended' : 'all'
    }

    const stored = window.sessionStorage.getItem(CHILD_ACTIVITY_FILTER_KEY)
    return ACTIVITY_FILTERS.some(filter => filter.id === stored)
      ? (stored as ActivityFilterId)
      : compactChildMode
        ? 'recommended'
        : 'all'
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
  const [activeStepId, setActiveStepId] = useState(ALL_STEPS_ID)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const activeAvatar = selectedAvatar ?? internalAvatar
  const categoryNavigationEnabled = compactChildMode || !showFooter
  const filteredScenarios = filterScenarios(scenarios, activityFilter, soundFilter)
  const stepGroups = groupByStep(filteredScenarios)
  const visibleStepGroups = categoryNavigationEnabled && activeStepId !== ALL_STEPS_ID
    ? stepGroups.filter(group => group.id === activeStepId)
    : stepGroups

  useEffect(() => {
    if (!compactChildMode || typeof window === 'undefined') {
      return
    }

    window.sessionStorage.setItem(CHILD_ACTIVITY_FILTER_KEY, activityFilter)
    window.sessionStorage.setItem(CHILD_SOUND_FILTER_KEY, soundFilter)
  }, [activityFilter, compactChildMode, soundFilter])

  useEffect(() => {
    if (activeStepId === ALL_STEPS_ID) {
      return
    }

    const activeStepStillVisible = stepGroups.some(group => group.id === activeStepId)

    if (!activeStepStillVisible) {
      setActiveStepId(ALL_STEPS_ID)
    }
  }, [activeStepId, stepGroups])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia(
      `(max-width: ${MOBILE_BROWSER_BREAKPOINT}px)`
    )
    const updateMobileBrowser = (event?: MediaQueryListEvent) => {
      setIsMobileBrowser(event ? event.matches : mediaQuery.matches)
    }

    updateMobileBrowser()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMobileBrowser)
      return () => mediaQuery.removeEventListener('change', updateMobileBrowser)
    }

    mediaQuery.addListener(updateMobileBrowser)
    return () => mediaQuery.removeListener(updateMobileBrowser)
  }, [])

  useEffect(() => {
    if (!isMobileBrowser && mobileDrawerOpen) {
      setMobileDrawerOpen(false)
    }
  }, [isMobileBrowser, mobileDrawerOpen])

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

  const categoryOptions = [
    {
      id: ALL_STEPS_ID,
      label: 'All steps',
      count: filteredScenarios.length,
    },
    ...stepGroups.map(group => ({
      id: group.id,
      label: group.stepNumber
        ? `Step ${group.stepNumber} · ${getStepLabel(group.stepNumber)}`
        : group.label,
      count: group.scenarios.length,
    })),
  ]

  const handleAvatarChange = (value: string) => {
    if (onAvatarChange) {
      onAvatarChange(value)
      return
    }

    setInternalAvatar(value)
  }

  const activeCategoryLabel =
    categoryOptions.find(option => option.id === activeStepId)?.label || 'All steps'

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

  const handleScenarioClick = (scenarioId: string) => {
    if (launchInFlight) {
      return
    }

    if (onStartScenario) {
      onStartScenario(scenarioId)
      return
    }

    onSelect(scenarioId)
  }

  const renderScenarioCard = (scenario: Scenario) => {
    const isSelected = selectedScenario === scenario.id

    return (
      <Card
        key={scenario.id}
        className={mergeClasses(
          styles.card,
          compactChildMode && styles.compactCard,
          isSelected && styles.selected,
          launchInFlight && styles.cardBusy
        )}
        onClick={() => handleScenarioClick(scenario.id)}
      >
        <div
          className={mergeClasses(
            styles.cardHeader,
            compactChildMode && styles.compactCardHeader
          )}
        >
          <div
            className={mergeClasses(
              styles.cardCopy,
              compactChildMode && styles.compactCardCopy
            )}
          >
            <Text
              className={mergeClasses(
                styles.cardTitle,
                compactChildMode && styles.compactCardTitle
              )}
              size={500}
              weight="semibold"
            >
              {scenario.name}
            </Text>
            <Text
              className={mergeClasses(
                styles.cardDescription,
                compactChildMode && styles.compactCardDescription
              )}
              size={300}
            >
              {scenario.description}
            </Text>
          </div>
        </div>

        {!compactChildMode ? (
          <div className={styles.metadataRow}>
            <Badge appearance="filled" className={styles.metaBadge}>
              {formatExerciseType(scenario.exerciseMetadata?.type)}
            </Badge>
            {scenario.exerciseMetadata?.targetSound ? (
              <Badge appearance="tint" className={styles.metaBadge}>
                Sound: {scenario.exerciseMetadata.targetSound}
              </Badge>
            ) : null}
            {scenario.exerciseMetadata?.difficulty ? (
              <Badge appearance="tint" className={styles.metaBadge}>
                {scenario.exerciseMetadata.difficulty}
              </Badge>
            ) : null}
          </div>
        ) : null}
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

      {categoryNavigationEnabled ? (
        <>
          <div className={styles.browserShell}>
            {!isMobileBrowser ? (
              <aside className={styles.categoryRail}>
                <Text className={styles.categoryRailTitle}>Browse by step</Text>
                {categoryOptions.map(option => (
                  <Button
                    key={option.id}
                    appearance="secondary"
                    className={mergeClasses(
                      styles.categoryButton,
                      activeStepId === option.id && styles.categoryButtonActive
                    )}
                    onClick={() => setActiveStepId(option.id)}
                  >
                    {option.label}
                    <span className={styles.categoryCount}>{option.count}</span>
                  </Button>
                ))}
              </aside>
            ) : null}

            <div className={styles.browserContent}>
              <div className={styles.filterPanel}>
                {isMobileBrowser ? (
                  <div className={styles.mobileCategoryRow}>
                    <Button
                      appearance="secondary"
                      className={styles.mobileCategoryTrigger}
                      icon={<AdjustmentsHorizontalIcon className="w-5 h-5" />}
                      onClick={() => setMobileDrawerOpen(true)}
                    >
                      Browse steps
                      <span className={styles.categoryCount}>{activeCategoryLabel}</span>
                    </Button>
                  </div>
                ) : null}

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

              <Dialog open={mobileDrawerOpen} onOpenChange={(_, data) => setMobileDrawerOpen(data.open)}>
                <DialogSurface className={styles.drawerSurface}>
                  <DialogTitle>Browse exercises</DialogTitle>
                  <DialogBody className={styles.drawerBody}>
                    <div className={styles.drawerSection}>
                      <Text className={styles.drawerSectionTitle}>Steps</Text>
                      {categoryOptions.map(option => (
                        <Button
                          key={option.id}
                          appearance="secondary"
                          className={mergeClasses(
                            styles.categoryButton,
                            activeStepId === option.id && styles.categoryButtonActive
                          )}
                          onClick={() => {
                            setActiveStepId(option.id)
                            setMobileDrawerOpen(false)
                          }}
                        >
                          {option.label}
                          <span className={styles.categoryCount}>{option.count}</span>
                        </Button>
                      ))}
                    </div>

                    <div className={styles.drawerSection}>
                      <Text className={styles.drawerSectionTitle}>Activity</Text>
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
                    </div>

                    <div className={styles.drawerSection}>
                      <Text className={styles.drawerSectionTitle}>Target sound</Text>
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
                  </DialogBody>
                </DialogSurface>
              </Dialog>

              {visibleStepGroups.length === 0 ? (
                <Text className={styles.emptyState} size={300}>
                  No practice matches this filter yet. Try another activity or sound.
                </Text>
              ) : (
                <div className={styles.stepGroups}>
                  {visibleStepGroups.map(group => {
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
            </div>
          </div>
        </>
      ) : (
        <div className={styles.cardsGrid}>
          {scenarios.map(renderScenarioCard)}
        </div>
      )}

      {showCustomExercises ? (
        <>
          <Divider style={{ marginTop: tokens.spacingVerticalL }} />

          {showCustomCreateTrigger ? (
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
              <CustomScenarioEditor
                onSave={onAddCustomScenario}
                trigger={customExerciseTrigger}
              />
            </div>
          ) : null}

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
                                icon={<PencilSquareIcon className="w-5 h-5" />}
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
