/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Help content registry contract test.
 *
 * Guards against accidental rot in `HELP_TOPICS`:
 *  - every topic has non-empty title + body copy (adult persona — no
 *    placeholder strings slipping into the pilot),
 *  - every `replayTourId` resolves to a registered tour,
 *  - topic ids are unique,
 *  - `MENU_HELP_TOPICS` is a subset with each entry carrying either a
 *    replay target or an href.
 */

import { describe, it, expect } from 'vitest'

import { HELP_TOPICS, MENU_HELP_TOPICS } from './helpContent'
import { getTourById } from './tours'

describe('helpContent registry', () => {
  it('every topic has a non-empty id, title, and body', () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.id.length).toBeGreaterThan(0)
      expect(topic.title.length).toBeGreaterThan(0)
      expect(topic.body.length).toBeGreaterThan(0)
    }
  })

  it('topic ids are unique', () => {
    const ids = HELP_TOPICS.map(topic => topic.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every replayTourId resolves via getTourById', () => {
    for (const topic of HELP_TOPICS) {
      if (!topic.replayTourId) continue
      expect(
        getTourById(topic.replayTourId),
        `help topic ${topic.id} references unknown tour ${topic.replayTourId}`
      ).toBeDefined()
    }
  })

  it('menu subset only contains replayable or linked topics', () => {
    for (const topic of MENU_HELP_TOPICS) {
      const hasTarget =
        topic.replayTourId !== undefined || topic.href !== undefined
      expect(hasTarget).toBe(true)
    }
  })

  it('popover-only topics declare an anchorKey so grep-find-by-surface works', () => {
    const popoverOnly = HELP_TOPICS.filter(
      topic => !topic.replayTourId && !topic.href
    )
    // Phase 3 should ship at least the 10 ambiguous-label popovers from
    // onboarding-plan-v2.md item 12.
    expect(popoverOnly.length).toBeGreaterThanOrEqual(10)
    for (const topic of popoverOnly) {
      expect(topic.anchorKey, `topic ${topic.id} missing anchorKey`).toBeTruthy()
    }
  })
})
