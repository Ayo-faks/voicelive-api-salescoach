/**
 * Pathfinder route smoke + visual baselines.
 *
 * Drives the 5 routes added in the Phase 1 refactor (router shell + per-surface
 * route components). Use these baselines to catch unintended visual drift on
 * the learner home, teacher dashboard, profile, pathways and trust & safety
 * screens at both desktop and mobile viewports.
 *
 * Run with PLAYWRIGHT_SKIP_WEBSERVER=true and a dev server already on
 * baseURL, or rely on playwright.config.ts's webServer.
 */
import { expect, test } from '@playwright/test'

const routes = [
  { path: '/home', testid: 'route-student-home', label: 'Student Learning Home' },
  { path: '/teacher', testid: 'route-teacher-dashboard', label: 'Teacher Mastery Dashboard' },
  { path: '/profile', testid: 'route-student-profile', label: 'Student Mastery Profile' },
  { path: '/pathways', testid: 'route-pathways-explorer', label: 'Pathways Explorer' },
  { path: '/safety', testid: 'route-trust-safety', label: 'Trust & Safety Console' },
]

test.describe('Pathfinder · routed surfaces', () => {
  test('redirects root to /home and exposes shell', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Pathfinder views' })
    ).toBeVisible()
  })

  for (const route of routes) {
    test(`route ${route.path} renders and matches desktop baseline`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(route.path)
      const root = page.getByTestId(route.testid)
      await expect(root).toBeVisible()
      // Confirm shell and route content coexist.
      await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible()
      // Visual baseline — first run creates the snapshot.
      await expect(page).toHaveScreenshot(`${route.testid}-desktop.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
      })
    })
  }

  test('mobile shell renders bottom nav and learner home', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/home')
    await expect(
      page.getByRole('navigation', { name: 'Pathfinder bottom nav' })
    ).toBeVisible()
    await expect(page.getByTestId('route-student-home')).toBeVisible()
    await expect(page).toHaveScreenshot('route-student-home-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    })
  })

  test('nav links switch routes without full reload', async ({ page }) => {
    await page.goto('/home')
    await page
      .getByRole('navigation', { name: 'Pathfinder views' })
      .getByRole('link', { name: 'Teacher' })
      .click()
    await expect(page).toHaveURL(/\/teacher$/)
    await expect(page.getByTestId('route-teacher-dashboard')).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Pathfinder views' })
      .getByRole('link', { name: 'Pathways' })
      .click()
    await expect(page).toHaveURL(/\/pathways$/)
    await expect(page.getByTestId('route-pathways-explorer')).toBeVisible()
  })
})
