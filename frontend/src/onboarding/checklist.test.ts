/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest'

import {
  evaluateChecklist,
  type AppSnapshot,
} from './checklist'

const emptySnapshot: AppSnapshot = {
  hasChildren: false,
  hasSessions: false,
  hasReports: false,
  hasConsentOnAtLeastOneChild: false,
  onboardingTourSeen: false,
}

describe('evaluateChecklist', () => {
  it('filters items by role when role gate is set', () => {
    const parentRows = evaluateChecklist(emptySnapshot, 'parent', undefined)
    // No items are gated to parent currently, so parent sees none.
    expect(parentRows).toHaveLength(0)

    const therapistRows = evaluateChecklist(
      emptySnapshot,
      'therapist',
      undefined
    )
    // Therapist sees the legacy 5 items, none of the learner ones.
    expect(therapistRows.length).toBe(5)
    expect(therapistRows.every(r => r.item.id.startsWith('learner-') === false)).toBe(true)
  })

  it('shows the learner-role items to learners only', () => {
    const learnerRows = evaluateChecklist(emptySnapshot, 'learner', undefined)
    const ids = learnerRows.map(r => r.item.id)
    expect(ids).toEqual([
      'learner-welcome-tour',
      'learner-first-checkin',
      'learner-try-revision',
      'learner-try-voice-tutor',
    ])
  })

  it('marks items completed when predicate returns true', () => {
    const rows = evaluateChecklist(
      { ...emptySnapshot, hasChildren: true },
      'therapist',
      undefined
    )
    const addChildRow = rows.find(r => r.item.id === 'add-first-child')
    expect(addChildRow?.completed).toBe(true)
  })

  it('honours userState override even when predicate is false', () => {
    const rows = evaluateChecklist(emptySnapshot, 'therapist', {
      'welcome-tour': true,
    })
    const tourRow = rows.find(r => r.item.id === 'welcome-tour')
    expect(tourRow?.completed).toBe(true)
  })

  it('leaves items incomplete when neither predicate nor userState marks them', () => {
    const rows = evaluateChecklist(emptySnapshot, 'therapist', {})
    expect(rows.every(r => !r.completed)).toBe(true)
  })
})
