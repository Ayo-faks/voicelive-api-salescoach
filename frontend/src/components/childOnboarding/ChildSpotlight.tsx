/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Child-mode spotlight overlay.
 *
 * Positioning: a pure ``getBoundingClientRect`` + ``ResizeObserver`` +
 * ``scroll`` listener loop. This keeps Phase 4 dependency-free against
 * the bundle budget (docs/onboarding/onboarding-plan-v2.md §Performance
 * & bundle). ``@floating-ui/react`` is still listed as the only
 * approved Tier C add, but we only need a single anchored rect — the
 * ``useFloating``/``autoUpdate`` pair would be overkill here and would
 * pull in ``@floating-ui/react`` which is not currently installed.
 *
 * Mask: one fixed-position SVG covers the viewport; a ``<mask>``
 * punches the anchor's ``rect`` out of a white fill, and the ``<rect>``
 * fill uses ``rgba(0,0,0,0.55)`` so the backdrop dims everything
 * except the spotlit element.
 *
 * Pointer isolation: the SVG absorbs all clicks outside the cutout
 * (``pointer-events: auto``), so young users cannot accidentally hit
 * background UI while the spotlight is active. The component's own
 * callout card sits above the mask with ``pointer-events: auto`` to
 * keep its buttons interactive.
 *
 * Reduced-motion + forced-colors branches match ChildMascot.tsx.
 */

import {
  Button,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { resolveSpotlightAnchor } from '../../childOnboarding/spotlightAnchors'
import { useReducedMotion } from '../../childOnboarding/useReducedMotion'

const useStyles = makeStyles({
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 1500,
    pointerEvents: 'none',
  },
  mask: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'auto',
  },
  callout: {
    position: 'absolute',
    maxWidth: '320px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ...shorthands.borderRadius('16px'),
    padding: '16px',
    boxShadow: '0 16px 32px rgba(15, 23, 42, 0.28)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    pointerEvents: 'auto',
    '@media (forced-colors: active)': {
      ...shorthands.border('2px', 'solid', 'CanvasText'),
      backgroundColor: 'Canvas',
      color: 'CanvasText',
    },
  },
  caption: {
    margin: 0,
    fontSize: '16px',
    lineHeight: 1.4,
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    ...shorthands.borderWidth(0),
  },
  actions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
  tapTarget: {
    minWidth: '44px',
    minHeight: '44px',
  },
  ring: {
    animationName: {
      '0%': { boxShadow: '0 0 0 0 rgba(37, 99, 235, 0.55)' },
      '70%': { boxShadow: '0 0 0 18px rgba(37, 99, 235, 0)' },
      '100%': { boxShadow: '0 0 0 0 rgba(37, 99, 235, 0)' },
    },
    animationDuration: '2s',
    animationIterationCount: 'infinite',
  },
  '@media (prefers-reduced-motion: reduce)': {
    ring: { animationName: 'none' },
  },
})

export interface ChildSpotlightProps {
  anchorId: string
  caption: string
  nextCtaLabel?: string
  dismissCtaLabel?: string
  onNext: () => void
  onDismiss: () => void
  reducedMotion?: boolean
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const PADDING = 8

function devWarn(message: string): void {
  if (typeof console !== 'undefined' && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn('[ChildSpotlight]', message)
  }
}

export function ChildSpotlight({
  anchorId,
  caption,
  nextCtaLabel = 'Next',
  dismissCtaLabel = 'Skip',
  onNext,
  onDismiss,
  reducedMotion: reducedMotionProp,
}: ChildSpotlightProps): JSX.Element | null {
  const styles = useStyles()
  const detected = useReducedMotion()
  const reducedMotion = reducedMotionProp ?? detected
  const nextRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<Element | null>(null)

  const anchor = useMemo(() => resolveSpotlightAnchor(anchorId), [anchorId])
  const [rect, setRect] = useState<Rect | null>(null)
  const [anchorMissing, setAnchorMissing] = useState(false)

  const measure = useCallback(() => {
    if (!anchor) return
    const el = document.querySelector(anchor.selector)
    if (!(el instanceof HTMLElement)) {
      setAnchorMissing(true)
      return
    }
    setAnchorMissing(false)
    const bounds = el.getBoundingClientRect()
    setRect({
      top: bounds.top - PADDING,
      left: bounds.left - PADDING,
      width: bounds.width + PADDING * 2,
      height: bounds.height + PADDING * 2,
    })
  }, [anchor])

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    previousFocusRef.current = document.activeElement
    return () => {
      const prev = previousFocusRef.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [])

  useLayoutEffect(() => {
    if (!anchor) {
      devWarn(`Unknown anchor id "${anchorId}"; spotlight unmounted.`)
      setAnchorMissing(true)
      return
    }
    measure()
    nextRef.current?.focus()

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
    const target = document.querySelector(anchor.selector)
    if (target instanceof HTMLElement && ro) ro.observe(target)

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor, anchorId, measure])

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      } else if (e.key === 'Enter' || e.key === ' ') {
        // Enter/Space advance if the focused element isn't itself a button.
        const target = e.target as HTMLElement | null
        if (target && target.tagName !== 'BUTTON') {
          e.preventDefault()
          onNext()
        }
      }
    },
    [onDismiss, onNext],
  )

  if (!anchor) {
    devWarn(`Spotlight anchor "${anchorId}" is not registered.`)
    return null
  }

  if (anchorMissing) {
    devWarn(
      `Anchor "${anchor.selector}" is not mounted; spotlight silently hidden.`,
    )
    return null
  }

  const callout = rect
    ? {
        top: Math.min(
          rect.top + rect.height + 12,
          (typeof window !== 'undefined' ? window.innerHeight : 800) - 180,
        ),
        left: Math.max(
          16,
          Math.min(
            rect.left,
            (typeof window !== 'undefined' ? window.innerWidth : 1200) - 340,
          ),
        ),
      }
    : { top: 24, left: 24 }

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-modal="false"
      aria-label={anchor.ariaLabel}
      onKeyDown={handleKey}
      data-testid="child-spotlight"
    >
      {rect && (
        <svg className={styles.mask} aria-hidden="true">
          <defs>
            <mask id="child-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx={12}
                ry={12}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.55)"
            mask="url(#child-spotlight-mask)"
          />
        </svg>
      )}
      <div
        className={styles.callout}
        style={callout}
        data-testid="child-spotlight-callout"
      >
        <p className={styles.caption} data-testid="child-spotlight-caption">
          {caption}
        </p>
        <div className={styles.srOnly} aria-live="polite" role="status">
          {caption}
        </div>
        <div className={styles.actions}>
          <Button
            appearance="subtle"
            className={styles.tapTarget}
            onClick={onDismiss}
            data-testid="child-spotlight-dismiss"
          >
            {dismissCtaLabel}
          </Button>
          <Button
            ref={nextRef}
            appearance="primary"
            className={styles.tapTarget}
            onClick={onNext}
            data-testid="child-spotlight-next"
          >
            {nextCtaLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
