/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Themed tooltip used by `react-joyride@3` for every tour step.
 * Provides:
 *  - Fluent styling to match the rest of the app.
 *  - Accessible focus trap via Joyride's built-in FocusLock.
 *  - Keyboard: `Esc` dismisses, `Enter`/`Space` advances.
 *  - `aria-live="polite"` announce region with step number + title + body.
 *  - `prefers-reduced-motion` path that suppresses the pulse-in animation.
 *
 * See docs/onboarding/onboarding-plan-v2.md — WCAG 2.2 AA section.
 */

import { type CSSProperties, type KeyboardEvent, useId } from 'react'
import {
  Button,
  FluentProvider,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import type { TooltipRenderProps } from 'react-joyride'
import { pathfinderTokens as pathfinder } from '../../learning/theme/pathfinder-tokens'
import { pathfinderFluentTheme } from '../../learning/theme/pathfinderFluentTheme'

/** Subset of the `TooltipRenderProps` shape that Joyride passes in.
 * We keep the dependency shape loose so we don't force callers to import
 * `react-joyride` typings at the call site. */
export type WuloTourTooltipProps = TooltipRenderProps

const useStyles = makeStyles({
  root: {
    width: 'min(380px, calc(100vw - 32px))',
    maxWidth: '380px',
    minWidth: '0',
    color: pathfinder.brand.text,
    paddingTop: '18px',
    paddingRight: '20px',
    paddingBottom: '16px',
    paddingLeft: '20px',
    borderRadius: pathfinder.radius.xl,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: pathfinder.brand.line,
    borderRightColor: pathfinder.brand.line,
    borderBottomColor: pathfinder.brand.line,
    borderLeftColor: pathfinder.brand.line,
    backgroundColor: pathfinder.surface.card,
    boxShadow: pathfinder.surface.cardElevatedShadow,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    fontFamily: pathfinder.font.text,
    animation: 'wulo-tour-pop 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: pathfinder.brand.ink,
      outlineOffset: '4px',
    },
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  title: {
    fontFamily: pathfinder.font.display,
    fontWeight: 700,
    letterSpacing: '0',
    fontSize: '1.02rem',
    lineHeight: 1.3,
    color: pathfinder.brand.text,
  },
  stepPill: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '22px',
    paddingTop: '0',
    paddingRight: '10px',
    paddingBottom: '0',
    paddingLeft: '10px',
    borderRadius: pathfinder.radius.pill,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: pathfinder.brand.line,
    borderRightColor: pathfinder.brand.line,
    borderBottomColor: pathfinder.brand.line,
    borderLeftColor: pathfinder.brand.line,
    backgroundColor: pathfinder.surface.cardMuted,
    color: pathfinder.brand.textSecondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  body: {
    color: pathfinder.brand.textSecondary,
    fontSize: '0.9375rem',
    lineHeight: 1.55,
    margin: 0,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '8px',
    marginTop: '6px',
    paddingTop: '10px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: pathfinder.brand.lineSoft,
  },
  spacer: { flex: 1 },
  skipButton: {
    minHeight: '32px',
    color: pathfinder.brand.textSecondary,
    fontWeight: 600,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: pathfinder.brand.ink,
      outlineOffset: '3px',
    },
  },
  backButton: {
    minHeight: '32px',
    borderRadius: pathfinder.radius.sm,
    backgroundColor: pathfinder.surface.card,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: pathfinder.brand.line,
    borderRightColor: pathfinder.brand.line,
    borderBottomColor: pathfinder.brand.line,
    borderLeftColor: pathfinder.brand.line,
    boxShadow: pathfinder.surface.raisedShadow,
    color: pathfinder.brand.text,
    fontWeight: 600,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: pathfinder.brand.ink,
      outlineOffset: '3px',
    },
  },
  nextButton: {
    minHeight: '32px',
    borderRadius: pathfinder.radius.sm,
    backgroundColor: pathfinder.brand.ink,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: pathfinder.brand.ink,
    borderRightColor: pathfinder.brand.ink,
    borderBottomColor: pathfinder.brand.ink,
    borderLeftColor: pathfinder.brand.ink,
    boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
    color: pathfinder.brand.onInk,
    fontWeight: 700,
    letterSpacing: '0',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: pathfinder.brand.ink,
      outlineOffset: '3px',
    },
  },
})

export function WuloTourTooltip(props: WuloTourTooltipProps): JSX.Element {
  const styles = useStyles()
  const titleId = useId()
  const bodyId = useId()
  const {
    index,
    size,
    step,
    isLastStep,
    backProps,
    primaryProps,
    skipProps,
    tooltipProps,
  } = props

  const tooltipStyle: CSSProperties = { outline: 'none' }
  const tooltipEventProps = tooltipProps as typeof tooltipProps & {
    onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  }
  const invokeButton = (
    buttonProps: unknown,
    event: KeyboardEvent<HTMLDivElement>
  ): void => {
    const onClick = (buttonProps as { onClick?: (event: unknown) => void })
      ?.onClick
    onClick?.(event)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    tooltipEventProps.onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      invokeButton(skipProps, event)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      invokeButton(primaryProps, event)
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      invokeButton(backProps, event)
    }
  }
  // Derive a stable identifier for the currently-active step from the
  // selector Joyride passes back. TourDriver always uses
  // `[data-testid="..."]` selectors, so the testId is recoverable here
  // without depending on Joyride preserving custom step.data fields.
  // Playwright uses `data-tour-step-active` to wait for Joyride to settle
  // on the intended step and avoid the cross-shell remount race.
  const rawTarget =
    typeof (step as { target?: unknown }).target === 'string'
      ? ((step as { target: string }).target)
      : ''
  const testIdMatch = rawTarget.match(/\[data-testid="([^"]+)"\]/)
  const activeStepAttr = testIdMatch ? testIdMatch[1] : undefined

  return (
    <FluentProvider
      theme={pathfinderFluentTheme}
      style={{ backgroundColor: 'transparent' }}
    >
      <div
        {...tooltipEventProps}
        className={styles.root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={step.content ? bodyId : undefined}
        aria-live="polite"
        onKeyDown={handleKeyDown}
        style={tooltipStyle}
        data-testid="wulo-tour-tooltip"
        data-tour-step-active={activeStepAttr}
      >
        <div className={styles.header}>
          <Text id={titleId} className={styles.title} data-testid="wulo-tour-title">
            {step.title}
          </Text>
          <span className={styles.stepPill} aria-hidden="true">
            {index + 1} / {size}
          </span>
        </div>
        {step.content ? (
          <Text id={bodyId} as="p" className={styles.body} data-testid="wulo-tour-body">
            {step.content}
          </Text>
        ) : null}
        <div className={styles.actions}>
          {skipProps ? (
            <Button
              {...(skipProps as Record<string, unknown>)}
              appearance="subtle"
              size="small"
              className={styles.skipButton}
              data-testid="wulo-tour-skip"
            >
              Skip
            </Button>
          ) : null}
          <span className={styles.spacer} />
          {index > 0 && backProps ? (
            <Button
              {...(backProps as Record<string, unknown>)}
              appearance="secondary"
              size="small"
              className={styles.backButton}
              data-testid="wulo-tour-back"
            >
              Back
            </Button>
          ) : null}
          {primaryProps ? (
            <Button
              {...(primaryProps as Record<string, unknown>)}
              appearance="primary"
              size="small"
              className={styles.nextButton}
              data-testid="wulo-tour-next"
            >
              {isLastStep ? 'Done' : 'Next'}
            </Button>
          ) : null}
        </div>
      </div>
    </FluentProvider>
  )
}
