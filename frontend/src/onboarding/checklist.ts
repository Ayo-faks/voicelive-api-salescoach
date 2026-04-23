/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Getting-started checklist (v2 Phase 2).
 *
 * Each item carries a pure predicate that inspects an `AppSnapshot` and
 * returns `true` when the step is effectively complete. The checklist
 * UI unions the predicate with the user's persisted `checklist_state`
 * map (for manual "mark done" overrides). Keeping predicates pure keeps
 * the component trivially testable.
 */

import { t } from './t'

export interface AppSnapshot {
  hasChildren: boolean
  hasSessions: boolean
  hasReports: boolean
  hasConsentOnAtLeastOneChild: boolean
  onboardingTourSeen: boolean
}

export interface ChecklistItem {
  /** Stable key used in `ui_state.checklist_state`. */
  id: string
  title: string
  body: string
  /** Pure predicate that derives completion from app data. */
  predicate: (snapshot: AppSnapshot) => boolean
  /** Optional CTA — route the user to the right surface. */
  cta?: { label: string; href: string }
  /** Role gate. */
  role?: Array<'therapist' | 'admin' | 'parent'>
}

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: 'welcome-tour',
    title: t('checklist.welcome_tour.title', 'Take the welcome tour'),
    body: t(
      'checklist.welcome_tour.body',
      'A one-minute walkthrough of the main surfaces.'
    ),
    predicate: snap => snap.onboardingTourSeen,
    role: ['therapist', 'admin'],
  },
  {
    id: 'add-first-child',
    title: t('checklist.add_first_child.title', 'Add your first child'),
    body: t(
      'checklist.add_first_child.body',
      'Children appear in Home and Settings.'
    ),
    predicate: snap => snap.hasChildren,
    cta: { label: 'Open Settings', href: '/settings' },
    role: ['therapist', 'admin'],
  },
  {
    id: 'run-first-session',
    title: t('checklist.run_first_session.title', 'Run your first session'),
    body: t(
      'checklist.run_first_session.body',
      'Pick an exercise and hit start. Wulo handles the rest.'
    ),
    predicate: snap => snap.hasSessions,
    cta: { label: 'Start session', href: '/session' },
    role: ['therapist', 'admin'],
  },
  {
    id: 'review-first-report',
    title: t('checklist.review_first_report.title', 'Review your first report'),
    body: t(
      'checklist.review_first_report.body',
      'Reports can be audience-redacted for parents or schools.'
    ),
    predicate: snap => snap.hasReports,
    cta: { label: 'Open Dashboard', href: '/dashboard' },
    role: ['therapist', 'admin'],
  },
  {
    id: 'capture-consent',
    title: t('checklist.capture_consent.title', 'Capture parental consent'),
    body: t(
      'checklist.capture_consent.body',
      'Required before any recording or report is shared.'
    ),
    predicate: snap => snap.hasConsentOnAtLeastOneChild,
    cta: { label: 'Open Settings', href: '/settings' },
    role: ['therapist', 'admin'],
  },
]

export function evaluateChecklist(
  snapshot: AppSnapshot,
  role: string,
  userState: Record<string, boolean> | undefined
): Array<{ item: ChecklistItem; completed: boolean }> {
  const stateMap = userState ?? {}
  return CHECKLIST_ITEMS.filter(item => {
    if (!item.role) return true
    return item.role.includes(role as 'therapist' | 'admin' | 'parent')
  }).map(item => ({
    item,
    completed: Boolean(item.predicate(snapshot) || stateMap[item.id]),
  }))
}
