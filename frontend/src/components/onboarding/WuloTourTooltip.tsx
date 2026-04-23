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

import type { CSSProperties } from 'react'
import { Button, FluentProvider, Text, makeStyles, tokens } from '@fluentui/react-components'
import type { TooltipRenderProps } from 'react-joyride'
import { wuloTheme } from '../../theme/wuloTheme'

/** Subset of the `TooltipRenderProps` shape that Joyride passes in.
 * We keep the dependency shape loose so we don't force callers to import
 * `react-joyride` typings at the call site. */
export type WuloTourTooltipProps = TooltipRenderProps

const useStyles = makeStyles({
  root: {
    maxWidth: '380px',
    minWidth: '300px',
    color: 'var(--color-text-primary, #0f2a3a)',
    padding: '18px 20px 16px',
    borderRadius: '18px',
    border: '1px solid rgba(13,138,132,0.2)',
    background:
      'radial-gradient(circle at 32% 18%, rgba(13,138,132,0.10), transparent 42%), ' +
      'radial-gradient(circle at 88% 100%, rgba(13,138,132,0.06), transparent 48%), ' +
      'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,252,252,0.94))',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.9), ' +
      '0 1px 2px rgba(15,42,58,0.08), ' +
      '0 18px 42px rgba(15,42,58,0.18)',
    backdropFilter: 'blur(18px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    fontFamily: 'var(--font-body, Manrope, system-ui, sans-serif)',
    animation: 'wulo-tour-pop 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
  },
  title: {
    fontFamily: 'var(--font-display, Manrope, system-ui, sans-serif)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    fontSize: '1.02rem',
    lineHeight: 1.3,
    color: 'var(--color-text-primary, #0f2a3a)',
  },
  stepPill: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '22px',
    padding: '0 10px',
    borderRadius: '999px',
    border: '1px solid rgba(13,138,132,0.18)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(236,246,246,0.85))',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.04)',
    color: '#0d8a84',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  body: {
    color: 'var(--color-text-secondary, #3a4f57)',
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
    borderTop: '1px solid rgba(15,42,58,0.06)',
  },
  spacer: { flex: 1 },
  skipButton: {
    minHeight: '32px',
    color: 'var(--color-text-tertiary, #5a6a6f)',
    fontWeight: 600,
  },
  backButton: {
    minHeight: '32px',
    borderRadius: '10px',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,251,251,0.9))',
    border: '1px solid rgba(13,138,132,0.22)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.06)',
    color: 'var(--color-text-primary, #0f2a3a)',
    fontWeight: 600,
  },
  nextButton: {
    minHeight: '32px',
    borderRadius: '10px',
    background: 'linear-gradient(180deg, #14a39c, #0d8a84 55%, #0a6f6b 100%)',
    border: '1px solid rgba(13,138,132,0.55)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.28), ' +
      '0 1px 2px rgba(13,138,132,0.28), ' +
      '0 6px 14px rgba(13,138,132,0.22)',
    color: '#ffffff',
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
})

export function WuloTourTooltip(props: WuloTourTooltipProps): JSX.Element {
  const styles = useStyles()
  const { index, size, step, isLastStep, backProps, primaryProps, skipProps, tooltipProps } = props

  const tooltipStyle: CSSProperties = { outline: 'none' }
  const ariaLabel = `Step ${index + 1} of ${size}: ${step.title ?? ''}`

  return (
    <FluentProvider theme={wuloTheme} style={{ backgroundColor: 'transparent' }}>
      <div
        {...tooltipProps}
        className={styles.root}
        role="dialog"
        aria-label={ariaLabel}
        aria-live="polite"
        style={tooltipStyle}
        data-testid="wulo-tour-tooltip"
      >
        <div className={styles.header}>
          <Text className={styles.title} data-testid="wulo-tour-title">
            {step.title}
          </Text>
          <span className={styles.stepPill} aria-hidden="true">
            {index + 1} / {size}
          </span>
        </div>
        {step.content ? (
          <Text as="p" className={styles.body} data-testid="wulo-tour-body">
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
