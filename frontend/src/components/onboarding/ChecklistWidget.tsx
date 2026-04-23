/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ChecklistWidget (v2 Phase 2).
 *
 * Renders a collapsible getting-started list derived from:
 *  1. The app snapshot (counts/flags the caller passes in)
 *  2. The user's persisted `ui_state.checklist_state` manual overrides
 *
 * The widget self-hides once every item is complete — the plan wants a
 * silent "ambient" experience for returning users. Consumers wire the
 * snapshot in a single place (Home/Dashboard) and get
 * telemetry + persistence for free.
 */

import { useMemo } from 'react'
import {
  Button,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { CheckCircleIcon as CheckCircleOutline } from '@heroicons/react/24/outline'

import {
  evaluateChecklist,
  type AppSnapshot,
  type ChecklistItem,
} from '../../onboarding/checklist'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { telemetry } from '../../services/telemetry'

const useStyles = makeStyles({
  root: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalL,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  summary: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  itemComplete: {
    opacity: 0.6,
  },
  icon: {
    width: '22px',
    height: '22px',
    flexShrink: 0,
    marginTop: '2px',
  },
  iconComplete: {
    color: tokens.colorPaletteGreenForeground1,
  },
  iconPending: {
    color: tokens.colorNeutralForeground3,
  },
  itemBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  itemTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  itemTitleStrike: {
    textDecoration: 'line-through',
  },
  itemSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  itemActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
  },
})

export interface ChecklistWidgetProps {
  /** Current snapshot of app data used by predicates. */
  snapshot: AppSnapshot
  /** Viewer role (`therapist`/`admin`/`parent`). */
  role: string
  /** Persisted manual-override map from `ui_state.checklist_state`. */
  userState: Record<string, boolean> | undefined
  /** Persist a manual toggle → `ui_state.checklist_state[id] = completed`. */
  onToggleItem: (id: string, completed: boolean) => void
  /** Navigate somewhere. Caller supplies routing. */
  onNavigate?: (href: string) => void
  /** Optional title override. */
  title?: string
}

export function ChecklistWidget(props: ChecklistWidgetProps): JSX.Element | null {
  const styles = useStyles()
  const evaluated = useMemo(
    () => evaluateChecklist(props.snapshot, props.role, props.userState),
    [props.snapshot, props.role, props.userState]
  )

  const total = evaluated.length
  const done = evaluated.filter(e => e.completed).length

  // Silent once everything's done — see module docstring.
  if (total === 0 || done === total) return null

  const handleCta = (item: ChecklistItem): void => {
    telemetry.trackEvent(ONBOARDING_EVENTS.CHECKLIST_ITEM_COMPLETED, {
      item_id: item.id,
      outcome: 'cta',
    })
    if (item.cta?.href && props.onNavigate) {
      props.onNavigate(item.cta.href)
    } else if (item.cta?.href) {
      window.location.href = item.cta.href
    }
  }

  const handleMarkDone = (item: ChecklistItem): void => {
    telemetry.trackEvent(ONBOARDING_EVENTS.CHECKLIST_ITEM_COMPLETED, {
      item_id: item.id,
      outcome: 'manual',
    })
    props.onToggleItem(item.id, true)
  }

  return (
    <section
      className={styles.root}
      data-testid="checklist-widget"
      aria-label={props.title ?? 'Getting started'}
    >
      <div className={styles.header}>
        <Text className={styles.title}>{props.title ?? 'Getting started'}</Text>
        <Text className={styles.summary} data-testid="checklist-progress">
          {done} of {total} complete
        </Text>
      </div>
      <ul className={styles.list}>
        {evaluated.map(({ item, completed }) => (
          <li
            key={item.id}
            className={mergeClasses(styles.item, completed && styles.itemComplete)}
            data-testid={`checklist-item-${item.id}`}
            data-completed={completed ? 'true' : 'false'}
          >
            {completed ? (
              <CheckCircleIcon
                className={mergeClasses(styles.icon, styles.iconComplete)}
                aria-hidden="true"
              />
            ) : (
              <CheckCircleOutline
                className={mergeClasses(styles.icon, styles.iconPending)}
                aria-hidden="true"
              />
            )}
            <div className={styles.itemBody}>
              <Text
                className={mergeClasses(
                  styles.itemTitle,
                  completed && styles.itemTitleStrike
                )}
              >
                {item.title}
              </Text>
              <Text className={styles.itemSub}>{item.body}</Text>
            </div>
            {!completed ? (
              <div className={styles.itemActions}>
                {item.cta ? (
                  <Button
                    appearance="primary"
                    size="small"
                    onClick={() => handleCta(item)}
                    data-testid={`checklist-item-${item.id}-cta`}
                  >
                    {item.cta.label}
                  </Button>
                ) : null}
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => handleMarkDone(item)}
                  data-testid={`checklist-item-${item.id}-mark-done`}
                >
                  Mark done
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
