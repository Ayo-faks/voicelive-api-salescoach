/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * HelpPopover — contextual help affordance for ambiguous labels.
 *
 * Phase 3 of docs/onboarding/onboarding-plan-v2.md (item 12). Renders a
 * small `?`-icon button next to a label and, on open, surfaces the
 * `HelpTopic` with matching `topicId` from `onboarding/helpContent.ts`.
 *
 * Contract:
 *  - Self-disables when the onboarding context is disabled (child
 *    persona or signed-out). The telemetry shim also short-circuits for
 *    child, but we skip the render entirely to keep the DOM clean and
 *    avoid confusing mascot-era UI.
 *  - Emits `ONBOARDING_EVENTS.HELP_OPENED` with
 *    `{ source: 'popover', key: topicId }` on open. `trackEvent` is a
 *    no-op for child persona (double belt-and-braces).
 *  - Keyboard: trigger responds to Enter / Space (native Button). Escape
 *    closes the popover and returns focus to the trigger.
 *  - Accessibility: trigger carries an `aria-label` referencing the
 *    label it explains ("More about {label}"). Popover body uses
 *    `aria-live="polite"` so screen readers announce the disclosure
 *    without stealing focus.
 */

import { useRef, useState } from 'react'
import {
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

import { HELP_TOPICS } from '../../onboarding/helpContent'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { useOnboarding } from '../../onboarding/context'
import { telemetry } from '../../services/telemetry'

export interface HelpPopoverProps {
  /** Help-topic id in `HELP_TOPICS`. If not found, the component renders
   * nothing (fail-closed — no mystery ? triggers). */
  topicId: string
  /** Short human label this popover explains; used for the trigger's
   * `aria-label`. Example: "voice mode". */
  label: string
  /** Optional className forwarded to the trigger button. */
  className?: string
}

const useStyles = makeStyles({
  trigger: {
    // Match Fluent's icon-button visual budget; keeps contrast ≥ 3:1
    // against both light and dark neutral backgrounds.
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    marginLeft: tokens.spacingHorizontalXS,
    padding: 0,
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    borderTopStyle: 'none',
    borderRightStyle: 'none',
    borderBottomStyle: 'none',
    borderLeftStyle: 'none',
    borderRadius: tokens.borderRadiusCircular,
    cursor: 'pointer',
    ':hover': {
      color: tokens.colorNeutralForeground1,
      background: tokens.colorNeutralBackground3Hover,
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: tokens.colorStrokeFocus2,
    },
  },
  surface: {
    maxWidth: '320px',
  },
  title: {
    marginBottom: tokens.spacingVerticalXS,
  },
})

export function HelpPopover(props: HelpPopoverProps): JSX.Element | null {
  const styles = useStyles()
  const { disabled } = useOnboarding()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Child persona / signed-out: render nothing. This keeps the DOM
  // identical to the pre-onboarding baseline for minors.
  if (disabled) return null

  const topic = HELP_TOPICS.find(entry => entry.id === props.topicId)
  if (!topic) return null

  const handleOpenChange = (
    _event: unknown,
    data: { open: boolean }
  ): void => {
    setOpen(data.open)
    if (data.open) {
      telemetry.trackEvent(ONBOARDING_EVENTS.HELP_OPENED, {
        source: 'popover',
        key: topic.id,
      })
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      withArrow
      positioning="above"
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>
        <button
          type="button"
          ref={triggerRef}
          aria-label={`More about ${props.label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={mergeClasses(styles.trigger, props.className)}
          data-testid={`help-popover-trigger-${topic.id}`}
        >
          <QuestionMarkCircleIcon style={{ width: 16, height: 16 }} />
        </button>
      </PopoverTrigger>
      <PopoverSurface
        className={styles.surface}
        aria-live="polite"
        data-testid={`help-popover-surface-${topic.id}`}
      >
        <Text
          block
          weight="semibold"
          className={styles.title}
          data-testid={`help-popover-title-${topic.id}`}
        >
          {topic.title}
        </Text>
        <Text block data-testid={`help-popover-body-${topic.id}`}>
          {topic.body}
        </Text>
      </PopoverSurface>
    </Popover>
  )
}
