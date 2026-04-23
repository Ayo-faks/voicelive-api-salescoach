/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ChecklistContainer
 *
 * Thin wrapper around `ChecklistWidget` that pulls `ui_state` from the
 * `OnboardingContext`. Pages (DashboardHome etc.) can drop this in with
 * only a domain snapshot + role, no manual state threading.
 */

import { useNavigate } from 'react-router-dom'

import { useOnboarding } from '../../onboarding/context'
import type { AppSnapshot } from '../../onboarding/checklist'
import { ChecklistWidget } from './ChecklistWidget'

export interface ChecklistContainerProps {
  snapshot: AppSnapshot
  role: string
  title?: string
}

export function ChecklistContainer({
  snapshot,
  role,
  title,
}: ChecklistContainerProps) {
  const onboarding = useOnboarding()
  const navigate = useNavigate()

  if (onboarding.disabled) return null

  const handleToggle = (id: string, completed: boolean): void => {
    const current = onboarding.state.checklist_state ?? {}
    // Skip no-op writes so we don't rack up PATCH traffic.
    if (Boolean(current[id]) === completed) return
    onboarding.patch({
      checklist_state: { ...current, [id]: completed },
    })
  }

  const handleNavigate = (href: string): void => {
    navigate(href)
  }

  return (
    <ChecklistWidget
      snapshot={snapshot}
      role={role}
      userState={onboarding.state.checklist_state}
      onToggleItem={handleToggle}
      onNavigate={handleNavigate}
      title={title}
    />
  )
}
