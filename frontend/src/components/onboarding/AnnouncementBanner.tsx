/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AnnouncementBanner (v2 Phase 2).
 *
 * Top-of-app informational banner. Reads `ANNOUNCEMENTS`, filters by role
 * and `ui_state.announcements_dismissed`, and shows at most one at a time
 * (the oldest-declared non-dismissed entry). Dismissal is persistent.
 *
 * Renders nothing when there is nothing to show. Child personas never see
 * announcements — OnboardingRuntime already disables telemetry for them,
 * and we apply an extra role guard here for belt-and-braces.
 */

import { useMemo } from 'react'
import {
  Button,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { XMarkIcon } from '@heroicons/react/24/outline'

import {
  listVisibleAnnouncements,
  type Announcement,
  type AnnouncementSeverity,
} from '../../onboarding/announcements'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { telemetry } from '../../services/telemetry'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  info: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  success: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
  },
  warning: {
    backgroundColor: tokens.colorPaletteYellowBackground2,
  },
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
  },
})

export interface AnnouncementBannerProps {
  /** Viewer role — `child` suppresses rendering. */
  role: string
  /** Persisted dismissed slugs from `ui_state.announcements_dismissed`. */
  dismissed: string[] | undefined
  /** Persist a dismissal. Caller appends the id to `announcements_dismissed`. */
  onDismiss: (id: string) => void
  /** Optional router hook — defaults to `window.location.href`. */
  onNavigate?: (href: string) => void
}

function severityClass(
  styles: Record<string, string>,
  severity: AnnouncementSeverity
): string {
  if (severity === 'success') return styles.success
  if (severity === 'warning') return styles.warning
  return styles.info
}

export function AnnouncementBanner(
  props: AnnouncementBannerProps
): JSX.Element | null {
  const styles = useStyles()

  const visible = useMemo<Announcement | null>(() => {
    if (props.role === 'child') return null
    const list = listVisibleAnnouncements({
      role: props.role,
      dismissed: props.dismissed ?? [],
    })
    return list[0] ?? null
  }, [props.role, props.dismissed])

  if (!visible) return null

  // One-shot "shown" telemetry. We only care about the first paint per
  // mount, and React's strict-mode double-render is acceptable noise at
  // pilot scale.
  telemetry.trackEvent(ONBOARDING_EVENTS.ANNOUNCEMENT_SHOWN, {
    announcement_id: visible.id,
  })

  const handleDismiss = (): void => {
    telemetry.trackEvent(ONBOARDING_EVENTS.ANNOUNCEMENT_DISMISSED, {
      announcement_id: visible.id,
    })
    props.onDismiss(visible.id)
  }

  const handleCta = (): void => {
    if (visible.cta?.href) {
      if (props.onNavigate) {
        props.onNavigate(visible.cta.href)
      } else {
        window.location.href = visible.cta.href
      }
    }
    // Dismiss on CTA so the banner doesn't reappear on the next page.
    props.onDismiss(visible.id)
  }

  return (
    <div
      className={`${styles.root} ${severityClass(styles, visible.severity)}`}
      role="status"
      aria-live="polite"
      data-testid={`announcement-${visible.id}`}
    >
      <div className={styles.body}>
        <Text className={styles.title}>{visible.title}</Text>
        <Text>{visible.body}</Text>
      </div>
      <div className={styles.actions}>
        {visible.cta ? (
          <Button
            appearance="primary"
            size="small"
            onClick={handleCta}
            data-testid={`announcement-${visible.id}-cta`}
          >
            {visible.cta.label}
          </Button>
        ) : null}
        <Button
          appearance="subtle"
          size="small"
          icon={<XMarkIcon className="w-4 h-4" />}
          aria-label="Dismiss announcement"
          onClick={handleDismiss}
          data-testid={`announcement-${visible.id}-dismiss`}
        />
      </div>
    </div>
  )
}
