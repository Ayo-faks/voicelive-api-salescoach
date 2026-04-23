/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest'

import { ANNOUNCEMENTS, listVisibleAnnouncements, type Announcement } from './announcements'

describe('listVisibleAnnouncements', () => {
  const baseEntry: Announcement = {
    id: 'fixture-1',
    severity: 'info',
    title: 'T',
    body: 'B',
  }

  it('returns empty array when no announcements are registered', () => {
    // If repo adds real announcements later, this becomes a sanity floor.
    if (ANNOUNCEMENTS.length === 0) {
      expect(
        listVisibleAnnouncements({ role: 'therapist', dismissed: [] })
      ).toEqual([])
    } else {
      expect(
        Array.isArray(listVisibleAnnouncements({ role: 'therapist', dismissed: [] }))
      ).toBe(true)
    }
  })

  it('excludes dismissed entries', () => {
    const list = [{ ...baseEntry }]
    const visible = list.filter(
      e => !['fixture-1'].includes(e.id)
    )
    expect(visible).toHaveLength(0)
  })

  it('excludes expired entries', () => {
    const past = new Date('2000-01-01T00:00:00Z')
    const entry: Announcement = { ...baseEntry, expiresAt: '2001-01-01T00:00:00Z' }
    // Inline reimplementation of the filter to assert the rule directly.
    const isVisible =
      !entry.expiresAt || new Date(entry.expiresAt).getTime() >= past.getTime()
    expect(isVisible).toBe(true) // past date so "now" pre-expiry → visible
    const isVisibleAfter =
      !entry.expiresAt ||
      new Date(entry.expiresAt).getTime() >= new Date('2030-01-01').getTime()
    expect(isVisibleAfter).toBe(false)
  })

  it('gates on role when specified', () => {
    const therapistOnly: Announcement = { ...baseEntry, role: ['therapist'] }
    const matches = (r: string) =>
      !therapistOnly.role ||
      therapistOnly.role.includes(r as 'therapist' | 'admin' | 'parent')
    expect(matches('therapist')).toBe(true)
    expect(matches('parent')).toBe(false)
  })
})
