/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * React context that exposes the shared `ui_state` store to onboarding
 * consumers (ChecklistWidget, future popovers). Keeps App.tsx from
 * prop-drilling `patch`/`state` through every route.
 */

import { createContext, useContext } from 'react'

import type { UiState } from '../types'

export interface OnboardingContextValue {
  /** Current ui_state; always defined (defaults to empty when disabled). */
  state: UiState
  /** Debounced patch — merge keys into the store. */
  patch: (patch: Partial<UiState>) => void
  /** Whether the store is disabled (child persona or logged out). */
  disabled: boolean
}

const defaultValue: OnboardingContextValue = {
  state: {},
  patch: () => undefined,
  disabled: true,
}

export const OnboardingContext =
  createContext<OnboardingContextValue>(defaultValue)

/** Read the onboarding UI-state context. Safe to call when disabled. */
export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext)
}
