/**
 * Pathfinder route smoke + visual baselines.
 *
 * Drives the 5 routes added in the Phase 1 refactor (router shell + per-surface
 * route components). Use these baselines to catch unintended visual drift on
 * the learner home, teacher dashboard, profile, pathways and trust & safety
 * screens at both desktop and mobile viewports.
 *
 * Each test mocks the session role explicitly because the route shell is
 * role-gated and the Playwright web server boots as `admin`. See
 * `e2e/fixtures/pathfinder-route-mocks.ts`.
 *
 * Run with PLAYWRIGHT_SKIP_WEBSERVER=true and a dev server already on
 * baseURL, or rely on playwright.config.ts's webServer.
 */
import { expect, test } from '@playwright/test'

import {
  installRouteMocks,
  type RouteRole,
} from './fixtures/pathfinder-route-mocks'

const routes: Array<{
  path: string
  testid: string
  label: string
  role: RouteRole
}> = [
  { path: '/home', testid: 'route-student-home', label: 'Student Learning Home', role: 'learner' },
  { path: '/teacher', testid: 'route-teacher-dashboard', label: 'Teacher Mastery Dashboard', role: 'admin' },
  { path: '/profile', testid: 'route-student-profile', label: 'Student Mastery Profile', role: 'learner' },
  { path: '/pathways', testid: 'route-pathways-explorer', label: 'Pathways Explorer', role: 'learner' },
  { path: '/safety', testid: 'route-trust-safety', label: 'Trust & Safety Console', role: 'admin' },
]

test.describe('Pathfinder · routed surfaces', () => {
  test('redirects root to /home and exposes shell', async ({ page }) => {
    await installRouteMocks(page, { role: 'learner' })
    await page.goto('/')
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Wulo Academy views' })
    ).toBeVisible()
  })

  for (const route of routes) {
    test(`route ${route.path} renders and matches desktop baseline`, async ({
      page,
    }) => {
      await installRouteMocks(page, { role: route.role })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(route.path)
      // Wait for the shell first — PathfinderLearnApp briefly returns null
      // during the auth-loading transition, so route content may flicker into
      // and out of the DOM before the shell stabilises.
      await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
        timeout: 15_000,
      })
      const root = page.getByTestId(route.testid)
      await expect(root).toBeVisible({ timeout: 15_000 })
      // Visual baseline — first run creates the snapshot.
      await expect(page).toHaveScreenshot(`${route.testid}-desktop.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
      })
    })
  }

  test('mobile shell renders bottom nav and learner home', async ({ page }) => {
    await installRouteMocks(page, { role: 'learner' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/home')
    await expect(
      page.getByRole('navigation', { name: 'Wulo Academy bottom nav' })
    ).toBeVisible()
    await expect(page.getByTestId('route-student-home')).toBeVisible()
    await expect(page).toHaveScreenshot('route-student-home-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    })
  })

  test('nav links switch routes without full reload', async ({ page }) => {
    // Admin sees both the Teacher and Pathways nav items; pick the role with
    // the widest nav so we can click between them in one session. Start on
    // /safety so the first nav click is a real navigation (clicking the
    // currently-active NavLink causes React to re-render the link and the
    // click target detaches mid-action).
    await installRouteMocks(page, { role: 'admin' })
    await page.goto('/safety')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
      timeout: 15_000,
    })

    await page
      .getByRole('navigation', { name: 'Wulo Academy views' })
      .getByRole('link', { name: 'Teacher' })
      .click()
    await expect(page).toHaveURL(/\/teacher$/)
    await expect(page.getByTestId('route-teacher-dashboard')).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Wulo Academy views' })
      .getByRole('link', { name: 'Pathways' })
      .click()
    await expect(page).toHaveURL(/\/pathways$/)
    await expect(page.getByTestId('route-pathways-explorer')).toBeVisible()
  })
})
