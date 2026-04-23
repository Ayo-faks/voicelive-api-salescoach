/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared empty-state component (v2 Phase 1 step 3).
 *
 * Replaces silent empty lists with copy + icon + primary CTA + optional
 * secondary hint across the seven surfaces identified in
 * docs/onboarding/onboarding-plan-v2.md:
 *
 *   1. No children (Settings + Home)
 *   2. No sessions (Dashboard)
 *   3. No reports (Reports)
 *   4. No memory items (review queue)
 *   5. No custom scenarios (library)
 *   6. No invitations
 *   7. No plans
 */

import type { ReactNode } from 'react'
import { Button, Text, makeStyles, tokens } from '@fluentui/react-components'

export interface EmptyStateProps {
  /** Stable slug for telemetry (`empty_state_cta_clicked.surface`). */
  surface: string
  /** Short title that names the absence. */
  title: string
  /** One-sentence explanation of why the list is empty and what to do. */
  body: string
  /** Optional icon element rendered above the title. */
  icon?: ReactNode
  /** Optional primary CTA. */
  action?: {
    label: string
    onClick?: () => void
    href?: string
  }
  /** Optional second-line hint for advanced users / keyboard shortcuts. */
  hint?: ReactNode
  /** Optional test id override; defaults to `empty-state-${surface}`. */
  testId?: string
  /** Telemetry hook — invoked with `{ surface }` on CTA click. */
  onCtaClick?: (surface: string) => void
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    gap: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    minHeight: '220px',
  },
  icon: {
    fontSize: '32px',
    lineHeight: 1,
    opacity: 0.8,
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
  },
  body: {
    maxWidth: '42ch',
    color: tokens.colorNeutralForeground2,
  },
  hint: {
    marginTop: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
})

export function EmptyState(props: EmptyStateProps): JSX.Element {
  const styles = useStyles()
  const testId = props.testId ?? `empty-state-${props.surface}`

  const handleClick = (): void => {
    props.onCtaClick?.(props.surface)
    if (props.action?.onClick) {
      props.action.onClick()
    }
  }

  const ctaButton = props.action ? (
    props.action.href && !props.action.onClick ? (
      <Button
        as="a"
        appearance="primary"
        href={props.action.href}
        onClick={() => props.onCtaClick?.(props.surface)}
        data-testid={`${testId}-cta`}
      >
        {props.action.label}
      </Button>
    ) : (
      <Button
        appearance="primary"
        onClick={handleClick}
        data-testid={`${testId}-cta`}
      >
        {props.action.label}
      </Button>
    )
  ) : null

  return (
    <div
      className={styles.root}
      role="status"
      aria-live="polite"
      data-testid={testId}
    >
      {props.icon ? (
        <div className={styles.icon} aria-hidden="true">
          {props.icon}
        </div>
      ) : null}
      <Text className={styles.title} size={500}>
        {props.title}
      </Text>
      <Text className={styles.body}>{props.body}</Text>
      {ctaButton}
      {props.hint ? <div className={styles.hint}>{props.hint}</div> : null}
    </div>
  )
}
