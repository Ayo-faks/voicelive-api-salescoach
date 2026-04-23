/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tour registry contract test (v2 Verification #8).
 *
 * Asserts each tour listed in `ALL_TOURS` is internally consistent:
 *  - every step has a CSS selector that starts with `[data-testid=`
 *    (our only supported anchoring strategy)
 *  - the testId inside the selector matches the `testId` field
 *  - ids/roles are present
 *
 * Once session-view anchors land, extend this to mount fixtures per tour
 * and assert every selector resolves against the rendered tree.
 */

import { describe, it, expect } from 'vitest'

import {
  ALL_TOURS,
  customScenarioTour,
  childMemoryReviewTour,
  dashboardTour,
  familyIntakeTour,
  getTourById,
  insightsRailTour,
  pickAutoTour,
  plannerReadinessTour,
  practicePlansTour,
  progressReportsTour,
  reportsAudienceTour,
  sessionReviewTour,
  welcomeAdminTour,
  welcomeParentTour,
  welcomeTherapistTour,
  type TourDefinition,
} from './tours'

/** Every tour definition exported from `tours.ts` — including the parked
 *  ones that are not yet wired into `ALL_TOURS`. The contract test walks
 *  this list so we guard against selector/testId drift even for tours
 *  whose anchors do not yet exist in the DOM. */
const EXPORTED_TOURS: TourDefinition[] = [
  welcomeTherapistTour,
  welcomeAdminTour,
  welcomeParentTour,
  insightsRailTour,
  dashboardTour,
  sessionReviewTour,
  childMemoryReviewTour,
  familyIntakeTour,
  customScenarioTour,
  practicePlansTour,
  progressReportsTour,
  plannerReadinessTour,
  reportsAudienceTour,
]

describe('tour registry contract', () => {
  describe.each(EXPORTED_TOURS.map(tour => [tour.id, tour] as const))(
    '%s',
    (_id, tour) => {
      it('has a non-empty id and at least one step', () => {
        expect(tour.id).toBeTruthy()
        expect(tour.steps.length).toBeGreaterThan(0)
      })

      it('declares a concrete role gate', () => {
        const roles = Array.isArray(tour.role) ? tour.role : [tour.role]
        expect(roles.length).toBeGreaterThan(0)
        for (const role of roles) {
          // Child persona must never be a tour role (Children's Code).
          expect(role).not.toBe('child')
        }
      })

      it('every step has matching selector / testId / non-empty copy', () => {
        for (const step of tour.steps) {
          expect(step.selector.startsWith('[data-testid="')).toBe(true)
          const match = step.selector.match(/\[data-testid="([^"]+)"\]/)
          expect(match).not.toBeNull()
          expect(match?.[1]).toBe(step.testId)
          expect(step.title.length).toBeGreaterThan(0)
          expect(step.body.length).toBeGreaterThan(0)
        }
      })
    }
  )

  it('adult tour step bodies stay under the 50-word budget', () => {
    // v2 Accessibility / attention budget guard-rail. Microtours and
    // welcome tours must respect the limit — long copy is a symptom of
    // trying to teach too much in a single step.
    for (const tour of EXPORTED_TOURS) {
      for (const [index, step] of tour.steps.entries()) {
        const words = step.body.trim().split(/\s+/).length
        expect(
          words,
          `${tour.id}.step${index + 1} has ${words} words (max 50)`
        ).toBeLessThanOrEqual(50)
      }
    }
  })

  it('every ALL_TOURS entry is one of the exported definitions', () => {
    for (const tour of ALL_TOURS) {
      expect(EXPORTED_TOURS).toContain(tour)
    }
  })

  it('tour ids are unique across the exported catalogue', () => {
    const ids = EXPORTED_TOURS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getTourById resolves registered tours and returns undefined otherwise', () => {
    expect(getTourById('welcome-therapist')?.id).toBe('welcome-therapist')
    expect(getTourById('welcome-admin')?.id).toBe('welcome-admin')
    expect(getTourById('welcome-parent')?.id).toBe('welcome-parent')
    expect(getTourById('does-not-exist')).toBeUndefined()
    // Parked tours must be unreachable via the lookup helper — they are
    // deliberately absent from `ALL_TOURS` until their anchors land.
    expect(getTourById('session-review-tour')).toBeUndefined()
  })

  it('pickAutoTour respects the kill switch and seen list', () => {
    // Kill switch off → no tour.
    expect(
      pickAutoTour({
        pathname: '/home',
        role: 'therapist',
        seenTourIds: [],
        toursEnabled: false,
      })
    ).toBeUndefined()

    // Already seen → no tour.
    expect(
      pickAutoTour({
        pathname: '/home',
        role: 'therapist',
        seenTourIds: ['welcome-therapist'],
        toursEnabled: true,
      })
    ).toBeUndefined()

    // Child persona → no tour regardless of route.
    expect(
      pickAutoTour({
        pathname: '/home',
        role: 'child',
        seenTourIds: [],
        toursEnabled: true,
      })
    ).toBeUndefined()

    // Therapist on /home → welcome-therapist.
    expect(
      pickAutoTour({
        pathname: '/home',
        role: 'therapist',
        seenTourIds: [],
        toursEnabled: true,
      })?.id
    ).toBe('welcome-therapist')

    // Admin on /home → welcome-admin (not welcome-therapist).
    expect(
      pickAutoTour({
        pathname: '/home',
        role: 'admin',
        seenTourIds: [],
        toursEnabled: true,
      })?.id
    ).toBe('welcome-admin')

    // Parent on /home → welcome-parent.
    expect(
      pickAutoTour({
        pathname: '/home',
        role: 'parent',
        seenTourIds: [],
        toursEnabled: true,
      })?.id
    ).toBe('welcome-parent')

    // Therapist on /dashboard → dashboard-tour.
    expect(
      pickAutoTour({
        pathname: '/dashboard',
        role: 'therapist',
        seenTourIds: [],
        toursEnabled: true,
      })?.id
    ).toBe('dashboard-tour')
  })
})
