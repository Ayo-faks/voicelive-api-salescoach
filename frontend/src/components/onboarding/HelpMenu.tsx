/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Global help menu — the "Take a tour" control in the sidebar footer (v2 Phase 1 step 5).
 *
 * Lists topics from `onboarding/helpContent.ts`. Selecting a topic with
 * `replayTourId` triggers a tour replay via the `onReplayTour` callback.
 * Selecting a topic with `href` navigates out to the deep doc.
 *
 * Telemetry is emitted by the caller (via `onTopicSelected`), so this
 * component stays free of `PilotTelemetryService` imports and trivially
 * testable in Vitest.
 */

import { useId, useMemo, useState, type ReactElement } from 'react'
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { MapIcon } from '@heroicons/react/24/outline'

import { MENU_HELP_TOPICS, type HelpTopic } from '../../onboarding/helpContent'
import { getTourById, tourSupportsRole } from '../../onboarding/tours'

export interface HelpMenuProps {
  /** Current authenticated role, used to hide tours for other audiences. */
  currentRole?: string | null
  /** Replay a tour by id. Wired by the App's tour driver. */
  onReplayTour?: (tourId: string) => void
  /** Telemetry hook invoked with the topic id on selection. */
  onTopicSelected?: (topicId: string) => void
  /** Called when the menu is opened. Use for `help_opened` telemetry. */
  onOpened?: () => void
  /** Optional label for the trigger button. Defaults to "Take a tour". */
  triggerLabel?: string
  /** Optional icon for the trigger. Defaults to a map icon. */
  triggerIcon?: ReactElement
  /** Additional className merged onto the trigger (for sidebar footer styling). */
  triggerClassName?: string
}

const useStyles = makeStyles({
  triggerButton: {
    justifyContent: 'flex-start',
    minHeight: '40px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  popover: {
    maxHeight: 'min(70vh, 520px)',
    overflowY: 'auto',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,252,252,0.92))',
    border: '1px solid rgba(13,138,132,0.18)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.85), 0 10px 28px rgba(15,42,58,0.14)',
    backdropFilter: 'blur(16px)',
    borderRadius: '14px',
    padding: '6px',
  },
  topicBody: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
})

export function HelpMenu(props: HelpMenuProps): JSX.Element {
  const styles = useStyles()
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const visibleTopics = useMemo(
    () =>
      MENU_HELP_TOPICS.filter(topic => {
        if (!topic.replayTourId) return true
        const tour = getTourById(topic.replayTourId)
        return tour ? tourSupportsRole(tour, props.currentRole) : false
      }),
    [props.currentRole]
  )

  const handleOpenChange = (_: unknown, data: { open: boolean }): void => {
    setOpen(data.open)
    if (data.open) {
      props.onOpened?.()
    }
  }

  const handleSelect = (topic: HelpTopic): void => {
    props.onTopicSelected?.(topic.id)
    if (topic.replayTourId) {
      props.onReplayTour?.(topic.replayTourId)
      setOpen(false)
      return
    }
    if (topic.href) {
      window.location.href = topic.href
    }
  }

  const label = props.triggerLabel ?? 'Take a tour'
  const icon = props.triggerIcon ?? <MapIcon className="w-5 h-5" />

  return (
    <Menu
      open={open}
      onOpenChange={handleOpenChange}
      positioning={{ position: 'above', align: 'start', autoSize: 'height' }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Button
          id={menuId}
          appearance="subtle"
          aria-label="Take a tour"
          aria-haspopup="menu"
          icon={icon}
          className={mergeClasses(styles.triggerButton, props.triggerClassName)}
          data-testid="help-menu-trigger"
        >
          {label}
        </Button>
      </MenuTrigger>
      <MenuPopover className={styles.popover}>
        <MenuList data-testid="help-menu-list">
          {visibleTopics.map(topic => (
            <MenuItem
              key={topic.id}
              onClick={() => handleSelect(topic)}
              data-testid={`help-menu-item-${topic.id}`}
            >
              <div>
                <Text weight="semibold" block>
                  {topic.title}
                </Text>
                <Text className={styles.topicBody} block>
                  {topic.body}
                </Text>
              </div>
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
